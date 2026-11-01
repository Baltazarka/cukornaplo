// Terápiás beállítások mentése (kézi beállítás).
import { validateTherapy, therapy, recordTherapy } from '../utils/therapy'
import { invalidateComputed } from '../utils/jobs'
import { checkBasalAuto } from '../utils/basalAuto'

export default defineEventHandler(async (event) => {
  const res = validateTherapy((await readBody(event)) ?? {})
  if (!res.ok) {
    setResponseStatus(event, 400)
    return { ok: false, errors: res.errors }
  }
  const prev = therapy()
  saveSettings({ therapy: res.therapy })
  recordTherapy(res.therapy, prev)
  invalidateComputed() // az elemzések és az előrejelzés-teszt a terápia beállításaitól függnek
  // Ha a bázis beírásának ideje ma már elmúlt, és még nincs bázis a naplóban, most kerül be (nem csak a következő percben).
  await checkBasalAuto().catch((e) => console.error('[bázis]', e))
  return { ok: true, therapy: res.therapy }
})
