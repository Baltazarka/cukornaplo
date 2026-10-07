// Állítható céltartomány (mmol/L), a settings.json-ban tárolva. Alap: 3,9–10,0.
import { RANGE_LOW, RANGE_HIGH, RANGE_VERY_LOW, RANGE_VERY_HIGH } from './stats'

export function targetRange(): { low: number; high: number } {
  let low = Number(setting('range_low', RANGE_LOW))
  let high = Number(setting('range_high', RANGE_HIGH))
  if (!Number.isFinite(low)) low = RANGE_LOW
  if (!Number.isFinite(high)) high = RANGE_HIGH
  return clampRange(low, high)
}

/** Ésszerű korlátok közé szorítja: veryLow < low < high < veryHigh. */
export function clampRange(low: number, high: number): { low: number; high: number } {
  low = Math.min(Math.max(low, RANGE_VERY_LOW + 0.1), RANGE_VERY_HIGH - 0.2)
  high = Math.min(Math.max(high, low + 0.5), RANGE_VERY_HIGH - 0.1)
  return { low: Math.round(low * 10) / 10, high: Math.round(high * 10) / 10 }
}
