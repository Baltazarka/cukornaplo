// Indításkori adattisztítás (minden indításkor lefut, de csak akkor módosít, ha van mit):
//  - az InPenből jött vércukor ujjbegyes mérés: kézi mérésnek jelöljük (nem szenzoradat);
//  - ugyanaz a szenzormérés két úton (Apple Health és CareLink) ~1 percen belül kétszer szerepelt: a Health-ből
//    jött (percre kerekített) másolat törlődik, a CareLink pontos időpontú sora marad;
//  - ugyanarra az időpontra (±2,5 perc) két CareLink-érték: a később felvett (eltolt időpontú másolat) törlődik;
//  - a típus nélküli, bázisnak látszó adagot nem írjuk át: a besorolás (insulinKind / isAssumedBasal) futásidőben,
//    a mostani beállításból ismeri fel, így a bázisadag módosítása a régi sorokat nem változtatja meg végleg.
// Ha bármi változott, a tárolt elemzések a háttérben újraszámolódnak.
import { db, GLUCOSE_DUP_SEC, MANUAL_SOURCE } from '../utils/db'
import { markDirty } from '../utils/computed'

export default defineNitroPlugin(() => {
  // Az adatbázis a bővítmények betöltésekor még nem nyitható meg: az indulás után futtatjuk.
  setTimeout(cleanup, 2000)
})

function cleanup(): void {
  try {
    const d = db()
    // Az InPenből (Apple Health-en át) jött vércukor ujjbegyes mérés: kézi mérésnek jelöljük, hogy a szenzorgörbe,
    // a lefedettség és az elemzés ne keverje a szenzoradattal (és a lenti duplatörlés se érintse).
    const inpen = d.prepare("UPDATE entries SET source = ? WHERE type = 'glucose' AND source LIKE '%inpen%'").run(MANUAL_SOURCE)
    const dup = d.prepare(
      `DELETE FROM entries WHERE id IN (
         SELECT a.id FROM entries a
         JOIN entries b ON b.type = 'glucose' AND b.id <> a.id AND b.source = 'CareLink'
           AND b.ts BETWEEN a.ts - ? AND a.ts + ? AND ABS(b.value - a.value) <= 0.2 + 1e-9
         WHERE a.type = 'glucose' AND (a.source IS NULL OR a.source NOT IN ('CareLink', ?))
       )`,
    ).run(GLUCOSE_DUP_SEC, GLUCOSE_DUP_SEC, MANUAL_SOURCE)
    // Eltolt időpontú CareLink-másolatok (téves időzóna-javítás, lásd carelink.ts clTimeShift): ugyanarra az
    // 5 perces mérésre két érték; az elsőként (élőben) felvett marad.
    const shifted = d.prepare(
      `DELETE FROM entries WHERE id IN (
         SELECT a.id FROM entries a
         JOIN entries b ON b.type = 'glucose' AND b.source = 'CareLink' AND b.id <> a.id
           AND b.ts BETWEEN a.ts - ? AND a.ts + ?
           AND (b.created_at < a.created_at OR (b.created_at = a.created_at AND b.id < a.id))
         WHERE a.type = 'glucose' AND a.source = 'CareLink'
       )`,
    ).run(GLUCOSE_DUP_SEC, GLUCOSE_DUP_SEC)
    // Javítás (egyszer): egy korábbi, túl tág szabály a maximális bólusnál nagyobb étkezési bólust is bázisnak
    // jelölte. A bázisnak jelölt, de a bázisadagtól 25%-nál jobban eltérő és CH mellett (±30 perc) beadott adag
    // visszakapja a típus nélküli (automatikus) besorolást.
    let unbasal = 0
    if (!setting('fix_basal_v1', null)) {
      const b = Number(setting('basal_dose', null))
      if (Number.isFinite(b) && b > 0) {
        unbasal = Number(d.prepare(
          `UPDATE entries SET subtype = NULL WHERE type = 'insulin' AND subtype = 'basal' AND ABS(value - ?) > ? * 0.25
             AND EXISTS (SELECT 1 FROM entries c WHERE c.type = 'carbs' AND c.ts BETWEEN entries.ts - 1800 AND entries.ts + 1800)`,
        ).run(b, b).changes)
      }
      saveSettings({ fix_basal_v1: true })
    }
    const removed = Number(dup.changes) + Number(shifted.changes)
    const relabeled = Number(inpen.changes)
    if (removed || unbasal || relabeled) {
      console.log(`[adattisztítás] ${removed} dupla szenzorérték törölve, ${unbasal} tévesen bázisnak jelölt adag visszaállítva, ${relabeled} InPen-vércukor kézi mérésnek jelölve`)
      markDirty()
    }
  } catch (e) {
    console.error('[adattisztítás]', e)
  }
}
