import { suggestionHistory } from '../../utils/autopilot'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = Number(q.days)
  return { items: suggestionHistory(Number.isFinite(days) && days > 0 ? days : 7) }
})
