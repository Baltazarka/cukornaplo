import { autopilotSettings } from '../../utils/autopilot'

export default defineEventHandler(() => {
  return { settings: autopilotSettings() }
})
