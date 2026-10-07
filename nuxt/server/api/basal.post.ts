// A bázisadag (E): a típus nélkül pontosan ekkora adagként érkező inzulin bázisnak számít. Üres = kikapcsolva.
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (body.basal_dose === null || body.basal_dose === '') {
    saveSettings({ basal_dose: null })
    return { ok: true, basal_dose: null }
  }
  const n = Number(body.basal_dose)
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'A bázisadag 0 és 100 E között lehet.' }
  }
  saveSettings({ basal_dose: n })
  return { ok: true, basal_dose: n }
})
