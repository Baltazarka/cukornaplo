// Indításkori adattisztítás (minden indításkor lefut, de csak akkor módosít, ha van mit):
//  - az InPenből jött vércukor ujjbegyes mérés: kézi mérésnek jelöljük (nem szenzoradat);
//  - ugyanaz a szenzormérés két úton (Apple Health és CareLink) ~1 percen belül kétszer szerepelt: a Health-ből
//    jött (percre kerekített) másolat törlődik, a CareLink pontos időpontú sora marad;
//  - ugyanarra az időpontra (±2,5 perc) két CareLink-érték: a később felvett (eltolt időpontú másolat) törlődik;
//  - egyszer: a régi, mennyiség alapján bázisnak felismert (típus nélküli) adagok bázisjelölést kapnak, mert a
//    felismerés megszűnt (a bázist kézzel vagy a Terápia oldali automatikus beírás jelöli).
// Ha bármi változott, a tárolt elemzések a háttérben újraszámolódnak.
import { db, GLUCOSE_DUP_SEC, MANUAL_SOURCE } from '../utils/db'
import { markDirty } from '../utils/computed'
import { ymdInTz } from '../utils/time'
import { looksBasal } from '../utils/normalize'
import { AUTO_BASAL_SOURCE } from '../utils/basalAuto'

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
    // A megszűnt bázisfelismerés (a főoldali „Bázisadagom” körül) eredménye a régi sorokon: egyszer rögzítjük.
    if (!setting('basal_tag_v2', null)) {
      const b = Number(setting('basal_dose', null))
      const max = Number(setting<any>('therapy', null)?.maxBolus)
      const basal = Number.isFinite(b) && b > 0 ? b : null
      const rows = d.prepare("SELECT id, value FROM entries WHERE type = 'insulin' AND (subtype IS NULL OR subtype = '')").all() as { id: number; value: number }[]
      const upd = d.prepare("UPDATE entries SET subtype = 'basal' WHERE id = ?")
      let tagged = 0
      for (const r of rows) {
        if (looksBasal(Number(r.value), basal, Number.isFinite(max) && max > 0 ? max : null)) tagged += Number(upd.run(r.id).changes)
      }
      saveSettings({ basal_tag_v2: true })
      if (tagged) {
        console.log(`[adattisztítás] ${tagged} típus nélküli bázisadag bázisnak jelölve`)
        markDirty()
      }
    }
    // Az első változat az automatikus bázissort kézi forrással és azonosítóval jegyezte meg: a forrás jelöli (egyszer).
    const st = setting<{ date?: string; id?: number | null } | null>('basal_auto', null)
    if (st?.id != null) {
      const row = d.prepare("SELECT ts FROM entries WHERE id = ? AND type = 'insulin' AND subtype = 'basal' AND source = ?").get(st.id, MANUAL_SOURCE) as { ts: number } | undefined
      if (row && st.date && ymdInTz(Number(row.ts)) === st.date) d.prepare('UPDATE entries SET source = ? WHERE id = ?').run(AUTO_BASAL_SOURCE, st.id)
      saveSettings({ basal_auto: { date: st.date } })
    }
    // A korábbi (2026-11-21-én megszűnt) Autopilot-modul elavult táblája, ha még megvan: az új Autopilot
    // (server/utils/autopilot.ts, autopilot_suggestions tábla) más néven, újraépítve működik, ezt nem érinti.
    d.exec('DROP TABLE IF EXISTS autopilot_log')
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
