import { autopilotSettings, pendingSuggestion, suggestionHistory } from '../../utils/autopilot'
import { predictGlucose } from '../../utils/predict'

export default defineEventHandler(() => {
  const settings = autopilotSettings()
  const pending = pendingSuggestion()
  const last = suggestionHistory(14).find((s) => s.status !== 'pending') ?? null
  const p = predictGlucose(30)
  return {
    settings,
    pending,
    lastDecision: last,
    context: p ? { now: p.now, iob: p.iob, cob: p.cob, eventual: p.eventual, risk: p.risk } : null,
  }
})
