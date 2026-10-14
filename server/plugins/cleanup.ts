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
    if (removed || basal) {
      console.log(`[adattisztítás] ${removed} dupla szenzorérték törölve, ${basal} adag bázisnak jelölve`)
      markDirty()
    }
  } catch (e) {
    console.error('[adattisztítás]', e)
  }
}
