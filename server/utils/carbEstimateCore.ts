// Be nem írt CH becslésének tiszta számolása (import nélkül, node --test alatt is futtatható; tests/carbEstimate.test.ts).
// Az elv: egy ablakban a tényleges vércukor-változást összevetjük azzal, amit az ablakban felhasznált aktív
// inzulin (ISF-fel) önmagában okozna. Ha a tényleges emelkedés ennél jelentősen nagyobb, és nincs a közelben
// CH-bejegyzés, az a többlet feltételezhetően be nem írt szénhidráttól származik.

/** Az ablak legalább ennyi %-ban legyen szenzorral lefedve, különben nem megbízható a becslés. */
export const MIN_COVERAGE = 0.8
/** Ennél kisebb, az inzulinnal meg nem magyarázott emelkedés még simán a modell pontatlansága (nem jelzünk). */
export const MIN_EXCESS_MMOL = 2.0
/** Ennél kevesebb becsült grammot nem éri meg felajánlani. */
export const MIN_GRAMS = 10
/** Ennél többet nem becslünk egyszerre (durva túlbecslésnél inkább alábecsül, a felhasználó majd pontosít). */
export const MAX_GRAMS = 80

export interface EstimateInput {
  /** Vércukor az ablak elején és végén (mmol/L). */
  startV: number
  endV: number
  /** Szenzorlefedettség az ablakban (0–1). */
  coverage: number
  /** Van-e CH-bejegyzés az ablak közelében (ekkor nem becslünk). */
  hasCarbsNearby: boolean
  /** Az ablakban felhasznált (elhasznált) aktív inzulin, E. */
  insulinUsed: number
  /** ISF, mmol/L / E. */
  isf: number
  /** mmol/L / g szénhidrát (isf / CH-arány). */
  perG: number
}

export interface EstimateResult {
  grams: number
}

const roundTo5 = (g: number) => Math.round(g / 5) * 5

export function decideCarbEstimate(i: EstimateInput): EstimateResult | null {
  if (i.hasCarbsNearby) return null
  if (i.coverage < MIN_COVERAGE) return null
  if (!(i.perG > 0)) return null
  const actualDelta = i.endV - i.startV
  const expectedDelta = -i.isf * i.insulinUsed
  const excess = actualDelta - expectedDelta
  if (excess < MIN_EXCESS_MMOL) return null
  const grams = Math.min(MAX_GRAMS, roundTo5(excess / i.perG))
  if (grams < MIN_GRAMS) return null
  return { grams }
}
