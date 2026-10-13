// Elemzés egy időszakra (tárolt, éjszaka újraszámolt eredmény): tiszta étkezések és korrekciók napszakonként, étkezés utáni görbék,
// becslés a CH-arányra, ISF-re és hatásidőre. ?end=YYYY-MM-DD&days=7|14|30|60|90 (alap: 30 nap, ma).
import { analysisCached } from '../utils/analysisCache'
import { todayYmd, addDaysYmd } from '../utils/time'

const ALLOWED = [7, 14, 30, 60, 90]

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = ALLOWED.includes(Number(q.days)) ? Number(q.days) : 30
  const today = todayYmd()
  let end = typeof q.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.end) ? q.end : today
  if (end > today) end = today
  // Korlátlan számú tárolt sor ellen: legfeljebb egy évvel ezelőttig, és csak valós naptári nap.
  if (end < addDaysYmd(today, -400) || addDaysYmd(end, 0) !== end) end = today
  // Előre kiszámolt eredmény (éjszaka frissül); `computedAt` a számolás ideje.
  const r = analysisCached(days, end)
  return { ...r.data, computedAt: r.at }
})
