// Hitelesítés: jelszó (bcrypt, PHP-kompatibilis) + sütiben lezárt munkamenet.
import bcrypt from 'bcryptjs'
import type { H3Event } from 'h3'
import { db } from './db'

const LOGIN_MAX_FAILURES = 10
const LOGIN_WINDOW = 900

export function hasPassword(): boolean {
  return !!setting('password_hash')
}

export async function setPassword(pw: string): Promise<void> {
  saveSettings({ password_hash: await bcrypt.hash(pw, 10) })
}

export async function verifyPassword(pw: string): Promise<boolean> {
  const hash = String(setting('password_hash', '') ?? '')
  if (!hash) return false
  try {
    // A PHP $2y$ előtagú bcrypt-hash a bcryptjs-ben $2b$-ként ellenőrizhető (azonos algoritmus).
    return await bcrypt.compare(pw, hash.replace(/^\$2y\$/, '$2b$'))
  } catch {
    return false
  }
}

/** Stabil munkamenet-titok (legalább 32 kar), a settings.json-ban tárolva. */
function sessionSecret(): string {
  let s = String(setting('session_secret', '') ?? '')
  if (s.length < 32) {
    s = newToken() + newToken()
    saveSettings({ session_secret: s })
  }
  return s
}

export function getSession(event: H3Event) {
  return useSession<{ auth?: boolean }>(event, {
    password: sessionSecret(),
    name: 'cukornaplo_sess',
    cookie: { sameSite: 'lax' },
  })
}

export async function isAuthed(event: H3Event): Promise<boolean> {
  return !!(await getSession(event)).data.auth
}

export async function requireAuth(event: H3Event): Promise<void> {
  if (!(await isAuthed(event))) {
    throw createError({ statusCode: 401, statusMessage: 'Nincs bejelentkezve' })
  }
}

// ---- első beállítás védelme (nyilvános szerveren) ----

/** A kérés a szerver gépéről jön-e (ekkor nem kell beállító kód). */
export function isLocalRequest(event: H3Event): boolean {
  const xff = getHeader(event, 'x-forwarded-for')
  const remote = getRequestIP(event) ?? ''
  return !xff && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
}

/**
 * Egyszeri beállító kód az első jelszó megadásához. Nyilvános szerveren e nélkül
 * bárki, aki elsőként megnyitja az oldalt, beállíthatná a jelszót.
 * A kód a szerver naplójába kerül (Dockerben: docker logs).
 */
export function setupCode(): string {
  let code = String(setting('setup_code', '') ?? '')
  if (!code) {
    code = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    saveSettings({ setup_code: code })
  }
  console.log(`[cukornaplo] Beállító kód: ${code}`)
  return code
}

// ---- bejelentkezési próbálkozások korlátozása (IP-nként) ----

function clientIp(event: H3Event): string {
  return getRequestIP(event, { xForwardedFor: true }) ?? 'local'
}

/** 0 = most lehet; különben hány másodperc múlva. */
export function loginLockedFor(event: H3Event): number {
  const ip = clientIp(event)
  const now = Math.floor(Date.now() / 1000)
  const row = db()
    .prepare('SELECT COUNT(*) c, MIN(ts) mn FROM login_failures WHERE ip = ? AND ts > ?')
    .get(ip, now - LOGIN_WINDOW) as any
  return Number(row.c) >= LOGIN_MAX_FAILURES ? Math.max(1, Number(row.mn) + LOGIN_WINDOW - now) : 0
}

export function loginFailed(event: H3Event): void {
  const now = Math.floor(Date.now() / 1000)
  db().prepare('DELETE FROM login_failures WHERE ts < ?').run(now - LOGIN_WINDOW)
  db().prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)').run(clientIp(event), now)
}

export function loginSucceeded(event: H3Event): void {
  db().prepare('DELETE FROM login_failures WHERE ip = ?').run(clientIp(event))
}
