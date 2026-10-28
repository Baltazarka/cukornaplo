// Hitelesítés: jelszó (bcrypt, PHP-kompatibilis) + sütiben lezárt munkamenet.
import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'node:crypto'
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

/**
 * „Maradjak bejelentkezve”: tartós süti a böngészők felső határáig (400 nap); minden használatkor (naponta legfeljebb
 * egyszer) megújul, így amíg használod, nem jár le.
 */
export const REMEMBER_SEC = 400 * 86400
const REMEMBER_RENEW_SEC = 86400
const REMEMBER_COOKIE = 'cukornaplo_rem'

/** Be van-e kapcsolva a „maradjak bejelentkezve” ezen a böngészőn (a bejelentkezéskor beállított jelölősütiből). */
function rememberOn(event: H3Event): boolean {
  return getCookie(event, REMEMBER_COOKIE) === '1'
}

/** Bejelentkezéskor: a „maradjak bejelentkezve” jelölés rögzítése (tartós süti), vagy törlése. */
export function setRemember(event: H3Event, on: boolean): void {
  if (on) setCookie(event, REMEMBER_COOKIE, '1', { maxAge: REMEMBER_SEC, sameSite: 'lax', httpOnly: true, path: '/' })
  else deleteCookie(event, REMEMBER_COOKIE, { path: '/' })
}

export function clearRemember(event: H3Event): void {
  deleteCookie(event, REMEMBER_COOKIE, { path: '/' })
}

export function authSession(event: H3Event, opts?: { remember?: boolean }) {
  // auth: bejelentkezett tulajdonos (exp: lejárat, unix mp); viewer: ideiglenes, csak olvasható megtekintő (megosztási link).
  const remember = opts?.remember ?? rememberOn(event)
  return useSession<{ auth?: boolean; exp?: number; remember?: boolean; viewer?: { id: number }; challenge?: string }>(event, {
    password: sessionSecret(),
    name: 'cukornaplo_sess',
    // „Maradjak bejelentkezve”: tartós süti; különben a böngésző bezárásáig érvényes (munkamenet-süti).
    cookie: { sameSite: 'lax', ...(remember ? { maxAge: REMEMBER_SEC } : {}) },
  })
}

/** A bejelentkezett munkamenet adatai: a tulajdonos bejelentkezésének lejárati ideje is számít. */
/** Megjegyzés nélküli bejelentkezés érvényessége a szerveroldalon. */
const SESSION_SEC = 12 * 3600

export async function loginSession(event: H3Event, remember: boolean) {
  setRemember(event, remember)
  const session = await authSession(event, { remember })
  // Megjegyzés nélkül is lejár a szerveroldalon (12 óra), ha a böngésző nem zárul be és a süti megmarad.
  await session.update({ auth: true, remember, exp: Math.floor(Date.now() / 1000) + (remember ? REMEMBER_SEC : SESSION_SEC) })
  return session
}

export async function isAuthed(event: H3Event): Promise<boolean> {
  const session = await authSession(event)
  const d = session.data
  if (!d.auth) return false
  const now = Math.floor(Date.now() / 1000)
  if (d.exp && d.exp < now) return false
  // Megjegyzett bejelentkezés: használatkor megújul (a süti és a lejárat is), így nem jár le, amíg használod.
  // A jelölés a lezárt munkamenetből számít (a külön süti csak a süti élettartamát adja, kézzel nem kapcsolható be).
  if (d.remember && rememberOn(event) && (!d.exp || d.exp - now < REMEMBER_SEC - REMEMBER_RENEW_SEC)) {
    setRemember(event, true)
    await session.update({ exp: now + REMEMBER_SEC })
  }
  return true
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
  // 8 hexa karakter (XXXX-XXXX, ~4,3 milliárd lehetőség). A régi, rövidebb kódot lecseréljük.
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(code)) {
    const hex = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    code = `${hex.slice(0, 4)}-${hex.slice(4)}`
    saveSettings({ setup_code: code })
  }
  console.log(`[cukornaplo] Beállító kód: ${code}`)
  return code
}

/** A beküldött kód egyezik-e (kötőjel és kis/nagybetű nem számít; állandó idejű összehasonlítás). */
export function setupCodeMatches(sent: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^0-9A-F]/g, '')
  const a = Buffer.from(norm(sent))
  const b = Buffer.from(norm(setupCode()))
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---- bejelentkezési próbálkozások korlátozása (IP-nként) ----

/**
 * A kliens IP-címe a próbálkozás-korláthoz.
 *
 * Az X-Forwarded-For ELSŐ elemét a kliens szabadon beírhatja (a proxyk csak hozzáfűznek a
 * végéhez), így azzal minden próbálkozás más IP-nek látszana, és a tiltás sosem lépne életbe.
 * Ezért:
 *  - ha a CLIENT_IP_HEADER be van állítva (Cloudflare mögött: cf-connecting-ip), azt használjuk:
 *    ezt a Cloudflare mindig felülírja a valódi IP-vel;
 *  - különben az X-Forwarded-For UTOLSÓ elemét: ezt a legközelebbi reverse proxy írta;
 *  - proxy nélkül a kapcsolat IP-jét.
 */
function clientIp(event: H3Event): string {
  const header = (process.env.CLIENT_IP_HEADER || '').trim().toLowerCase()
  if (header) {
    const v = getHeader(event, header)?.split(',')[0]?.trim()
    if (v) return v
  }
  const xff = getHeader(event, 'x-forwarded-for')
  if (xff) {
    const last = xff.split(',').map((s) => s.trim()).filter(Boolean).pop()
    if (last) return last
  }
  return getRequestIP(event) ?? 'local'
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
