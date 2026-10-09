import { notifySettings, notifyState } from '../../utils/notify'
import { mailConfigured } from '../../utils/mail'

export default defineEventHandler(() => {
  const st = notifyState()
  return { settings: notifySettings(), mailReady: mailConfigured(), lastHypo: st.lastHypo ?? null, lastWeekly: st.lastWeekly ?? null, lastError: st.lastError ?? null }
})
