// A „Kihívás” kártya tiszta magja (nincs DB / óra): melyik tiszta mérés (korrekció, étkezés) fut most, és meddig kell
// tisztán tartani, hogy az elemzés (analysis.ts) beszámítsa. Az előfeltételek az elemzés `clean` szabályait követik,
// de egyszerűsítve (a szenzorgörbét nem nézi); a beszámításról végül az elemzés dönt.

export interface ChDose { ts: number; v: number; kind: 'meal' | 'correction' }
export interface ChCarb { ts: number; v: number; fatty: boolean; fast: boolean }
export interface ChInput {
  now: number
  carbs: ChCarb[]
  doses: ChDose[]
  /** Zavaró jegyzetek (sport, betegség, alkohol) időpontjai. */
  noteTs: number[]
  /** Az adag napszakának hatásideje, perc. */
  diaMin: (ts: number) => number
  /** Korábbi gyors inzulin még ható maradéka `ts`-kor (a `ts`-kori adag nélkül), E. */
  iobBefore: (ts: number) => number
  /** Aktív gyors inzulin most, E. */
  iobNow: number
  /** Egy étkezés teljes felszívódási ideje a mérete szerint, perc (alsó korlát: kategória ablaka). */
  absorbMin: (c: { grams: number; fatty: boolean; fast: boolean }) => number
}

export type ChState =
  | { kind: 'correction'; phase: 'running' | 'done' | 'broken'; start: number; until: number; dose: number; hours: number }
  | { kind: 'meal'; phase: 'running' | 'done' | 'broken'; start: number; until: number; carbs: number; hours: number }
  | { kind: 'busy'; iob: number; carbsUntil: number | null }
  | { kind: 'clear' }

type Measure = Extract<ChState, { phase: string }>

const MIN = 60
const CORR_PRE_MIN = 60
const CORR_LEFTOVER_MIN_E = 0.25
const CORR_LEFTOVER_FRAC = 0.15
/** Rövidített ablak: ennyi perc után még beszámít a megszakadt mérés (mint az analysis.ts TRUNC_MIN). */
const TRUNC_MIN = 180
const MEAL_JOIN_SEC = 30 * MIN
const MEAL_SPAN_MAX_SEC = 60 * MIN
const PRE_BOLUS_SEC = 60 * MIN
/** Az utolsó ennyi percig mutatjuk a lezárt / megszakadt mérést a vég után. */
const SHOW_AFTER_MIN = 120
const BUSY_IOB = 0.25

const fixedWindowMin = (c: { fatty: boolean; fast: boolean }) => (c.fatty ? 360 : c.fast ? 120 : 240)

function carbsAbsorbingAt(i: ChInput, groups: Group[], ts: number, except?: Group): boolean {
  return groups.some((g) => g !== except && g.ts < ts && ts - g.ts < Math.max(fixedWindowMin(g), i.absorbMin({ grams: g.carbs, fatty: g.fatty, fast: g.fast })) * MIN)
}

interface Group { ts: number; last: number; carbs: number; fatty: boolean; fast: boolean }
function mealGroups(carbs: ChCarb[]): Group[] {
  const out: Group[] = []
  let fastG = 0
  for (const c of [...carbs].sort((a, b) => a.ts - b.ts)) {
    const g = out.at(-1)
    if (g && c.ts - g.last <= MEAL_JOIN_SEC && c.ts - g.ts <= MEAL_SPAN_MAX_SEC) {
      g.last = c.ts
      g.carbs += c.v
      fastG += c.fast ? c.v : 0
      g.fatty ||= c.fatty
      g.fast = fastG * 2 > g.carbs
    } else {
      fastG = c.fast ? c.v : 0
      out.push({ ts: c.ts, last: c.ts, carbs: c.v, fatty: c.fatty, fast: c.fast })
    }
  }
  return out
}

/** Az első zavarás ideje (a méréstől `end`-ig, de legfeljebb `now`-ig), vagy Infinity. */
function firstDisturb(t0: number, end: number, now: number, ts: number[]): number {
  const lim = Math.min(end, now)
  return Math.min(...ts.filter((x) => x > t0 && x <= lim), Infinity)
}

function finish(kind: 'correction' | 'meal', start: number, end: number, disturbAt: number, now: number, extra: { dose?: number; carbs?: number }): Measure {
  const broken = Number.isFinite(disturbAt)
  const hours = ((broken ? disturbAt : Math.min(end, now)) - start) / 3600
  // 3 óra után megszakadt mérés rövidítve még számít (done), korábban nem (broken).
  const phase = broken ? (hours * 60 >= TRUNC_MIN ? 'done' : 'broken') : now < end ? 'running' : 'done'
  const until = broken && phase === 'done' ? disturbAt : end
  return { kind, phase, start, until, hours, ...extra } as Measure
}

function evalCorrection(i: ChInput, d: ChDose, groups: Group[]): Measure | null {
  const pre = d.ts - CORR_PRE_MIN * MIN
  if (i.doses.some((x) => x !== d && x.ts >= pre && x.ts <= d.ts)) return null
  if (i.carbs.some((c) => c.ts >= pre && c.ts <= d.ts)) return null
  if (i.noteTs.some((n) => n >= pre && n <= d.ts)) return null
  if (carbsAbsorbingAt(i, groups, d.ts)) return null
  if (i.iobBefore(d.ts) > Math.max(CORR_LEFTOVER_MIN_E, CORR_LEFTOVER_FRAC * d.v)) return null
  const end = d.ts + i.diaMin(d.ts) * MIN
  const disturbAt = firstDisturb(d.ts, end, i.now, [
    ...i.doses.filter((x) => x !== d).map((x) => x.ts),
    ...i.carbs.map((c) => c.ts),
    ...i.noteTs,
  ])
  return finish('correction', d.ts, end, disturbAt, i.now, { dose: d.v })
}

function evalMeal(i: ChInput, g: Group, groups: Group[]): Measure | null {
  const own = i.doses.filter((b) => b.kind === 'meal' && b.ts >= g.ts - PRE_BOLUS_SEC && b.ts <= g.last + MEAL_JOIN_SEC)
  const firstOwn = own.length ? Math.min(...own.map((b) => b.ts)) : g.ts
  if (i.doses.some((b) => !own.includes(b) && b.ts >= Math.min(g.ts, firstOwn) - PRE_BOLUS_SEC && b.ts <= g.ts)) return null
  if (carbsAbsorbingAt(i, groups, g.ts, g)) return null
  if (i.noteTs.some((n) => n >= g.ts - 2 * 3600 && n <= g.ts)) return null
  const end = g.ts + (g.fatty ? 360 : Math.min(360, Math.max(240, i.diaMin(g.ts)))) * MIN
  const disturbAt = firstDisturb(g.ts, end, i.now, [
    ...i.doses.filter((b) => !own.includes(b)).map((b) => b.ts),
    ...i.noteTs,
  ])
  return finish('meal', g.ts, end, disturbAt, i.now, { carbs: g.carbs })
}

export function challengeState(i: ChInput): ChState {
  const groups = mealGroups(i.carbs.filter((c) => c.ts <= i.now))
  const cands: Measure[] = []
  for (const d of i.doses) {
    if (d.kind !== 'correction' || d.ts > i.now) continue
    const s = evalCorrection(i, d, groups)
    if (s) cands.push(s)
  }
  const g = groups.at(-1)
  if (g) {
    const s = evalMeal(i, g, groups)
    if (s) cands.push(s)
  }
  const recent = cands.filter((s) => s.phase === 'running' || i.now - s.until < SHOW_AFTER_MIN * MIN)
  const running = recent.filter((s) => s.phase === 'running')
  const pool = running.length ? running : recent
  if (pool.length) return pool.reduce((a, b) => (a.start >= b.start ? a : b))
  const carbsUntil = groups.reduce<number | null>((m, x) => {
    const u = x.ts + Math.max(fixedWindowMin(x), i.absorbMin({ grams: x.carbs, fatty: x.fatty, fast: x.fast })) * MIN
    return u > i.now && (m == null || u > m) ? u : m
  }, null)
  if (i.iobNow > BUSY_IOB || carbsUntil != null) return { kind: 'busy', iob: i.iobNow, carbsUntil }
  return { kind: 'clear' }
}
