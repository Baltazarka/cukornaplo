// Megtekintési link küldése e-mailben (1 óráig érvényes, csak olvasás).
import { createShare, SHARE_TTL_SEC } from '../../utils/share'
import { sendMail, publicOrigin, mailSettings, EMAIL_RE, escapeHtml, mailLayout, mailStats } from '../../utils/mail'
import { latestGlucose, periodDigest, fmt1, fmtPct } from '../../utils/digest'
import { todayYmd } from '../../utils/time'
import { hmInTz } from '../../utils/time'
import { db } from '../../utils/db'
import { sgText } from '#shared/utils/glucose'

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
  // Rövid összefoglaló a levélbe: utolsó érték, a mai nap és az elmúlt 7 nap. Hiba esetén kimarad.
  let summaryText: string[] = []
  let summaryHtml = ''
  try {
    const last = latestGlucose()
    const day = periodDigest(todayYmd(), 1)
    const week = periodDigest(todayYmd(), 7)
    if (last || day.stats.n || week.stats.n) {
      const pct = (d: typeof day) => (d.stats.n ? d.stats.pct!.inRange : null)
      const items = [
        ...(last ? [{ label: 'Utolsó érték', value: `${sgText(last.v)} ${last.arrow}`, note: `${last.time}-kor, mmol/L` }] : []),
        ...(day.stats.n ? [{ label: 'Ma', value: fmt1(day.stats.avg), note: `átlag · célban ${fmtPct(pct(day))}` }] : []),
        ...(week.stats.n ? [{ label: '7 nap', value: fmt1(week.stats.avg), note: `átlag · célban ${fmtPct(pct(week))}` }] : []),
      ]
      summaryHtml = mailStats(items, items.length)
      summaryText = [
        ...(last ? [`Utolsó érték: ${sgText(last.v)} mmol/L ${last.arrow} (${last.time})`] : []),
        ...(day.stats.n ? [`Ma: átlag ${fmt1(day.stats.avg)}, célban ${fmtPct(pct(day))}`] : []),
        ...(week.stats.n ? [`7 nap: átlag ${fmt1(week.stats.avg)}, célban ${fmtPct(pct(week))}`] : []),
      ]
    }
  } catch { /* az összefoglaló nem létfontosságú */ }
  const text = [
    'Szia!',
    '',
    `${sender} megosztotta veled a cukornaplóját. Az alábbi linken ${hours} óráig (${until}-ig) megnézheted, csak olvasni lehet.`,
    ...(message ? ['', message] : []),
    ...(summaryText.length ? ['', ...summaryText] : []),
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
      summaryHtml,
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
