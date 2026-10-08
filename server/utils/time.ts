// Időzóna-segédek a napi nézethez (minden "nap" az app időzónája szerinti naptári nap).
import { zonedToTs } from './normalize'

const TZ = process.env.APP_TZ || 'Europe/Budapest'

function parts(ts: number): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(ts * 1000))) p[part.type] = part.value
  return p
}

export function ymdInTz(ts: number): string {
  const p = parts(ts)
  return `${p.year}-${p.month}-${p.day}`
}

export function hmInTz(ts: number): string {
  const p = parts(ts)
  return `${p.hour}:${p.minute}`
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
