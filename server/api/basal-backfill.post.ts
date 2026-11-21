// A hiányzó bázisnapok pótlása: a mostani beállítás szerinti időponttal és adaggal, automatikus jelöléssel.
import { backfillBasal } from '../utils/basalAuto'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (body.confirm !== true) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Megerősítés szükséges.' }
  }
  return { ok: true, added: backfillBasal() }
})
