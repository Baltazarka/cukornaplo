// Próbalevél a beállított címre (vagy a megadottra).
import { sendMail, mailSettings, EMAIL_RE } from '../../utils/mail'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const to = String(b.to || mailSettings().user).trim()
  if (!EMAIL_RE.test(to)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen címzett.' }
  }
  try {
    await sendMail(to, 'Cukornapló – próbalevél', 'Ez egy próbalevél a Cukornaplóból: az e-mail-küldés működik.', '<p>Ez egy próbalevél a <b>Cukornaplóból</b>: az e-mail-küldés működik.</p>')
    return { ok: true }
  } catch (e: any) {
    setResponseStatus(event, 502)
    return { ok: false, error: `A küldés nem sikerült: ${e?.message ?? e}` }
  }
})
