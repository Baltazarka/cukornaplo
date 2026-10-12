// Céltartomány mentése.
import { clampRange } from '../utils/range'
import { invalidateComputed } from '../utils/jobs'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const low = Number(body.range_low)
  const high = Number(body.range_high)
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen céltartomány.' }
  }
  const clamped = clampRange(low, high)
  saveSettings({ range_low: clamped.low, range_high: clamped.high })
  invalidateComputed()
  return { ok: true, range: clamped }
})
