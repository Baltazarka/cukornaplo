// Hipóesemények egy időszakra az előzményeikkel. ?end=YYYY-MM-DD&days=7|14|30|60|90 (alap: 14 nap, ma).
import { hypoAnalysis } from '../utils/hypo'
import { startOfDayTs, todayYmd, addDaysYmd } from '../utils/time'

const ALLOWED = [7, 14, 30, 60, 90]

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = ALLOWED.includes(Number(q.days)) ? Number(q.days) : 14
  const today = todayYmd()
  let end = typeof q.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.end) ? q.end : today
  if (end > today) end = today
  const start = addDaysYmd(end, -(days - 1))
  return { days, start, end, ...hypoAnalysis(startOfDayTs(start), startOfDayTs(addDaysYmd(end, 1))) }
})
