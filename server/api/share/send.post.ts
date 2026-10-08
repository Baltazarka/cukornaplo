// Megtekintési link küldése e-mailben (1 óráig érvényes, csak olvasás).
import { createShare, SHARE_TTL_SEC } from '../../utils/share'
import { sendMail, publicOrigin, mailSettings, EMAIL_RE, escapeHtml } from '../../utils/mail'
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
  const html = [
    '<p>Szia!</p>',
    `<p><b>${escapeHtml(sender)}</b> megosztotta veled a cukornaplóját. Az alábbi linken <b>${hours} óráig (${until}-ig)</b> megnézheted, csak olvasni lehet.</p>`,
    message ? `<p style="white-space:pre-wrap;border-left:3px solid #ccc;padding-left:10px">${escapeHtml(message)}</p>` : '',
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#2a78d6;color:#fff;border-radius:8px;text-decoration:none">Cukornapló megnyitása</a></p>`,
    `<p style="color:#888;font-size:12px">Ha a gomb nem működik: ${escapeHtml(link)}<br>Ha nem számítottál erre a levélre, nyugodtan hagyd figyelmen kívül.</p>`,
  ].join('\n')
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
