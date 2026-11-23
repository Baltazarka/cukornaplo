// { id: number, action: 'accept' | 'decline', amount?: number (csak accept-nél, ha más mennyiséget adott be),
//   force?: boolean (csak accept-nél: a "közben más inzulin bejegyzés is született" figyelmeztetés után, ha a
//   felhasználó megerősítette, hogy mégis ezt is be akarja írni) }
import { acceptSuggestion, declineSuggestion } from '../../utils/autopilot'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen javaslat-azonosító.' }
  }
  if (body.action === 'accept') {
    const amount = body.amount != null ? Number(body.amount) : undefined
    const r = acceptSuggestion(id, amount, { force: body.force === true })
    if (!r.ok) setResponseStatus(event, 409)
    return r
  }
  if (body.action === 'decline') {
    const r = declineSuggestion(id)
    if (!r.ok) setResponseStatus(event, 409)
    return r
  }
  setResponseStatus(event, 400)
  return { ok: false, error: 'Ismeretlen művelet.' }
})
