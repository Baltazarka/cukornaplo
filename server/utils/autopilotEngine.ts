// Autopilot-motor: tisztán számoló javaslat-döntés (nincs adatbázis, nincs mellékhatás, a Nuxt nélkül is fut: tests/).
// Az oref0 / oref1 elvét követi, injekciós (pumpa nélküli) használatra, csak javaslatként:
//  - a várható vércukor = most − aktív inzulin hatása + aktív szénhidrát hatása + csillapított trend;
//  - csak magas, nem eső vércukornál javasol, a teljes szükséglet töredékét (alap: fele), egy lépésben;
//  - nem javasol hipó-veszélynél, friss adag után, nagy aktív inzulinnál, és úgy csökkenti a lépést, hogy a javasolt
//    adag mellett sem lehessen a várható mélypont a céltartomány alja fölé szabott biztonsági sáv alatt.

export interface ApParams {
  target: number
  /** mmol/L / E */
  isf: number
  /** g / E */
  icr: number
  low: number
  high: number
  /** A teljes szükséglet hányad része egy lépés (0,25–1). */
  fraction: number
  /** Ennyi aktív inzulin (E) fölött nem javasol. */
  maxIob: number
  /** Egy javaslat legfeljebb ennyi E. */
  maxStep: number
  /** A legkisebb lépés (E), egyben a kerekítés. */
  minStep: number
  /** Két javaslat között legalább ennyi perc. */
  spacingMin: number
}

export interface ApInput {
  nowTs: number
  /** Szenzorértékek (unix mp, mmol/L), idő szerint rendezve, legalább az utolsó fél óra. */
  glucose: { ts: number; v: number }[]
  /** Az aktív inzulin (E) egy időpontban (a már beadott adagokból; jövőbeli időpontra is). */
  iobAt: (ts: number) => number
  /** Az aktív szénhidrát (g) egy időpontban. */
  cobAt: (ts: number) => number
  /** Az utolsó gyors hatású adag időpontja (unix mp). */
  lastBolusTs: number | null
  /** Egy most beadott adag hányad része hat még t perc múlva (1 → 0). */
  remaining: (minutes: number) => number
  params: ApParams
}

export type ApState = 'suggest' | 'wait' | 'hold' | 'stale'

export interface ApDecision {
  state: ApState
  /** Javasolt adag, E (csak `suggest`-nél). */
  units: number | null
  /** A teljes szükséglet, E (a javaslat ennek egy lépése). */
  full: number | null
  bg: number | null
  bgTs: number | null
  /** mmol/L / perc, a kb. 15 perccel korábbi értékhez képest. */
  rate: number | null
  iob: number
  cob: number
  eventual: number | null
  minPred: number | null
  /** Hány perc múlva a legalacsonyabb várható érték. */
  minPredIn: number | null
  /** Várható görbe [perc, mmol/L] a következő 4 órára, ha nem történik semmi más. */
  curve: [number, number][]
  /** Ugyanez a javasolt adag beadásával (csak `suggest`-nél). */
  curveAfter: [number, number][]
  reasons: string[]
}

export const AP_HORIZON_MIN = 240
const STEP_MIN = 5
const STALE_MIN = 15
/** Ennél gyorsabb esésnél (mmol/L / perc) várunk. */
const FALL_RATE = -0.03
/** A trend csillapítása: a változás sebességének fele, legfeljebb 15 percig (mint az előrejelzésnél). */
const TREND_GAIN = 0.5
const TREND_CAP_MIN = 15
/** A javasolt adag mellett is ennyivel a céltartomány alja fölött maradjon a várható mélypont. */
const LOW_MARGIN = 0.5

const round = (v: number, d = 10) => Math.round(v * d) / d
const floorTo = (v: number, step: number) => Math.floor(v / step + 1e-9) * step
const n1 = (v: number) => v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })

/** A változás sebessége (mmol/L / perc) az utolsó mérésnél: a 10–20 perccel korábbi, 15-höz legközelebbi méréshez képest. */
function rateOf(points: { ts: number; v: number }[]): number | null {
  const last = points[points.length - 1]
  if (!last) return null
  let best: { ts: number; v: number } | null = null
  for (let j = points.length - 2; j >= 0; j--) {
    const dt = (last.ts - points[j].ts) / 60
    if (dt > 20) break
    if (dt >= 10 && (!best || Math.abs(dt - 15) < Math.abs((last.ts - best.ts) / 60 - 15))) best = points[j]
  }
  return best ? (last.v - best.v) / ((last.ts - best.ts) / 60) : null
}

const empty = (state: ApState, reasons: string[], extra: Partial<ApDecision> = {}): ApDecision => ({
  state, units: null, full: null, bg: null, bgTs: null, rate: null, iob: 0, cob: 0, eventual: null, minPred: null,
  minPredIn: null, curve: [], curveAfter: [], reasons, ...extra,
})

export function apDecide(i: ApInput): ApDecision {
  const p = i.params
  const last = i.glucose[i.glucose.length - 1]
  if (!last || i.nowTs - last.ts > STALE_MIN * 60) {
    return empty('stale', [`Nincs friss szenzorérték (${STALE_MIN} percnél régebbi vagy hiányzik).`])
  }
  const bg = last.v
  const rate = rateOf(i.glucose)
  const iob = i.iobAt(i.nowTs)
  const cob = i.cobAt(i.nowTs)
  const perG = p.isf / p.icr
  const trend = (min: number) => (rate ?? 0) * Math.min(min, TREND_CAP_MIN) * TREND_GAIN

  const curve: [number, number][] = []
  for (let k = 0; k <= AP_HORIZON_MIN; k += STEP_MIN) {
    const t = i.nowTs + k * 60
    curve.push([k, round(bg - p.isf * (iob - i.iobAt(t)) + perG * (cob - i.cobAt(t)) + trend(k))])
  }
  let min = curve[0]
  for (const c of curve) if (c[1] < min[1]) min = c
  // Hosszú távon kialakuló érték: minden beadott inzulin és szénhidrát teljes hatásával.
  const eventual = round(bg - p.isf * iob + perG * cob + trend(TREND_CAP_MIN))

  const base = { bg, bgTs: last.ts, rate, iob: round(iob, 100), cob: Math.round(cob), eventual, minPred: min[1], minPredIn: min[0], curve }
  const hold = (reasons: string[]) => empty('hold', reasons, base)
  const wait = (reasons: string[]) => empty('wait', reasons, base)

  if (bg < p.low || min[1] < p.low) {
    return hold([bg < p.low ? `A vércukor (${n1(bg)}) a céltartomány alatt van.` : `Hipó-veszély: a várható mélypont ${n1(min[1])} mmol/L ${min[0]} perc múlva.`, 'Inzulint most ne adj.'])
  }
  if (rate != null && rate <= FALL_RATE) {
    return hold([`Esik a vércukor (${n1(rate * 15)} mmol/L 15 perc alatt): várj, amíg stabilizálódik.`])
  }
  if (i.lastBolusTs != null && i.nowTs - i.lastBolusTs < p.spacingMin * 60) {
    const ago = Math.round((i.nowTs - i.lastBolusTs) / 60)
    return wait([`${ago} perce adtál inzulint, a hatásához idő kell. Legközelebb ${p.spacingMin - ago} perc múlva számol újra.`])
  }
  if (bg <= p.high || eventual <= p.high) {
    return wait([`Nem kell: most ${n1(bg)}, a várható érték ${n1(eventual)} mmol/L, a céltartományban (felső határ ${n1(p.high)}).`])
  }

  const need = (eventual - p.target) / p.isf
  const full = floorTo(need, p.minStep)
  const after = (u: number): [number, number][] => curve.map(([k, v]) => [k, round(v - u * p.isf * (1 - i.remaining(k)))])
  const lowest = (c: [number, number][]) => Math.min(...c.map((x) => x[1]))
  // Egy lépés: a töredék, a legnagyobb lépés és az aktív inzulin határa közül a legkisebb; a javasolt adag mellett se
  // lehessen a várható mélypont a biztonsági sáv alatt: ha igen, kisebb lépés.
  const step = (cap: number) => {
    let u = floorTo(Math.min(p.fraction * need, p.maxStep, cap), p.minStep)
    while (u >= p.minStep && lowest(after(u)) < p.low + LOW_MARGIN) u = round(u - p.minStep, 100)
    return u
  }
  if (iob + p.minStep > p.maxIob) {
    const u = step(Infinity)
    return wait([
      `Az aktív inzulin (${n1(iob)} E) és a legkisebb adag (${n1(p.minStep)} E) együtt meghaladná a beállított határt (${n1(p.maxIob)} E), ezért most nem javasol.`,
      u >= p.minStep
        ? `A határ nélkül kb. ${n1(u)} E lenne a javaslat (most ${n1(bg)}, a várható érték ${n1(eventual)} mmol/L). A határot a Beállításokban módosíthatod.`
        : `A várható érték ${n1(eventual)} mmol/L, de a határ nélkül sem lenne biztonságos javaslat.`,
    ])
  }
  const units = step(p.maxIob - iob)
  if (units < p.minStep) {
    return wait([`A várható érték ${n1(eventual)} mmol/L, de a legkisebb lépés mellett is túl közel kerülne az alacsonyhoz (várható mélypont ${n1(min[1])}): most nem javasol.`])
  }
  const reasons = [
    `Most ${n1(bg)}, a várható érték ${n1(eventual)} mmol/L (a ${n1(iob)} E aktív inzulin${cob >= 5 ? ` és ${Math.round(cob)} g aktív szénhidrát` : ''} után).`,
    `A teljes szükséglet kb. ${n1(full)} E; ez egy lépés (${Math.round(p.fraction * 100)}%), egy óra múlva újraszámol.`,
  ]
  return { ...base, state: 'suggest', units, full, curveAfter: after(units), reasons }
}
