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
}

/** Egységes, táblázatos (levelezőkompatibilis) levélkeret: szürke háttér, fehér kártya, kék fejléc, nagy gomb. */
export function mailLayout(o: LayoutOpts): string {
  const brand = escapeHtml(mailSettings().fromName || 'Cukornapló')
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const button = o.button
    ? `<tr><td align="center" style="padding:8px 32px 28px">
        <a href="${escapeHtml(o.button.href)}" style="display:inline-block;padding:14px 32px;background:#2a78d6;color:#ffffff;font-size:16px;font-weight:600;border-radius:10px;text-decoration:none">${escapeHtml(o.button.label)}</a>
      </td></tr>`
    : ''
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escapeHtml(o.title)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:${font};color:#1f2937">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(o.preheader ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <tr><td style="background:#2a78d6;padding:20px 32px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.2px">🩸 ${brand}</td></tr>
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

export const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
