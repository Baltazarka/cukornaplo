// Napi nézet adatai: glükózgörbe, inzulin, szénhidrát, napi statisztikák és 14 napos összesítő.
import { db, MANUAL_SOURCE } from '../utils/db'
import { AUTO_BASAL_SOURCE } from '../utils/basalAuto'
import { glucoseStats, RANGE_LOW, RANGE_HIGH, RANGE_VERY_LOW, RANGE_VERY_HIGH } from '../utils/stats'
import { targetRange } from '../utils/range'
import { hmInTz, startOfDayTs, todayYmd, addDaysYmd, huWeekday } from '../utils/time'
import { groupByDay, summaryRows } from '../utils/summary'
import { therapy, daySegments, shiftSchedule, shiftOn, profileOn } from '../utils/therapy'
import { scheduledShift } from '#shared/utils/shift'
import { changeTime, lastTrend } from '../utils/trend'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from '../utils/insulinKind'
import { notesBetween } from '../utils/notes'
import { rapidDoses, iobAt, bolusPeak } from '../utils/iob'
import { detectHypos, hypoCount } from '../utils/hypo'
import { carbCurve, cobAt, absorbCategory } from '../utils/absorption'
import { excludedBetween } from '../utils/excluded'

/** A kalkulátor eltárolt bontása (étel / korrekció / aktív inzulin); hibás JSON-nál nincs. */
function parseCalc(s: string): Record<string, number> | null {
  try { return JSON.parse(s) } catch { return null }
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const { low, high } = targetRange()
  const today = todayYmd()
  let day = typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today
  if (day > today) day = today

  const dayStart = startOfDayTs(day)
  const dayEnd = startOfDayTs(addDaysYmd(day, 1))
  const rangeStart = startOfDayTs(addDaysYmd(day, -13))

  const allRows = db()
    .prepare('SELECT id, type, ts, value, subtype, source, fat, protein, calc, excluded FROM entries WHERE ts >= ? AND ts < ? ORDER BY ts')
    .all(rangeStart, dayEnd) as any[]
  // A kizárt szenzorértékek (pl. ráfekvés) semmibe nem számítanak, csak a grafikonon látszanak szürkén.
  const rows = allRows.filter((r) => !r.excluded)
  const excludedGlucose = allRows.filter((r) => r.excluded && Number(r.ts) >= dayStart).map((r) => [Number(r.ts) * 1000, Number(r.value)])

  const dayRows = { glucose: [] as any[], insulin: [] as any[], carbs: [] as any[] }
  // Kézzel felvitt vércukor: pontos mérés, a statisztikákba beleszámít, de külön listában (a naplóban és a grafikonon
  // jelölve); a görbét, a trendet és a szenzorlefedettséget csak a szenzoradat adja.
  const manualGlucose: { id: number; ts: number; v: number }[] = []
  const daily = groupByDay(rows)
  const allGlucose: number[] = []

  for (const r of rows) {
    const ts = Number(r.ts)
    const v = Number(r.value)
    if (r.type === 'glucose' && r.source === MANUAL_SOURCE) {
      allGlucose.push(v)
      if (ts >= dayStart) manualGlucose.push({ id: Number(r.id), ts, v })
      continue
    }
    if (r.type === 'glucose') allGlucose.push(v)
    if (ts >= dayStart) {
      dayRows[r.type as 'glucose' | 'insulin' | 'carbs'].push({
        id: Number(r.id), ts, v, sub: r.subtype, src: r.source,
        ...(r.type === 'carbs' ? { fat: r.fat == null ? null : Number(r.fat), protein: r.protein == null ? null : Number(r.protein) } : {}),
        ...(r.type === 'insulin' && r.calc ? { calc: parseCalc(r.calc) } : {}),
      })
    }
  }

  // Bólusok besorolása (étkezési / korrekció / bázis): a nap széleinél a szomszédos napok CH-ja is számít.
  const carbTs = carbTimes(dayStart - 8 * 3600 - MEAL_WINDOW_SEC, dayEnd + PREBOLUS_SEC)
  for (const e of dayRows.insulin) Object.assign(e, insulinKind(e.ts, e.sub, carbTs, e.v))

  const dayStats = glucoseStats([...dayRows.glucose.map((g) => g.v), ...manualGlucose.map((g) => g.v)], low, high)
  const rangeStats = glucoseStats(allGlucose, low, high)
  const dayInsulin = dayRows.insulin.reduce((a, e) => a + e.v, 0)
  const sumKind = (k: string) => dayRows.insulin.filter((e) => e.kind === k).reduce((a, e) => a + e.v, 0)
  const dayCarbs = dayRows.carbs.reduce((a, e) => a + e.v, 0)
  // Lefedettség: a mérések száma az eltelt időhöz képest (ma csak a mostanáig eltelt rész számít).
  const elapsedSec = Math.min(dayEnd, Math.floor(Date.now() / 1000)) - dayStart
  const coverage = dayRows.glucose.length && elapsedSec > 0 ? Math.min(100, (100 * dayRows.glucose.length) / (elapsedSec / 300)) : 0

  // Napló: inzulin + CH időrendben, mellé a legközelebbi (±10 perc) glükózérték.
  const events = [
    ...dayRows.insulin.map((e) => ({ ...e, type: 'insulin' as const })),
    ...dayRows.carbs.map((e) => ({ ...e, type: 'carbs' as const })),
    ...manualGlucose.map((e) => ({ ...e, type: 'glucose' as const, src: MANUAL_SOURCE, sub: null as string | null })),
  ].sort((a, b) => a.ts - b.ts || a.type.localeCompare(b.type))
  const nearestGlucose = (ts: number): number | null => {
    let best: number | null = null
    let bestDiff = 601
    for (const g of dayRows.glucose) {
      const d = Math.abs(g.ts - ts)
      if (d < bestDiff) { best = g.v; bestDiff = d }
    }
    return best
  }

  // A napi inzulin a beadás időpontja szerint számít (a naplózott adagok összege, becsült bázis nélkül).
  const summary = summaryRows(daily, day, 14, low, high)
  const activeInsulin = iobCurve(dayStart, dayEnd, carbTs)
  // A még aktív gyors hatású inzulin most (csak a mai napon, és ha a terápia be van állítva).
  const iobNow = activeInsulin && day === today ? round2(activeInsulin.at(Math.floor(Date.now() / 1000))) : null

  // Aktív szénhidrát (COB): a tanult felszívódási görbékkel; a nap elejét megelőző 8 óra étkezései is még hathatnak
  // (a leghosszabb felszívódás 8 óra, mint az előrejelzésben).
  const cobCarbs = rows
    .filter((e) => e.type === 'carbs' && Number(e.ts) >= dayStart - 8 * 3600)
    .map((e) => ({ ts: Number(e.ts), v: Number(e.value), sub: e.subtype ?? null }))
  // A nap előtti és utáni 8 óra vércukra: a grafikon meghosszabbított (átlógó) szakaszaihoz.
  const glucoseExt = (db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND (source IS NULL OR source != 'manual') AND ((ts >= ? AND ts < ?) OR (ts >= ? AND ts < ?)) AND excluded = 0 ORDER BY ts")
    .all(dayStart - 8 * 3600, dayStart, dayEnd, dayEnd + 8 * 3600) as { ts: number; value: number }[]).map((r) => [Number(r.ts) * 1000, Number(r.value)])
  const nowTs = Math.floor(Date.now() / 1000)
  const cobNow = day === today ? Math.round(cobAt(cobCarbs, nowTs) * 10) / 10 : null

  return {
    day,
    today,
    prev: addDaysYmd(day, -1),
    next: addDaysYmd(day, 1),
    label: day.replaceAll('-', '. ') + '., ' + huWeekday(day),
    dayStartMs: dayStart * 1000,
    dayEndMs: dayEnd * 1000,
    range: { veryLow: RANGE_VERY_LOW, low, high, veryHigh: RANGE_VERY_HIGH },
    glucose: dayRows.glucose.map((g) => [g.ts * 1000, g.v]),
    glucoseExt,
    excludedGlucose,
    // Váltott műszak: a nap műszakja (kézzel átállítva vagy a beosztás szerint), ha van beosztás.
    shift: shiftSchedule() ? { kind: shiftOn(day), scheduled: scheduledShift(shiftSchedule(), day) } : null,
    excluded: excludedBetween(dayStart - 8 * 3600, dayEnd + 8 * 3600).map((x) => ({ id: x.id, from: x.from * 1000, to: x.to * 1000 })),
    manualGlucose: manualGlucose.map((g) => [g.ts * 1000, g.v]),
    insulin: dayRows.insulin.map((e) => [e.ts * 1000, e.v, e.kind]),
    carbs: dayRows.carbs.map((e) => [e.ts * 1000, e.v, e.sub === 'fatty' || e.sub === 'fast' ? e.sub : null]),
    events: events.map((e) => ({
      id: e.id, ts: e.ts * 1000, time: hmInTz(e.ts), type: e.type, sub: e.sub ?? null, v: e.v, glucose: nearestGlucose(e.ts),
      kind: (e as any).kind ?? null, auto: (e as any).auto ?? false, noCarbs: (e as any).noCarbs ?? false,
      manual: e.src === MANUAL_SOURCE,
      autoBasal: e.src === AUTO_BASAL_SOURCE,
      ...(e.type === 'carbs' ? { fat: (e as any).fat ?? null, protein: (e as any).protein ?? null } : {}),
      ...(e.type === 'insulin' ? { calc: (e as any).calc ?? null } : {}),
    })),
    stats: { day: dayStats, range14: rangeStats },
    totals: {
      insulin: dayInsulin,
      meal: sumKind('meal'),
      correction: sumKind('correction'),
      basal: sumKind('basal'),
      carbs: dayCarbs,
    },
    iobNow,
    cobNow,
    // Étkezésenként a felszívódási görbe (15 percenként, 0–480 perc), az aktív CH görbéhez.
    absorption: { carbs: cobCarbs.map((c) => [c.ts * 1000, c.v, c.sub === 'fatty' || c.sub === 'fast' ? c.sub : null, carbCurve(absorbCategory(c.sub), c.v)]) },
    trend: lastTrend(dayRows.glucose),
    hypos: hypoCount(detectHypos([...dayRows.glucose, ...manualGlucose].sort((a, b) => a.ts - b.ts), low, RANGE_VERY_LOW)),
    change: changeTime(dayRows.glucose),
    coverage,
    summary,
    activeInsulin: activeInsulin && { ...activeInsulin, at: undefined },
    segments: segmentsFor(day),
    notes: notesBetween(dayStart, dayEnd).map((n) => ({ id: n.id, ts: n.ts * 1000, time: n.time, tags: n.tags, text: n.text })),
  }
})

/**
 * A bólusok még aktív (hatásban lévő) inzulinja a napon, E-ben, 5 percenként: a terápiás beállítások
 * inzulinjának csúcsidejével és hatásidejével (exponenciális modell). Az előző este beadott adagok
 * is beleszámítanak. Terápiás beállítás nélkül null.
 */
function iobCurve(dayStart: number, dayEnd: number, carbTs: number[]) {
  const t = therapy()
  if (!t) return null
  const info = insulinById(t.bolusInsulin)
  const peak = bolusPeak(t)
  // A hatásidő a beadás napszakáé (ha ott külön meg van adva), különben a közös érték.
  const doses = rapidDoses(t, dayStart, dayEnd, carbTs)
  const at = (ts: number, inclusive: boolean) => iobAt(doses, ts, inclusive)
  // 5 perces rács, plusz minden adag pillanata előtte és utána, hogy az ugrás függőleges legyen.
  const times = new Set<number>()
  for (let ts = dayStart; ts <= dayEnd; ts += 300) times.add(ts)
  const jumps = new Set<number>()
  for (const d of doses) if (d.ts >= dayStart) { times.add(d.ts); jumps.add(d.ts) }
  const points: [number, number | null][] = []
  for (const ts of [...times].sort((a, b) => a - b)) {
    if (jumps.has(ts)) points.push([ts * 1000 - 1, round2(at(ts, false))])
    const v = at(ts, true)
    points.push([ts * 1000, v >= 0.01 ? round2(v) : 0])
  }
  // A nullás szakaszokat kihagyjuk (ne fusson vonal az alapvonalon), a szélük 0 marad.
  const out = points.map((p, i) =>
    p[1] === 0 && (points[i - 1]?.[1] ?? 0) === 0 && (points[i + 1]?.[1] ?? 0) === 0 ? [p[0], null] : p,
  )
  return {
    insulin: info?.name ?? null,
    peakMinutes: peak,
    durationMinutes: t.actionMinutes,
    points: out,
    // Az egyes bólusok (az előző esti, még ható adagokkal együtt) a saját görbéjükhöz:
    // [időpont ms, adag E, hatásidő perc, típus].
    doses: doses.map((d) => [d.ts * 1000, d.v, d.dia, d.kind]),
    /** A még aktív inzulin (E) egy adott pillanatban (unix mp). */
    at: (ts: number) => at(ts, true),
  }
}

/** A terápiás napszakok a napi grafikonhoz (ms), ha be vannak állítva. */
function segmentsFor(day: string) {
  const t = therapy()
  if (!t) return null
  return {
    byTimeOfDay: t.byTimeOfDay,
    // Váltott műszaknál: a délutános hétre beállított napszakok érvényesek-e ezen a napon.
    profile: profileOn(t, day),
    list: daySegments(t, day).map((s) => ({ ...s, from: s.from * 1000, to: s.to * 1000 })),
  }
}

function carbTimes(from: number, to: number): number[] {
  return (db().prepare("SELECT ts FROM entries WHERE type = 'carbs' AND ts >= ? AND ts < ?").all(from, to) as any[]).map((r) => Number(r.ts))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
