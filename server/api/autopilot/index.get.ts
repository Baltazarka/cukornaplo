// Autopilot oldal adatai: beállítások, a mostani döntés (várható görbével), a korábbi javaslatok visszamérése.
import { apSettings, apCompute, apOutcomes } from '../../utils/autopilot'
import { targetRange } from '../../utils/range'
import { RANGE_VERY_LOW, RANGE_VERY_HIGH } from '../../utils/stats'

export default defineEventHandler(() => {
  const decision = apCompute()
  return { settings: apSettings(), range: { ...targetRange(), veryLow: RANGE_VERY_LOW, veryHigh: RANGE_VERY_HIGH }, therapySet: decision != null, decision, ...apOutcomes() }
})
