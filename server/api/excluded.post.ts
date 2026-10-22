// Szenzorszakasz kizárása (pl. ráfekvés okozta hamis mély): { from, to } unix mp. Az időszak szenzorértékei
// kimaradnak minden számolásból (utils/excluded.ts).
import { addExcluded, EXCLUDE_MAX_SEC } from '../utils/excluded'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  let from = Math.round(Number(body.from))
  let to = Math.round(Number(body.to))
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen időszak.' }
  }
  if (to < from) [from, to] = [to, from]
  const now = Math.floor(Date.now() / 1000)
  if (to - from < 5 * 60 || to - from > EXCLUDE_MAX_SEC || from < now - 400 * 86400 || from > now) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'A kizárt szakasz 5 perc és 12 óra között lehet, a múltban.' }
  }
  return { ok: true, ...addExcluded(from, to) }
})
