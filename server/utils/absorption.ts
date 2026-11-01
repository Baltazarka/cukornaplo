// A szénhidrát felszívódása. Kétféle forrás:
//  - tanult görbe: a tiszta étkezésekből (étkezés + inzulin, korrekció és ráétkezés nélkül), kategóriánként
//    (normál / zsíros-fehérjedús / gyors). A tanulásban részt vevő étkezések átlagos méretére (refGrams) érvényes;
//    más méretű étkezésnél időben arányosan nyújtjuk / összehúzzuk (kétszer akkora étkezés kétszer annyi ideig tart,
//    legfeljebb ±2x-esig);
//  - alapértelmezett: óránként felszívódó gramm (g/óra), ívelt (parabolikus) alakkal. A teljes idő = gramm ÷ g/óra,
//    legalább 45 perc. Amíg egy kategóriához kevés a tiszta étkezés, ez érvényes.
// Az előrejelzés és az aktív CH használja.
import { ABSORB_STEP, type AbsorbCategory, type AbsorptionProfile } from './analysis'
import { analysisCached, analysisKey } from './analysisCache'
import { readComputed } from './computed'
import { todayYmd } from './time'

/** Gyári alapértelmezett felszívódási ütem, gramm / óra. */
export const BUILTIN_ABSORB_RATE: Record<AbsorbCategory, number> = { normal: 20, fatty: 12, fast: 30 }
export const ABSORB_RATE_LIMITS = { min: 5, max: 120 } as const
/** Az alapértelmezett teljes felszívódási idő alsó és felső határa, perc. */
const MIN_TOTAL_MIN = 45
const MAX_TOTAL_MIN = 480
/** A tanult görbe nyújtási tényezőjének határai. */
export const SCALE_LIMITS = [0.5, 2] as const

let defaultsCache: { at: number; value: Record<AbsorbCategory, number> } | null = null

/** A beállított (vagy gyári) felszívódási ütem, g/óra: addig érvényes, amíg egy kategóriához nincs elég tiszta étkezés. */
export function defaultAbsorbRate(): Record<AbsorbCategory, number> {
  const now = Date.now()
  if (defaultsCache && now - defaultsCache.at < 10_000) return defaultsCache.value
  const saved = setting<Partial<Record<AbsorbCategory, number>>>('absorb_rates', null) ?? {}
  const value = { ...BUILTIN_ABSORB_RATE }
  for (const k of Object.keys(value) as AbsorbCategory[]) {
    const v = Number(saved[k])
    if (Number.isFinite(v) && v >= ABSORB_RATE_LIMITS.min && v <= ABSORB_RATE_LIMITS.max) value[k] = Math.round(v * 10) / 10
  }
  defaultsCache = { at: now, value }
  return value
}

export function resetDefaultAbsorbRate(): void {
  defaultsCache = null
}

const LEARN_DAYS = 60
const CACHE_SEC = 3 * 3600

let cache: { at: number; data: Record<AbsorbCategory, AbsorptionProfile> | null } | null = null

/** A tanult profilok (az utolsó 60 nap tiszta étkezéseiből), 3 óráig gyorsítótárazva. */
export function learnedAbsorption(): Record<AbsorbCategory, AbsorptionProfile> | null {
  const now = Math.floor(Date.now() / 1000)
  if (cache && now - cache.at < CACHE_SEC) return cache.data
  let data: Record<AbsorbCategory, AbsorptionProfile> | null = null
  try {
    // A Terápia oldal 60 napos elemzésének tárolt eredménye (éjszaka újraszámolva); nincs külön számolás.
    data = analysisCached(LEARN_DAYS, todayYmd()).data.absorption
  } catch {
    data = null
  }
  cache = { at: now, data }
  return data
}

export function resetAbsorptionCache(): void {
  cache = null
}

function learnedOf(cat: AbsorbCategory, stored = false): { prof: number[]; ref: number } | null {
  const p = (stored ? storedAbsorption() : learnedAbsorption())?.[cat]
  return p?.usable && p.profile && p.refGrams ? { prof: p.profile, ref: p.refGrams } : null
}

/**
 * A tanult profilok csak a már tárolt 60 napos elemzésből, számolás nélkül. Az elemzés ezt használja (a CH-arányhoz):
 * így a 60 napos elemzés nem indítja el önmagát, és a görbe az előző számolásé (egy lépéssel késve, körbe nem hat).
 */
function storedAbsorption(): Record<AbsorbCategory, AbsorptionProfile> | null {
  if (cache) return cache.data
  return readComputed<{ absorption: Record<AbsorbCategory, AbsorptionProfile> }>(analysisKey(LEARN_DAYS, todayYmd()))?.data?.absorption ?? null
}

/**
 * Alapértelmezett felszívódási alak (a Loop / OpenAPS parabolikus modellje): lassan indul, a felénél
 * a leggyorsabb, majd lecseng. `x` = eltelt idő / teljes felszívódási idő; a felszívódott arány 0 … 1.
 */
export function defaultFraction(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)
}

/** Az alapértelmezett teljes felszívódási idő, perc: gramm ÷ g/óra (45 és 480 perc között). */
export function defaultTotalMin(cat: AbsorbCategory, grams: number): number {
  return Math.min(MAX_TOTAL_MIN, Math.max(MIN_TOTAL_MIN, (grams / defaultAbsorbRate()[cat]) * 60))
}

/** A tanult görbe időbeli nyújtása egy `grams` grammos étkezésre (a tanuló étkezések átlagos méretéhez képest). */
export const scaleFor = (grams: number, ref: number) => Math.min(SCALE_LIMITS[1], Math.max(SCALE_LIMITS[0], grams / ref))

/** A felszívódott CH aránya (0 … 1) egy `grams` grammos étkezés után `minutes` perccel. */
export function absorbedFraction(cat: AbsorbCategory, minutes: number, grams: number, stored = false): number {
  if (minutes <= 0) return 0
  const l = learnedOf(cat, stored)
  if (!l) return defaultFraction(minutes / defaultTotalMin(cat, grams))
  const x = minutes / scaleFor(grams, l.ref) / ABSORB_STEP
  if (x >= l.prof.length - 1) return 1
  const i = Math.floor(x)
  return l.prof[i] + (l.prof[i + 1] - l.prof[i]) * (x - i)
}

/** Ennyi perc után számít teljesen felszívódottnak a CH. */
export function absorbSpanMin(cat: AbsorbCategory, grams: number): number {
  const l = learnedOf(cat)
  if (!l) return defaultTotalMin(cat, grams)
  const i = l.prof.findIndex((v) => v >= 0.995)
  return (i < 0 ? l.prof.length - 1 : i) * ABSORB_STEP * scaleFor(grams, l.ref)
}

export function absorbCategory(subtype: string | null): AbsorbCategory {
  return subtype === 'fatty' ? 'fatty' : subtype === 'fast' ? 'fast' : 'normal'
}

const CURVE_POINTS = 33 // 15 percenként 0-tól 480 percig

/** Egy étkezés felszívódási görbéje 15 percenként 0-tól 480 percig (a grafikonhoz). */
export function carbCurve(cat: AbsorbCategory, grams: number): number[] {
  return Array.from({ length: CURVE_POINTS }, (_, i) => Math.round(absorbedFraction(cat, i * ABSORB_STEP, grams) * 1000) / 1000)
}

/** A még fel nem szívódott szénhidrát (g) `ts`-kor a megadott bejegyzésekből. */
export function cobAt(carbs: { ts: number; v: number; sub: string | null }[], ts: number): number {
  let sum = 0
  for (const c of carbs) {
    const cat = absorbCategory(c.sub)
    const m = (ts - c.ts) / 60
    if (m < 0 || m >= absorbSpanMin(cat, c.v)) continue
    sum += c.v * (1 - absorbedFraction(cat, m, c.v))
  }
  return sum
}
