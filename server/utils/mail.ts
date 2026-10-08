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

export const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
