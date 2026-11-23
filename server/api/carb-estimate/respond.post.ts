// { id: number, action: 'accept' | 'decline', grams?: number (csak accept-nél, ha a felhasználó módosítja a becslést) }
import { acceptCarbEstimate, declineCarbEstimate } from '../../utils/carbEstimate'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen becslés-azonosító.' }
  }
  if (body.action === 'accept') {
    const grams = Math.round(Number(body.grams))
    if (!Number.isFinite(grams) || grams < 1 || grams > 500) {
      setResponseStatus(event, 400)
      return { ok: false, error: 'A mennyiség 1–500 g lehet.' }
    }
    const r = acceptCarbEstimate(id, grams)
    if (!r.ok) setResponseStatus(event, 409)
    return r
  }
  if (body.action === 'decline') {
    if (!declineCarbEstimate(id)) {
      setResponseStatus(event, 409)
      return { ok: false, error: 'A becslés már nem érvényes.' }
    }
    return { ok: true }
  }
  setResponseStatus(event, 400)
  return { ok: false, error: 'Ismeretlen művelet.' }
})
