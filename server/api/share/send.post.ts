// Megtekintési link küldése e-mailben (1 óráig érvényes, csak olvasás).
import { createShare, SHARE_TTL_SEC } from '../../utils/share'
import { sendMail, publicOrigin, mailSettings, EMAIL_RE, escapeHtml, mailLayout } from '../../utils/mail'
import { hmInTz } from '../../utils/time'
import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const email = String(b.email ?? '').trim()
  const message = String(b.message ?? '').trim().slice(0, 500)
  if (!EMAIL_RE.test(email)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen e-mail-cím.' }
  }
  const { token, id, expiresAt } = createShare(email)
  const link = `${publicOrigin(event)}/megosztas?t=${token}`
  const sender = mailSettings().fromName || 'Cukornapló'
  const until = hmInTz(expiresAt)
  const hours = SHARE_TTL_SEC / 3600
  const text = [
    'Szia!',
    '',
    `${sender} megosztotta veled a cukornaplóját. Az alábbi linken ${hours} óráig (${until}-ig) megnézheted, csak olvasni lehet.`,
    ...(message ? ['', message] : []),
    '',
    link,
    '',
    'Ha nem számítottál erre a levélre, nyugodtan hagyd figyelmen kívül.',
  ].join('\n')
  const html = mailLayout({
    title: 'Megosztott cukornapló',
    preheader: `${sender} megosztotta veled a cukornaplóját – ${until}-ig megnézheted.`,
    bodyHtml: [
      `<p style="margin:0 0 16px"><b>${escapeHtml(sender)}</b> megosztotta veled a cukornaplóját. A linken keresztül megnézheted az adatokat, de módosítani nem lehet.</p>`,
      message ? `<p style="margin:0 0 16px;padding:12px 16px;background:#f3f6fb;border-left:4px solid #2a78d6;border-radius:6px;white-space:pre-wrap;font-style:italic">${escapeHtml(message)}</p>` : '',
      `<p style="margin:0 0 8px;padding:12px 16px;background:#fff7e6;border-radius:8px;font-size:15px">⏱ Érvényes: <b>${escapeHtml(until)}-ig</b> (${hours} óra)</p>`,
    ].join('\n'),
    button: { label: 'Cukornapló megnyitása', href: link },
    footerHtml: `Ha a gomb nem működik, másold be a böngészőbe:<br><a href="${escapeHtml(link)}" style="color:#2a78d6;word-break:break-all">${escapeHtml(link)}</a><br><br>Ha nem számítottál erre a levélre, nyugodtan hagyd figyelmen kívül.`,
  })
  try {
    await sendMail(email, `Cukornapló – megtekintési link (${until}-ig érvényes)`, text, html)
  } catch (e: any) {
    // Ha a levél nem ment ki, a linket se hagyjuk érvényben.
    db().prepare('UPDATE share_tokens SET revoked = 1 WHERE id = ?').run(id)
    setResponseStatus(event, 502)
    return { ok: false, error: `A levél küldése nem sikerült: ${e?.message ?? e}` }
  }
  return { ok: true, expiresAt }
})
