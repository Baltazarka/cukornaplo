// Terápiás beállítások mentése (kézi beállítás).
import { validateTherapy } from '../utils/therapy'

export default defineEventHandler(async (event) => {
  const res = validateTherapy((await readBody(event)) ?? {})
  if (!res.ok) {
    setResponseStatus(event, 400)
    return { ok: false, errors: res.errors }
  }
  saveSettings({ therapy: res.therapy })
  return { ok: true, therapy: res.therapy }
})
