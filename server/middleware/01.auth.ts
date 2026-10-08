// Az /api/** végpontokat munkamenethez köti, kivéve az adatfogadót (saját X-Token)
// és a hitelesítési végpontokat.
import { isAuthed } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  if (!path.startsWith('/api/')) return
  if (path.startsWith('/api/ingest') || path.startsWith('/api/auth/')) return

  if (!(await isAuthed(event))) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Nincs bejelentkezve.' }
  }
})
