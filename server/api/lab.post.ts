// Labor HbA1c felvétele: { date: 'YYYY-MM-DD', hba1c: % (4–15) vagy mmol/mol (20–140, átváltva) }.
import { db } from '../utils/db'
import { todayYmd } from '../utils/time'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null
  let v = Number(String(body.hba1c ?? '').replace(',', '.'))
  // 20 fölött IFCC-egységnek (mmol/mol) vesszük, és %-ra váltjuk.
  if (v >= 20 && v <= 140) v = v / 10.929 + 2.15
  if (!date || date > todayYmd()) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Adj meg egy dátumot (nem lehet a jövőben).' }
  }
  if (!Number.isFinite(v) || v < 4 || v > 15) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'A HbA1c 4 és 15% (vagy 20 és 140 mmol/mol) között lehet.' }
  }
  const info = db().prepare('INSERT INTO lab_results (date, hba1c, created_at) VALUES (?, ?, ?)')
    .run(date, Math.round(v * 10) / 10, Math.floor(Date.now() / 1000))
  return { ok: true, id: Number(info.lastInsertRowid) }
})
