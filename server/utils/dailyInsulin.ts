// Napi inzulin a hatás szerint szétosztva: egy bólus (étkezési / korrekció) a hatásgörbéje szerint oszlik
// meg a napok között. Az este 23-kor beadott adagnak csak az éjfélig ható része számít az adott napba,
// a többi (a még fennmaradó) a következő napéba. A bázis marad a naplózott idő szerint.
import { db } from './db'
import { therapy } from './therapy'
import { rapidDoses } from './iob'
import { startOfDayTs, addDaysYmd, ymdInTz } from './time'
import { MEAL_WINDOW_SEC, PREBOLUS_SEC } from './insulinKind'

export interface DayBolus {
  /** A napra eső (hatás szerinti) étkezési és korrekciós bólus, E. */
  meal: number
  correction: number
  /** Ugyanezen a napon a naplózott időpont szerint beadott bólus összesen, E (a különbség = az átnyúló rész). */
  logged: number
}

/** Napi bólus-összegek `start` … `end` napokra (YYYY-MM-DD, mindkettő beleértve); terápia nélkül null (nincs hatásgörbe). */
export function bolusByDay(start: string, end: string): Record<string, DayBolus> | null {
  const t = therapy()
  if (!t) return null
  const from = startOfDayTs(start)
  const to = startOfDayTs(addDaysYmd(end, 1))
  const carbTs = (db()
    .prepare("SELECT ts FROM entries WHERE type = 'carbs' AND ts >= ? AND ts < ? ORDER BY ts")
    .all(from - 12 * 3600 - MEAL_WINDOW_SEC, to + PREBOLUS_SEC) as { ts: number }[]).map((r) => Number(r.ts))
  const doses = rapidDoses(t, from, to, carbTs)

  const out: Record<string, DayBolus> = {}
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) out[d] = { meal: 0, correction: 0, logged: 0 }

  for (const dose of doses) {
    const key = dose.kind === 'correction' ? 'correction' : 'meal'
    const own = out[ymdInTz(dose.ts)]
    if (own) own.logged += dose.v
    // A hatásidő alatt érintett napok: a nap [a, b) szakaszán ható rész = IOB(a) − IOB(b).
    const lastTs = dose.ts + dose.dia * 60
    for (let d = ymdInTz(dose.ts); d <= end; d = addDaysYmd(d, 1)) {
      const dayStart = startOfDayTs(d)
      if (dayStart >= lastTs) break
      const bucket = out[d]
      if (!bucket) continue
      const a = Math.max(0, (dayStart - dose.ts) / 60)
      const b = (startOfDayTs(addDaysYmd(d, 1)) - dose.ts) / 60
      bucket[key] += dose.v * (dose.model.iob(a) - dose.model.iob(b))
    }
  }
  return out
}

/** A napi összesítő sorok inzulinját a hatás szerint szétosztott bólusra cseréli (a bázis marad naplózott). */
export function withAllocatedInsulin<T extends { date: string; insulin: number | null }>(rows: T[], alloc: Record<string, DayBolus> | null): T[] {
  if (!alloc) return rows
  return rows.map((r) => {
    const b = alloc[r.date]
    if (!b) return r
    const total = Math.max(0, (r.insulin ?? 0) - b.logged + b.meal + b.correction)
    return { ...r, insulin: total > 0.005 ? Math.round(total * 100) / 100 : null }
  })
}
