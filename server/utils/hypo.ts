// Hipóesemények a CGM-adatokból, a nemzetközi konszenzus szerint (Battelino és mtsai, 2023):
//  - esemény: legalább 15 percig a céltartomány alja (alap 3,9 mmol/L) alatt;
//  - vége: legalább 15 percig újra fölötte (a közben visszaeső mérések ugyanahhoz az eseményhez tartoznak);
//  - 2. szint: közben legalább 15 percig 3,0 mmol/L alatt.
// Az elemzés minden eseményhez megkeresi, mi előzte meg (bólus, aktív inzulin, sport / alkohol
// jegyzet), mivel kezelted (szénhidrát), és mennyire ugrott fel utána a vércukor.
import { db } from './db'
import { therapy } from './therapy'
import { targetRange } from './range'
import { RANGE_VERY_LOW } from './stats'
import { notesBetween } from './notes'
import { insulinKind } from './insulinKind'
import { hmInTz, ymdInTz, minuteOfDayInTz, huWeekday } from './time'
import { rapidDoses, iobAt } from './iob'

const READ_SEC = 300 // CGM-mérésköz
const MIN_SEC = 15 * 60
const RECOVER_SEC = 15 * 60
const MAX_GAP_SEC = 20 * 60 // ennél hosszabb adatkiesés lezárja az eseményt
const BEFORE_SEC = 4 * 3600 // ennyi idővel előtte beadott bólust tekintünk „előzménynek”
const NOTE_BEFORE_SEC = 6 * 3600
const TREAT_SEC = 15 * 60 // a kezelés: a kezdet előtt / a vége után 15 percen belül bevitt CH
const REBOUND_SEC = 2 * 3600

export interface HypoSpan {
  start: number
  /** Az utolsó küszöb alatti mérés vége. */
  end: number
  minutes: number
  nadir: number
  nadirTs: number
  level: 1 | 2
  /** Még tart (az utolsó mérés is küszöb alatt, vagy még nem telt el 15 perc fölötte). */
  ongoing: boolean
}

/** Hipóesemények egy időrendbe rendezett mérési sorból. */
export function detectHypos(points: { ts: number; v: number }[], low: number, veryLow = RANGE_VERY_LOW): HypoSpan[] {
  const out: HypoSpan[] = []
  let cur: { start: number; lastBelow: number; nadir: number; nadirTs: number; l2: boolean; aboveFrom: number | null } | null = null
  let l2From: number | null = null
  let l2Last = 0
  let prevTs = -Infinity

  const close = (ongoing: boolean) => {
    if (cur && cur.lastBelow - cur.start + READ_SEC >= MIN_SEC) {
      out.push({
        start: cur.start, end: cur.lastBelow + READ_SEC, minutes: Math.round((cur.lastBelow - cur.start + READ_SEC) / 60),
        nadir: cur.nadir, nadirTs: cur.nadirTs, level: cur.l2 ? 2 : 1, ongoing,
      })
    }
    cur = null
    l2From = null
  }

  for (const p of points) {
    if (p.ts - prevTs > MAX_GAP_SEC) close(false)
    prevTs = p.ts
    if (p.v < low) {
      if (!cur) cur = { start: p.ts, lastBelow: p.ts, nadir: p.v, nadirTs: p.ts, l2: false, aboveFrom: null }
      cur.lastBelow = p.ts
      cur.aboveFrom = null
      if (p.v < cur.nadir) { cur.nadir = p.v; cur.nadirTs = p.ts }
      if (p.v < veryLow) {
        if (l2From == null) l2From = p.ts
        l2Last = p.ts
        if (l2Last - l2From + READ_SEC >= MIN_SEC) cur.l2 = true
      } else l2From = null
    } else {
      l2From = null
      if (cur) {
        cur.aboveFrom ??= p.ts
        if (p.ts - cur.aboveFrom + READ_SEC >= RECOVER_SEC) close(false)
      }
    }
  }
  // Az adatsor végén nyitva maradt esemény: ha az utolsó mérés friss, még tart.
  if (cur) close(Date.now() / 1000 - prevTs < MAX_GAP_SEC)
  return out
}

/** Rövid összesítés a csempékhez. */
export function hypoCount(spans: HypoSpan[]) {
  return { n: spans.length, level2: spans.filter((s) => s.level === 2).length, minutes: spans.reduce((a, s) => a + s.minutes, 0) }
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** Hipóelemzés egy időszakra [from, to): események az előzményeikkel és összesítés. */
export function hypoAnalysis(from: number, to: number) {
  const { low, high } = targetRange()
  const t = therapy()
  const glucose = (db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND ts >= ? AND ts < ? ORDER BY ts")
    .all(from - 2 * 3600, to + REBOUND_SEC) as any[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value) }))
  const other = db()
    .prepare("SELECT type, ts, value, subtype FROM entries WHERE type IN ('insulin', 'carbs') AND ts >= ? AND ts < ? ORDER BY ts")
    .all(from - BEFORE_SEC - 12 * 3600, to + REBOUND_SEC) as { type: string; ts: number; value: number; subtype: string | null }[]
  const carbs = other.filter((r) => r.type === 'carbs').map((r) => ({ ts: Number(r.ts), v: Number(r.value), fast: r.subtype === 'fast' }))
  const carbTs = carbs.map((c) => c.ts)
  const boluses = other
    .filter((r) => r.type === 'insulin')
    .map((r) => ({ ts: Number(r.ts), v: Number(r.value), kind: insulinKind(Number(r.ts), r.subtype, carbTs, Number(r.value)).kind }))
    .filter((b) => b.kind !== 'basal')
  const doses = t ? rapidDoses(t, from - 2 * 3600, to, carbTs) : []
  const notes = notesBetween(from - NOTE_BEFORE_SEC, to)

  const spans = detectHypos(glucose, low).filter((s) => s.start >= from && s.start < to)
  const events = spans.map((s) => {
    const bolus = boluses.filter((b) => b.ts <= s.start && b.ts >= s.start - BEFORE_SEC).at(-1) ?? null
    const treat = carbs.filter((c) => c.ts >= s.start - TREAT_SEC && c.ts <= s.end + TREAT_SEC)
    // A visszapattanás: a legmagasabb érték a vége utáni 2 órában (túlkezelés, ha a céltartomány fölé megy).
    let rebound: { v: number; ts: number } | null = null
    for (const g of glucose) {
      if (g.ts <= s.end || g.ts > s.end + REBOUND_SEC) continue
      if (!rebound || g.v > rebound.v) rebound = g
    }
    const near = notes.filter((n) => n.ts >= s.start - NOTE_BEFORE_SEC && n.ts <= s.end)
    const startMin = minuteOfDayInTz(s.start)
    return {
      start: s.start,
      date: ymdInTz(s.start),
      weekday: huWeekday(ymdInTz(s.start)),
      time: hmInTz(s.start),
      endTime: hmInTz(s.end),
      minutes: s.minutes,
      nadir: r1(s.nadir),
      level: s.level,
      ongoing: s.ongoing,
      night: startMin < 6 * 60,
      bolus: bolus && { v: bolus.v, kind: bolus.kind, minutesBefore: Math.round((s.start - bolus.ts) / 60) },
      iob: t ? r1(iobAt(doses, s.start)) : null,
      treatment: treat.length ? { carbs: treat.reduce((a, c) => a + c.v, 0), fast: treat.some((c) => c.fast) } : null,
      rebound: rebound && { v: r1(rebound.v), minutesAfter: Math.round((rebound.ts - s.end) / 60), over: rebound.v > high },
      notes: [...new Set(near.flatMap((n) => n.tags))],
      noteText: near.map((n) => n.text).filter(Boolean).join(' · '),
    }
  })

  const days = Math.max(1, (Math.min(to, Date.now() / 1000) - from) / 86400)
  const byHour = new Array(24).fill(0)
  for (const e of events) byHour[Number(e.time.slice(0, 2))]++
  const n = events.length
  return {
    low, veryLow: RANGE_VERY_LOW, high,
    therapySet: !!t,
    summary: {
      n,
      level2: events.filter((e) => e.level === 2).length,
      perWeek: r1((n / days) * 7),
      night: events.filter((e) => e.night).length,
      avgMinutes: n ? Math.round(events.reduce((a, e) => a + e.minutes, 0) / n) : null,
      totalMinutes: events.reduce((a, e) => a + e.minutes, 0),
      lowest: n ? Math.min(...events.map((e) => e.nadir)) : null,
      afterBolus: events.filter((e) => e.bolus).length,
      withSport: events.filter((e) => e.notes.includes('sport')).length,
      withAlcohol: events.filter((e) => e.notes.includes('alkohol')).length,
      treated: events.filter((e) => e.treatment).length,
      overTreated: events.filter((e) => e.rebound?.over).length,
      byHour,
    },
    events: events.reverse(), // a legfrissebb elöl
  }
}
