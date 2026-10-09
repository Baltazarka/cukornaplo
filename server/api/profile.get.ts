// Személyes adatok. A megosztási linkkel nézőnek a TAJ-szám csak engedélyezve jár.
import { profile, profileForViewer } from '../utils/profile'
import { isAuthed } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const p = profile()
  return { profile: (await isAuthed(event)) ? p : profileForViewer(p) }
})
