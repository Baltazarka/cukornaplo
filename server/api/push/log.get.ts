// A kiküldött push értesítések naplója (a legújabb elöl): ?limit=1–200 (alap: 50).
import { pushLog } from '../../utils/push'

export default defineEventHandler((event) => {
  const n = Number(getQuery(event).limit)
  const limit = Number.isInteger(n) && n >= 1 && n <= 200 ? n : 50
  return { items: pushLog(limit) }
})
