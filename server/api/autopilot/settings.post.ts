// Autopilot beállítások mentése.
import { validateApSettings } from '../../utils/autopilot'

export default defineEventHandler(async (event) => {
  const settings = validateApSettings((await readBody(event)) ?? {})
  saveSettings({ autopilot: settings })
  return { ok: true, settings }
})
