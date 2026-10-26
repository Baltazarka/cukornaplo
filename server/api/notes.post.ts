// Új jegyzet: időpont (YYYY-MM-DD + HH:MM, az app időzónájában), címkék, szöveg.
import { markDirty } from '../utils/computed'
import { db } from '../utils/db'
import { wallToTs, isValidYmd } from '../utils/time'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const date = String(body.date ?? '')
  const time = String(body.time ?? '')
  if (!isValidYmd(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen dátum vagy időpont.' }
  }
  const allowed = new Set<string>(NOTE_TAGS.map((t) => t.id))
  const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).map(String))].filter((t) => allowed.has(t))
  const text = String(body.text ?? '').trim().slice(0, 500)
  if (!tags.length && !text) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Adj meg legalább egy címkét vagy szöveget.' }
  }
  const ts = wallToTs(date, time)
  if (ts > Math.floor(Date.now() / 1000) + 24 * 3600) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'A jegyzet ideje nem lehet a jövőben.' }
  }
  const info = db().prepare('INSERT INTO notes (ts, tags, text, created_at) VALUES (?, ?, ?, ?)')
    .run(ts, tags.join(','), text, Math.floor(Date.now() / 1000))
  markDirty()
  return { ok: true, id: Number(info.lastInsertRowid) }
})
