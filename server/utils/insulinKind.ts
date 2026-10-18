// Inzulinadagok besorolása: étkezési bólus, korrekció vagy bázis.
// A Health-adatban csak „bólus” vagy „bázis” szerepel, ezért a bólusokat becsüljük:
//  - ha a beadás után 60 percen belül (előbólus) vagy előtte 30 percen belül szénhidrát is van → étkezési bólus;
//  - ha nincs szénhidrát → korrekció (az InPen-ben jelölt típus az Apple Health-en át nem jön át; a CH nélküli
//    adag a gyakorlatban korrekció, a CH-t pedig a bólussal együtt rögzítjük).
//  (Korábban a célérték + 2 mmol/L alatti, CH nélküli adag „étkezési, CH nélkül” lett; ez a valós adatban
//  rendszeresen a korrekciókat sorolta rosszul.)
// A naplóban kézzel beállított típus (subtype: meal / correction / basal) mindig felülírja a becslést.
// A típus nélküli, bázisnak látszó adag (isAssumedBasal: a beállított bázisadag körül) bázis; ez mindig a mostani
// beállításból számol, az adatbázisban nem íródik át.
import { isAssumedBasal } from './basal'

export type InsulinKind = 'meal' | 'correction' | 'basal'

export const MEAL_WINDOW_SEC = 30 * 60
/** Előbólus: az étkezés (CH) előtt legfeljebb ennyivel beadott bólus is étkezési. */
export const PREBOLUS_SEC = 60 * 60
/**
 * Egy adag típusa. `carbTs`: a környező szénhidrát-bejegyzések időpontjai (unix mp); `value`: az adag (E), a típus
 * nélküli bázis felismeréséhez.
 * `auto`: becslés (nem kézi beállítás); `noCarbs`: régi jelölés (étkezési bólus CH nélkül), már nem fordul elő.
 */
export function insulinKind(ts: number, subtype: string | null, carbTs: number[], value?: number): { kind: InsulinKind; auto: boolean; noCarbs: boolean } {
  if (subtype === 'basal' || subtype === 'meal' || subtype === 'correction') return { kind: subtype, auto: false, noCarbs: false }
  if (value != null && isAssumedBasal(value, subtype)) return { kind: 'basal', auto: true, noCarbs: false }
  if (carbTs.some((c) => c - ts >= -MEAL_WINDOW_SEC && c - ts <= PREBOLUS_SEC)) return { kind: 'meal', auto: true, noCarbs: false }
  return { kind: 'correction', auto: true, noCarbs: false }
}
