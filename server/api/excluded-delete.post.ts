// Kizárt szenzorszakasz visszavonása: { id }. Az értékei újra beleszámítanak.
import { removeExcluded } from '../utils/excluded'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  if (!Number.isInteger(id) || !removeExcluded(id)) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'Nincs ilyen kizárt szakasz.' }
  }
  return { ok: true }
})
