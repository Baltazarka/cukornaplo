// Az /api/** végpontokat munkamenethez köti, kivéve az adatfogadót (saját X-Token) és a widget-végpontokat (szintén X-Token)
// és a hitelesítési végpontokat.
import { isAuthed } from '../utils/auth'
import { viewerOf } from '../utils/share'
import { tokenOk } from '../utils/widget'

// Órás kliens (Garmin): csak ezek a POST végpontok érhetők el az API-kulccsal (X-Token), munkamenet nélkül:
// CH / inzulin naplózása, az Autopilot-javaslat nyugtázása, a bólusz kalkulátor.
const TOKEN_POST_API = new Set(['/api/entry-add', '/api/autopilot/respond', '/api/watch-calc'])

// A megosztási linkkel belépett megtekintő csak ezeket olvashatja (GET), semmit nem módosíthat.
const VIEWER_API = new Set(['/api/day', '/api/agp', '/api/analysis', '/api/report', '/api/therapy', '/api/version', '/api/hypo', '/api/lab', '/api/profile', '/api/shifts'])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  if (!path.startsWith('/api/')) return
  if (path.startsWith('/api/ingest') || path.startsWith('/api/auth/') || path === '/api/widget' || path === '/api/widget-script') return

  if (await isAuthed(event)) return
  if (event.method === 'POST' && TOKEN_POST_API.has(path) && tokenOk(event)) return
  if (event.method === 'GET' && VIEWER_API.has(path) && (await viewerOf(event))) return
  setResponseStatus(event, 401)
  return { ok: false, error: 'Nincs bejelentkezve.' }
})
