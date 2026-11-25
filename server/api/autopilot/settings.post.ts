import { validateAutopilot } from '../../utils/autopilot'

export default defineEventHandler(async (event) => {
  const settings = validateAutopilot((await readBody(event)) ?? {})
  saveSettings({ autopilot: settings })
  return { ok: true, settings }
})
