// Levélküldés SMTP-n (alapból Gmail). A beállítások a settings.json `mail` kulcsa alatt; a jelszó
// (Gmailnél alkalmazásjelszó) soha nem megy vissza a felületre.
import nodemailer from 'nodemailer'
import type { H3Event } from 'h3'

export interface MailSettings {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  fromName: string
  /** Az oldal nyilvános címe a linkekhez (pl. https://vc.baltazarka.com); üresen a kérésből. */
  publicUrl: string
}

const DEFAULTS: MailSettings = { host: 'smtp.gmail.com', port: 465, secure: true, user: '', pass: '', fromName: 'Cukornapló', publicUrl: '' }

export function mailSettings(): MailSettings {
  return { ...DEFAULTS, ...(setting<Partial<MailSettings>>('mail', null) ?? {}) }
}

export function mailConfigured(): boolean {
  const m = mailSettings()
  return !!(m.host && m.user && m.pass)
}

export async function sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
  const m = mailSettings()
  if (!mailConfigured()) throw new Error('Az e-mail-küldés nincs beállítva (Beállítások → E-mail).')
  const transport = nodemailer.createTransport({
    host: m.host, port: m.port, secure: m.secure,
    auth: { user: m.user, pass: m.pass },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  })
  await transport.sendMail({ from: { name: m.fromName || 'Cukornapló', address: m.user }, to, subject, text, html })
}

/** Az oldal nyilvános címe: a beállított, vagy a kérés alapján (Cloudflare/proxy mögött is). */
export function publicOrigin(event: H3Event): string {
  const set = mailSettings().publicUrl.trim().replace(/\/+$/, '')
  if (set) return set
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

interface LayoutOpts {
  title: string
  /** Már escape-elt HTML a törzshöz. */
  bodyHtml: string
  button?: { label: string; href: string }
  /** Már escape-elt HTML a gomb alatti kis szövegbe. */
  footerHtml?: string
  /** A levelezőben a tárgy mellett látszó előnézet. */
  preheader?: string
  /** Fejléc- és gombszín (alap: az app kékje). */
  accent?: string
}

/** Egységes, táblázatos (levelezőkompatibilis) levélkeret: szürke háttér, fehér kártya, kék fejléc, nagy gomb. */
export function mailLayout(o: LayoutOpts): string {
  const brand = escapeHtml(mailSettings().fromName || 'Cukornapló')
  const accent = /^#[0-9a-f]{6}$/i.test(o.accent ?? '') ? o.accent! : '#2a78d6'
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const button = o.button
    ? `<tr><td align="center" style="padding:8px 32px 28px">
        <a href="${escapeHtml(o.button.href)}" style="display:inline-block;padding:14px 32px;background:${accent};color:#ffffff;font-size:16px;font-weight:600;border-radius:10px;text-decoration:none">${escapeHtml(o.button.label)}</a>
      </td></tr>`
    : ''
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escapeHtml(o.title)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:${font};color:#1f2937">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(o.preheader ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <tr><td style="background:${accent};padding:20px 32px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.2px">🩸 ${brand}</td></tr>
    <tr><td style="padding:28px 32px 12px;font-size:16px;line-height:1.55">
      <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#111827">${escapeHtml(o.title)}</h1>
      ${o.bodyHtml}
    </td></tr>
    ${button}
    <tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">${o.footerHtml ?? ''}</td></tr>
  </table>
</td></tr></table>
</body></html>`
}

export interface StatItem { label: string; value: string; note?: string; color?: string }

/** Számkártyák rácsa a levélben (levelezőkompatibilis táblázat), soronként `cols` darab. */
export function mailStats(items: StatItem[], cols = 3): string {
  const w = Math.floor(100 / cols)
  const rows: string[] = []
  for (let i = 0; i < items.length; i += cols) {
    const cells = items.slice(i, i + cols).map((it) => `<td width="${w}%" valign="top" style="padding:4px">
        <div style="background:#f3f6fb;border-radius:10px;padding:10px 12px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.4px">${escapeHtml(it.label)}</div>
          <div style="font-size:22px;font-weight:700;line-height:1.3;color:${it.color ?? '#111827'}">${escapeHtml(it.value)}</div>
          ${it.note ? `<div style="font-size:12px;color:#6b7280">${escapeHtml(it.note)}</div>` : ''}
        </div></td>`).join('')
    const pad = '<td></td>'.repeat(Math.max(0, cols - items.slice(i, i + cols).length))
    rows.push(`<tr>${cells}${pad}</tr>`)
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px">${rows.join('')}</table>`
}

/** Vízszintes sáv a tartományok megoszlásáról (kicsi / alacsony / cél / magas / nagyon magas, %). */
export function mailRangeBar(pct: { veryLow: number; low: number; inRange: number; high: number; veryHigh: number }): string {
  const parts: [number, string][] = [[pct.veryLow, '#a31f1f'], [pct.low, '#e0494b'], [pct.inRange, '#2e9e5b'], [pct.high, '#f0a93a'], [pct.veryHigh, '#e0782a']]
  const cells = parts.filter(([v]) => v >= 0.5).map(([v, c]) => `<td width="${v.toFixed(1)}%" style="background:${c};height:12px;font-size:0;line-height:0">&nbsp;</td>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;border-radius:6px;overflow:hidden"><tr>${cells}</tr></table>`
}

export const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
