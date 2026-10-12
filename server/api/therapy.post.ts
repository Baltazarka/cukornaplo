// Terápiás beállítások mentése (kézi beállítás).
import { validateTherapy } from '../utils/therapy'
import { invalidateComputed } from '../utils/jobs'

export default defineEventHandler(async (event) => {
  const res = validateTherapy((await readBody(event)) ?? {})
  if (!res.ok) {
    setResponseStatus(event, 400)
    return { ok: false, errors: res.errors }
  }
  saveSettings({ therapy: res.therapy })
  invalidateComputed() // az elemzések és az előrejelzés-teszt a terápia beállításaitól függnek
  return { ok: true, therapy: res.therapy }
})
