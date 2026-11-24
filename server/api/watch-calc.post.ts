// Bóluskalkulátor az órás kliensnek (Garmin): { carbs: g } → javasolt adag. A szerver veszi hozzá a mostani cukrot
// (ha friss), a napszak CH-arányát / érzékenységét (átmenettel, mint a weboldal alapbeállítása) és az aktív inzulint,
// és ugyanazt a calcBolus-t futtatja, mint a weboldal kalkulátora. Tájékoztató számítás: a beadott adagról a felhasználó dönt.
import { db } from '../utils/db'
import { therapy, segmentAt, blendAt } from '../utils/therapy'
import { rapidDoses, iobAt } from '../utils/iob'
import { calcBolus } from '#shared/utils/bolus'

/** A kalkulátor csak ennyire friss cukorral korrigál (mint a weboldalon). */
const FRESH_MIN = 15

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const carbs = Number(body.carbs ?? 0)
  if (!Number.isFinite(carbs) || carbs < 0 || carbs > 400) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'A szénhidrát 0–400 g lehet.' }
  }

  const now = Math.floor(Date.now() / 1000)
  const t = therapy()
  if (!t) return { ok: false, error: 'Nincs terápiás beállítás.' }

  const last = db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND ts >= ? AND excluded = 0 ORDER BY ts DESC LIMIT 1")
    .get(now - 3600) as { ts: number; value: number } | undefined
  const ageMin = last ? Math.max(0, Math.round((now - Number(last.ts)) / 60)) : null
  const bg = last && ageMin != null && ageMin <= FRESH_MIN ? Number(last.value) : null

  const seg = segmentAt(t, now)
  const b = blendAt(t, now)
  const icr = b ? b.icr : seg.icr
  const isf = b ? b.isf : seg.isf

  const carbTs = (db().prepare("SELECT ts FROM entries WHERE type = 'carbs' AND ts >= ?").all(now - 12 * 3600) as any[]).map((r) => Number(r.ts))
  const iob = Math.round(iobAt(rapidDoses(t, now, now + 1, carbTs), now) * 100) / 100

  if (carbs === 0 && bg == null) {
    return { ok: false, error: 'Nincs megadott CH és nincs friss cukor.' }
  }

  const r = calcBolus({ carbs, bg, target: seg.target, isf, icr, iob, maxBolus: t.maxBolus })
  return { ok: true, dose: r.dose, carbDose: r.carbDose, correction: r.correction, iobUsed: r.iobUsed, capped: r.capped, bg, iob }
})
