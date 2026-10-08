// Próbalevél a beállított címre (vagy a megadottra).
import { sendMail, mailSettings, EMAIL_RE, mailLayout } from '../../utils/mail'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const to = String(b.to || mailSettings().user).trim()
  if (!EMAIL_RE.test(to)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen címzett.' }
  }
  try {
    await sendMail(to, 'Cukornapló – próbalevél', 'Ez egy próbalevél a Cukornaplóból: az e-mail-küldés működik.', mailLayout({
      title: 'Próbalevél',
      preheader: 'Az e-mail-küldés működik.',
      bodyHtml: '<p style="margin:0 0 16px">Ez egy próbalevél a Cukornaplóból: <b>az e-mail-küldés működik</b> ✅</p>',
      footerHtml: 'Ezt a levelet a Beállítások → E-mail oldalról indítottad.',
    }))
    return { ok: true }
  } catch (e: any) {
    setResponseStatus(event, 502)
    return { ok: false, error: `A küldés nem sikerült: ${e?.message ?? e}` }
  }
})
