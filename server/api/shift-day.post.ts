// Egy nap műszakjának kézi átállítása (pl. szabadság, csere): { date: 'YYYY-MM-DD', shift: 'morning' | 'afternoon' |
// 'free' | null }. null vagy a beosztással egyező érték: vissza a beosztás szerintire.
import type { ShiftKind, ShiftSchedule } from '#shared/types/therapy'
import { scheduledShift, SHIFT_KINDS } from '#shared/utils/shift'
import { markDirty } from '../utils/computed'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const old = setting<ShiftSchedule>('shift', null)
  const date = String(body.date ?? '')
  if (!old?.enabled || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Nincs műszakbeosztás, vagy érvénytelen nap.' }
  }
  const kind = SHIFT_KINDS.includes(body.shift) ? (body.shift as ShiftKind) : null
  const overrides = { ...(old.overrides ?? {}) }
  if (!kind || kind === scheduledShift(old, date)) delete overrides[date]
  else overrides[date] = kind
  saveSettings({ shift: { ...old, overrides } })
  markDirty()
  return { ok: true }
})
