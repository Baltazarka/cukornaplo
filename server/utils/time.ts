// Időzóna-segédek a napi nézethez (minden "nap" az app időzónája szerinti naptári nap).
import { zonedToTs } from './normalize'

const TZ = process.env.APP_TZ || 'Europe/Budapest'

// Egyszer létrehozott formázó: soronként újat létrehozni 30 napnyi mérésnél (~8600 sor) lassú lenne.
const DTF = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
})

// Percenkénti gyorsítótár: a számolások (elemzés, előrejelzés-teszt) ugyanarra a percre sokszor kérdeznek rá,
// a formázás pedig drága. Méretkorláttal (betelve ürül).
const PARTS_CACHE_MAX = 200_000
const partsCache = new Map<number, Record<string, string>>()

function parts(ts: number): Record<string, string> {
  const minute = Math.floor(ts / 60)
  let p = partsCache.get(minute)
  if (p) return p
  p = {}
  for (const part of DTF.formatToParts(new Date(minute * 60_000))) p[part.type] = part.value
  if (partsCache.size >= PARTS_CACHE_MAX) partsCache.clear()
  partsCache.set(minute, p)
  return p
}

/** A nap hányadik perce (0–1439) az app időzónájában, faliórai idő szerint (nyári időnél is). */
export function minuteOfDayInTz(ts: number): number {
  const p = parts(ts)
  return Number(p.hour) * 60 + Number(p.minute)
}

export function ymdInTz(ts: number): string {
  const p = parts(ts)
  return `${p.year}-${p.month}-${p.day}`
}

export function hmInTz(ts: number): string {
  const p = parts(ts)
  return `${p.hour}:${p.minute}`
}

/** Létező naptári nap 'YYYY-MM-DD' alakban (a 02-31 és hasonlók nem). */
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, mo, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) === s
}

/** 'YYYY-MM-DD' adott zóna szerinti éjfélének unix másodperce. */
export function startOfDayTs(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map(Number)
  return zonedToTs(y, mo, d, 0, 0, 0)
}

export function todayYmd(): string {
  return ymdInTz(Math.floor(Date.now() / 1000))
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  return ymdInTz(zonedToTs(y, mo, d + days, 12, 0, 0))
}

const HU_DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat']
export function huWeekday(ymd: string): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  return HU_DAYS[dow]
}

/**
 * Faliidő → unix, a kézi bevitelhez: ősszel (óraátállításkor) a kétszer előforduló órában a `zonedToTs()` a későbbit
 * adja; ha az még a jövőben van, a korábbi (már elmúlt) időpont számít.
 */
export function wallToTs(ymd: string, hm: string, now = Math.floor(Date.now() / 1000)): number {
  const [y, mo, d] = ymd.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  const ts = zonedToTs(y, mo, d, h, mi, 0)
  const earlier = ts - 3600
  if (ts > now && ymdInTz(earlier) === ymd && hmInTz(earlier) === hm) return earlier
  return ts
}
