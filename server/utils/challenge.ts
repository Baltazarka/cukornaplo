// „Kihívás” kártya: a mostani állapot (fut-e tiszta mérés, meddig kell tisztán tartani) és a napszak tiszta
// eseményeinek száma az elemzésből. A döntési mag: challengeCore.ts.
import { db } from './db'
import { therapy, segmentAt, profileOn, actionMinutesAt } from './therapy'
import { rapidDoses, iobAt } from './iob'
import { notesBetween } from './notes'
import { defaultTotalMin } from './absorption'
import { DISTURBING_TAGS, GOOD_EVENTS } from './analysis'
import { analysisCached } from './analysisCache'
import { todayYmd, ymdInTz } from './time'
import { challengeState, type ChCarb, type ChDose } from './challengeCore'

const LOOKBACK_SEC = 14 * 3600

export function challengeNow(now = Math.floor(Date.now() / 1000)) {
  const t = therapy()
  if (!t) return null
  const from = now - LOOKBACK_SEC
  const carbRows = db()
    .prepare("SELECT ts, value, subtype FROM entries WHERE type = 'carbs' AND ts >= ? AND ts <= ? AND excluded = 0 ORDER BY ts")
    .all(from - 3 * 3600, now) as { ts: number; value: number; subtype: string | null }[]
  const carbs: ChCarb[] = carbRows.map((r) => ({ ts: Number(r.ts), v: Number(r.value), fatty: r.subtype === 'fatty', fast: r.subtype === 'fast' }))
  const rapid = rapidDoses(t, from, now + 1, carbs.map((c) => c.ts))
  const doses: ChDose[] = rapid.filter((d) => d.ts >= from && d.kind !== 'basal').map((d) => ({ ts: d.ts, v: d.v, kind: d.kind as 'meal' | 'correction' }))
  const noteTs = notesBetween(from - 2 * 3600, now + 1).filter((n) => n.tags.some((x) => DISTURBING_TAGS.includes(x))).map((n) => n.ts)
  const state = challengeState({
    now, carbs, doses, noteTs,
    diaMin: (ts) => actionMinutesAt(t, ts),
    iobBefore: (ts) => iobAt(rapid, ts, false),
    iobNow: iobAt(rapid, now),
    absorbMin: (c) => defaultTotalMin(c.fatty ? 'fatty' : c.fast ? 'fast' : 'normal', c.grams),
  })

  // A mostani napszak tiszta eseményeinek száma az elmúlt 14 napból (az elemzés tárolt eredménye).
  const a = analysisCached(14, todayYmd()).data
  const alt = !!t.altEnabled && !!t.altSegments?.length && t.byTimeOfDay && profileOn(t, ymdInTz(now)) === 'alt'
  const idx = alt ? t.altSegments!.indexOf(segmentAt(t, now)) : t.segments.indexOf(segmentAt(t, now, true))
  const seg = (alt ? a.altSegments : a.segments)[idx]
  return {
    state,
    segment: seg ? { start: seg.start, end: seg.end, cleanCorrections: seg.counts.cleanCorrections, cleanMeals: seg.counts.cleanMeals, good: GOOD_EVENTS } : null,
  }
}
