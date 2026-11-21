// Autopilot oldal adatai: beállítások, a mostani döntés (várható görbével), a korábbi javaslatok visszamérése.
import { apSettings, apCompute, apOutcomes } from '../../utils/autopilot'
import { targetRange } from '../../utils/range'

export default defineEventHandler(() => {
  const decision = apCompute()
  return { settings: apSettings(), range: targetRange(), therapySet: decision != null, decision, ...apOutcomes() }
})
