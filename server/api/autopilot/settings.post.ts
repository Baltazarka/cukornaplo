import { validateAutopilot, autopilotSettings } from '../../utils/autopilot'

export default defineEventHandler(async (event) => {
  const prev = autopilotSettings()
  const settings = validateAutopilot((await readBody(event)) ?? {})
  saveSettings({ autopilot: settings })
  // Újra bekapcsoláskor a lejárat-sorozat számlálása (autoDisable) nullázódik: egy korábbi, már egyszer
  // kikapcsolást kiváltó lejárat ne keveredjen bele az új bekapcsolás utáni számlálásba.
  if (settings.enabled && !prev.enabled) saveSettings({ autopilotEnabledAt: Math.floor(Date.now() / 1000) })
  return { ok: true, settings }
})
