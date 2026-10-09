import { notifySettings, notifyState } from '../../utils/notify'

export default defineEventHandler(() => {
  const st = notifyState()
  return { settings: notifySettings(), lastHypo: st.lastHypo ?? null, lastCarbs: st.lastCarbs ?? null, lastInsulin: st.lastInsulin ?? null, lastError: st.lastError ?? null }
})
