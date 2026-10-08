// Az /api/** végpontokat munkamenethez köti, kivéve az adatfogadót (saját X-Token)
// és a hitelesítési végpontokat.
import { isAuthed } from '../utils/auth'
import { viewerOf } from '../utils/share'

// A megosztási linkkel belépett megtekintő csak ezeket olvashatja (GET), semmit nem módosíthat.
const VIEWER_API = new Set(['/api/day', '/api/agp', '/api/analysis', '/api/report', '/api/therapy', '/api/version', '/api/hypo', '/api/lab'])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  if (!path.startsWith('/api/')) return
  if (path.startsWith('/api/ingest') || path.startsWith('/api/auth/')) return

  if (await isAuthed(event)) return
  if (event.method === 'GET' && VIEWER_API.has(path) && (await viewerOf(event))) return
  setResponseStatus(event, 401)
  return { ok: false, error: 'Nincs bejelentkezve.' }
})
