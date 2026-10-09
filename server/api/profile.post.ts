// Személyes adatok mentése (csak a tulajdonos; a megtekintő POST-ot nem küldhet).
import { validateProfile } from '../utils/profile'

export default defineEventHandler(async (event) => {
  const v = validateProfile((await readBody(event)) ?? {})
  if (!v.ok) {
    setResponseStatus(event, 400)
    return { ok: false, errors: v.errors }
  }
  saveSettings({ profile: v.profile })
  return { ok: true, profile: v.profile }
})
