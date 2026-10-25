// Terápiás beállítások a főoldali kártyához és a szerkesztőhöz.
// A váltott műszak beosztása és a mai nap műszakja / érvényes profilja is (a kártya ezt mutatja).
import type { ShiftSchedule } from '#shared/types/therapy'
import { therapy, THERAPY_LIMITS, shiftOn, profileOn } from '../utils/therapy'
import { todayYmd } from '../utils/time'

export default defineEventHandler(() => {
  const t = therapy()
  const today = todayYmd()
  return {
    therapy: t,
    limits: THERAPY_LIMITS,
    shift: setting<ShiftSchedule>('shift', null),
    today: { date: today, shift: shiftOn(today), profile: t ? profileOn(t, today) : 'base' },
  }
})
