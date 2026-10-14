// Indításkori adattisztítás (minden indításkor lefut, de csak akkor módosít, ha van mit):
//  - ugyanaz a szenzormérés két úton (Apple Health és CareLink) ~1 percen belül kétszer szerepelt: a Health-ből
//    jött (percre kerekített) másolat törlődik, a CareLink pontos időpontú sora marad;
//  - a típus nélküli, bázisnak tekintendő inzulinadagok (a beállított bázisadag, vagy a maximális bólusnál nagyobb)
//    bázis jelölést kapnak, hogy a napi összesítők és az elemzés is úgy kezelje.
// Ha bármi változott, a tárolt elemzések a háttérben újraszámolódnak.
import { db, GLUCOSE_DUP_SEC, MANUAL_SOURCE } from '../utils/db'
import { isAssumedBasal } from '../utils/basal'
import { markDirty } from '../utils/computed'

export default defineNitroPlugin(() => {
  // Az adatbázis a bővítmények betöltésekor még nem nyitható meg: az indulás után futtatjuk.
  setTimeout(cleanup, 2000)
})

function cleanup(): void {
  try {
    const d = db()
    const dup = d.prepare(
      `DELETE FROM entries WHERE id IN (
         SELECT a.id FROM entries a
         JOIN entries b ON b.type = 'glucose' AND b.id <> a.id AND b.source = 'CareLink'
           AND b.ts BETWEEN a.ts - ? AND a.ts + ? AND ABS(b.value - a.value) <= 0.2
         WHERE a.type = 'glucose' AND (a.source IS NULL OR a.source NOT IN ('CareLink', ?))
       )`,
    ).run(GLUCOSE_DUP_SEC, GLUCOSE_DUP_SEC, MANUAL_SOURCE)
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
    const untyped = d.prepare("SELECT id, value FROM entries WHERE type = 'insulin' AND (subtype IS NULL OR subtype = '')").all() as { id: number; value: number }[]
    const setBasal = d.prepare("UPDATE entries SET subtype = 'basal' WHERE id = ?")
    let basal = 0
    for (const r of untyped) {
      if (isAssumedBasal(Number(r.value), null)) {
        setBasal.run(r.id)
        basal++
      }
    }
    const removed = Number(dup.changes)
    if (removed || basal || unbasal) {
      console.log(`[adattisztítás] ${removed} dupla szenzorérték törölve, ${basal} adag bázisnak jelölve, ${unbasal} tévesen bázisnak jelölt adag visszaállítva`)
      markDirty()
    }
  } catch (e) {
    console.error('[adattisztítás]', e)
  }
}
