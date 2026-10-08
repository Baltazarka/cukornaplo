// Jegyzet törlése.
import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const id = Number(((await readBody(event)) ?? {}).id)
  const info = Number.isInteger(id) ? db().prepare('DELETE FROM notes WHERE id = ?').run(id) : { changes: 0 }
  if (Number(info.changes) === 0) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'Nincs ilyen jegyzet.' }
  }
  return { ok: true }
})
