// Elemzés egy időszakra: tiszta étkezések és korrekciók napszakonként, étkezés utáni görbék,
// becslés a CH-arányra, ISF-re és hatásidőre. ?end=YYYY-MM-DD&days=7|14|30|60|90 (alap: 30 nap, ma).
import { analyze } from '../utils/analysis'
import { startOfDayTs, todayYmd, addDaysYmd } from '../utils/time'

const ALLOWED = [7, 14, 30, 60, 90]

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = ALLOWED.includes(Number(q.days)) ? Number(q.days) : 30
  const today = todayYmd()
  let end = typeof q.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.end) ? q.end : today
  if (end > today) end = today
  const start = addDaysYmd(end, -(days - 1))
  return { days, start, end, ...analyze(startOfDayTs(start), startOfDayTs(addDaysYmd(end, 1))) }
})
