// A vércukor-előrejelzés tiszta számolása (nincs adatbázis, beállítás vagy óra: tests/predict.test.ts). A predict.ts
// az adatokat (adagok, étkezések, szenzorpontok) összegyűjti, innen kapja a becslést. Módszerek:
//  'persist' (az utolsó érték marad), 'trend' (csillapított lineáris extrapoláció: fél meredekség, legfeljebb 15 percre),
//  'residual' (a modellből nem magyarázható eltérés 15 percig folytatódik), 'blend' (trend + modell keverése).

export type PredictMode = 'persist' | 'trend' | 'residual' | 'blend'

export const MAX_GLUCOSE = 30
const MOMENTUM_MIN = 15
const TREND_WINDOW_SEC = 20 * 60 // a meredekséghez az utolsó 20 perc szenzormérései
const SLOPE_MAX = 0.2 // mmol/L/perc: ennél meredekebb trendet nem extrapolálunk
const BLEND_W0 = 0.1 // a modell súlya az első lépésnél (5 perc), lépésenként 2,5-szeresére nő
const BLEND_GROWTH = 2.5
const TREND_CAP_MIN = 15 // a csillapított trend legfeljebb ennyi percig folytatódik …
const TREND_GAIN = 0.5 // … a meredekség felével (a valós visszatesztben a teljes meredekség 15 percre rosszabb volt a változatlannál)
const RECENT_TREAT_SEC = 30 * 60 // ennyivel előbb bevitt ≥ 10 g CH kezelésnek számít (közben nincs hipó-értesítés)

export interface CoreDose {
  ts: number
  /** E */
  v: number
  /** Hatásmodell: `iob(perc)` a még aktív hányad (1 → 0), `activity(perc)` a hatás sebessége (az adag hányada percenként). */
  model: { iob(minutes: number): number; activity(minutes: number): number }
}

export interface CoreMeal<C = unknown> {
  grams: number
  ts: number
  /** Felszívódási kategória (az `absorbedFrac` kapja). */
  cat: C
  /** mmol/L / g szénhidrát az étkezés napszakában. */
  perG: number
}

export interface CoreInput<C = unknown> {
  nowTs: number
  /** Az utolsó szenzormérés. */
  latest: { ts: number; v: number }
  doses: CoreDose[]
  /** Még fel nem szívódott étkezések. */
  meals: CoreMeal<C>[]
  /** Az étkezés felszívódott hányada `minutes` perccel az étkezés után. */
  absorbedFrac: (cat: C, minutes: number, grams: number) => number
  /** Nem kézi szenzorpontok az utolsó ~40 percből, idő szerint rendezve. */
  pts: { ts: number; v: number }[]
  /** A változás sebessége az utolsó pontnál (mmol/L/perc), vagy null. */
  obsRate: number | null
  /** Az adag beadása napszakának érzékenysége (mmol/L / E). */
  isfAt: (ts: number) => number
}

export interface Core {
  /** A becsült vércukor `h` perccel a `nowTs` után (mmol/L), a megadott módszerrel. */
  atMode: (h: number, mode: PredictMode) => number
  /** Hosszú távon kialakuló érték: a teljes még aktív inzulin és a még fel nem szívódó CH hatásával. */
  eventual: number
  /** Aktív inzulin (E) és fel nem szívódott szénhidrát (g) most. */
  iob: number
  cob: number
  /** Friss (30 percen belüli, ≥ 10 g) szénhidrát: kezelés. */
  treated: boolean
  /** A legutóbbi adag időpontja, 0 ha nincs. */
  lastBolusTs: number
}

export function forecast<C>(i: CoreInput<C>): Core {
  const { nowTs, latest, doses, meals, absorbedFrac, pts, obsRate, isfAt } = i

  let insulinRate = 0
  for (const d of doses) insulinRate += d.v * d.model.activity((nowTs - d.ts) / 60) * isfAt(d.ts)

  const absorbed = (c: CoreMeal<C>, h: number) => absorbedFrac(c.cat, (nowTs - c.ts) / 60 + h, c.grams)
  let carbRate = 0
  let cob = 0
  let treated = false
  for (const c of meals) {
    carbRate += (c.grams * (absorbed(c, 5) - absorbed(c, 0)) * c.perG) / 5
    cob += c.grams * (1 - absorbed(c, 0))
    if (nowTs - c.ts <= RECENT_TREAT_SEC && c.grams >= 10) treated = true
  }

  // Lendület: ami a modellből nem magyarázható, az még pár percig folytatódik.
  const residual = obsRate == null ? 0 : Math.max(-0.15, Math.min(0.15, obsRate - (carbRate - insulinRate)))
  // Trend: legkisebb négyzetek szerinti meredekség az utolsó 20 percre (legalább 3 szenzormérés).
  const recent = pts.filter((p) => p.ts >= latest.ts - TREND_WINDOW_SEC && p.ts <= latest.ts)
  let slope: number | null = null
  if (recent.length >= 3) {
    const mx = recent.reduce((a, p) => a + p.ts, 0) / recent.length
    const my = recent.reduce((a, p) => a + p.v, 0) / recent.length
    const sxx = recent.reduce((a, p) => a + (p.ts - mx) ** 2, 0)
    if (sxx > 0) slope = Math.max(-SLOPE_MAX, Math.min(SLOPE_MAX, (recent.reduce((a, p) => a + (p.ts - mx) * (p.v - my), 0) / sxx) * 60))
  }

  // Az utolsó mérés kora: a becslés a mérés időpontjától számol (a mérés és a „most” közötti inzulin- és CH-hatás
  // sem maradhat ki: 8 E aktív inzulinnál 10 perc késés ~0,5 mmol/L).
  const lagMin = Math.max(0, (nowTs - latest.ts) / 60)
  const atMode = (h: number, md: PredictMode) => {
    const hh = h + lagMin // a mérés óta eltelt perc a célidőpontig
    if (md === 'persist' || (md === 'trend' && slope == null)) return Math.min(MAX_GLUCOSE, Math.max(1.5, latest.v))
    if (md === 'trend') return Math.min(MAX_GLUCOSE, Math.max(1.5, latest.v + TREND_GAIN * slope! * Math.min(hh, TREND_CAP_MIN)))
    let insulinEffect = 0
    for (const d of doses) {
      const m = (nowTs - d.ts) / 60
      insulinEffect += d.v * (d.model.iob(m - lagMin) - d.model.iob(m + h)) * isfAt(d.ts)
    }
    let carbEffect = 0
    for (const c of meals) carbEffect += c.grams * (absorbed(c, h) - absorbed(c, -lagMin)) * c.perG
    const model = latest.v - insulinEffect + carbEffect
    let v: number
    if (md === 'residual' || slope == null) {
      v = model + (md === 'residual' ? residual * Math.min(hh, MOMENTUM_MIN) : 0)
    } else {
      // Rövid távon a trend, hosszabb távon a modell: a modell súlya lépésenként (5 perc) 2,5-szeresére nő.
      const w = BLEND_W0 * BLEND_GROWTH ** (hh / 5)
      v = (model * w + (latest.v + slope * hh)) / (w + 1)
    }
    return Math.min(MAX_GLUCOSE, Math.max(1.5, v))
  }

  let iob = 0
  for (const d of doses) {
    const min = (nowTs - d.ts) / 60
    if (min >= 0) iob += d.v * d.model.iob(min)
  }
  const lastBolusTs = doses.reduce((a, d) => (d.ts <= nowTs && d.ts > a ? d.ts : a), 0)

  // Hosszú távú érték: a teljes még aktív inzulin és a még fel nem szívódó CH hatásával.
  let eventual = latest.v
  // (a mérés időpontjától: ami a mérés óta már hatott, az még nincs benne a mért értékben)
  for (const d of doses) eventual -= d.v * d.model.iob((latest.ts - d.ts) / 60) * isfAt(d.ts)
  for (const c of meals) eventual += c.grams * (1 - absorbed(c, -lagMin)) * c.perG
  eventual = Math.min(MAX_GLUCOSE, Math.max(1.5, eventual))

  return { atMode, eventual, iob, cob, treated, lastBolusTs }
}
