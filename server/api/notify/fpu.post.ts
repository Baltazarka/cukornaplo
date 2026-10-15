// Zsíros étel emlékeztető felvétele a bóluskalkulátorból: az étkezés után 90 perccel push, ha a cukor nincs a
// célérték alatt (server/utils/notify.ts checkFpuReminders).
import { addFpuReminder } from '../../utils/notify'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const now = Math.floor(Date.now() / 1000)
  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : null
  }
  const mealTs = num(b.mealTs, now - 3600, now + 600)
  const extra = num(b.extra, 0.5, 30)
  const units = num(b.units, 0.5, 30)
  const hours = num(b.hours, 1, 12)
  const pct = num(b.pct, 1, 100)
  if (mealTs == null || extra == null || units == null || hours == null || pct == null) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen emlékeztető.' }
  }
  addFpuReminder({ mealTs: Math.floor(mealTs), extra, units, hours, pct })
  return { ok: true }
})
