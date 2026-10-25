// Váltott műszak beosztása: { enabled, thisWeek: 'morning' | 'afternoon', weekendFree }. A mostani hét a megadott
// műszak, onnan hetente váltakozik (shared/utils/shift.ts). A kézzel átállított napok megmaradnak.
import type { ShiftSchedule } from '#shared/types/therapy'
import { markDirty } from '../utils/computed'
import { todayYmd } from '../utils/time'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const old = setting<ShiftSchedule>('shift', null)
  const thisWeek = body.thisWeek === 'afternoon' ? 'afternoon' : body.thisWeek === 'morning' ? 'morning' : null
  if (body.enabled === true && !thisWeek) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Add meg, milyen műszakos ez a hét.' }
  }
  const shift: ShiftSchedule = {
    enabled: body.enabled === true,
    anchor: thisWeek ? todayYmd() : old?.anchor ?? todayYmd(),
    anchorShift: thisWeek ?? old?.anchorShift ?? 'morning',
    weekendFree: body.weekendFree !== false,
    overrides: old?.overrides ?? {},
  }
  saveSettings({ shift })
  markDirty()
  return { ok: true, shift }
})
