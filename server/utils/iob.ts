// A gyors hatású inzulin még aktív (hatásban lévő) része: a terápiás beállítások bólusinzulinjának
// csúcsidejével és a beadás napszakának hatásidejével (exponenciális modell, mint az OpenAPS / Loop).
import type { Therapy } from '#shared/types/therapy'
import { db } from './db'
import { actionMinutesAt } from './therapy'
import { insulinKind, type InsulinKind } from './insulinKind'

export interface RapidDose {
  ts: number
  v: number
  /** Hatásidő, perc (a beadás napszakáé). */
  dia: number
  kind: InsulinKind
  model: ReturnType<typeof insulinModel>
}

/** A bólusinzulin csúcsideje, perc (ha nincs megadva inzulin, 75 perc, mint a NovoRapidnál). */
export function bolusPeak(t: Therapy): number {
  return insulinById(t.bolusInsulin)?.peakMinutes ?? 75
}

/** A leghosszabb beállított hatásidő, perc: ennyivel korábbi adag számíthat még. */
export function maxActionMinutes(t: Therapy): number {
  return Math.max(t.actionMinutes, ...t.segments.map((s) => s.actionMinutes ?? 0))
}

/**
 * A nem bázis inzulinadagok [from − leghosszabb hatásidő, to) között, a saját görbéjükkel.
 * `carbTs`: a szénhidrát-bejegyzések időpontjai a besoroláshoz (étkezési / korrekció).
 */
export function rapidDoses(t: Therapy, from: number, to: number, carbTs: number[]): RapidDose[] {
  const peak = bolusPeak(t)
  const rows = db()
    .prepare("SELECT ts, value, subtype FROM entries WHERE type = 'insulin' AND (subtype IS NULL OR subtype != 'basal') AND ts >= ? AND ts < ? ORDER BY ts")
    .all(from - maxActionMinutes(t) * 60, to) as { ts: number; value: number; subtype: string | null }[]
  const out: RapidDose[] = []
  for (const r of rows) {
    const ts = Number(r.ts)
    const kind = insulinKind(ts, r.subtype, carbTs).kind
    // Az automatikusan bázisnak felismert adag (pl. a beállított bázisadag) sem számít.
    if (kind === 'basal') continue
    const dia = actionMinutesAt(t, ts)
    out.push({ ts, v: Number(r.value), dia, kind, model: insulinModel(peak, dia) })
  }
  return out
}

/** A még aktív inzulin (E) egy pillanatban; `inclusive`: a pont abban a másodpercben beadott adag is számít. */
export function iobAt(doses: RapidDose[], ts: number, inclusive = true): number {
  let sum = 0
  for (const d of doses) {
    const min = (ts - d.ts) / 60
    if (min < 0 || (!inclusive && min === 0)) continue
    sum += d.v * d.model.iob(min)
  }
  return sum
}
