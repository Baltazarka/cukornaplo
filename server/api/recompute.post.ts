// Kényszerített újraszámolás a Terápia oldalról: { kind: 'analysis' | 'accuracy', days, end? }. Visszaadja az új időpontot.
import { recompute, ACCURACY_DAYS } from '../utils/jobs'
import { ANALYSIS_DAYS } from '../utils/analysisCache'
import { todayYmd } from '../utils/time'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const kind = b.kind === 'accuracy' ? 'accuracy' : b.kind === 'analysis' ? 'analysis' : null
  const days = Number(b.days)
  if (!kind || !(kind === 'analysis' ? ANALYSIS_DAYS : ACCURACY_DAYS).includes(days)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen kérés.' }
  }
  const today = todayYmd()
  const end = typeof b.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.end) && b.end <= today ? b.end : today
  return { ok: true, computedAt: recompute(kind, days, end) }
})
