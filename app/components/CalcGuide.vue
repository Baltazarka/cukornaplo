<script setup lang="ts">
// A számítások részletes magyarázata: oldalról beúszó panel. Nem az oldal kezelését írja le,
// hanem hogy az egyes számok, görbék, becslések és a bóluskalkulátor mit és hogyan számolnak.
// A leírt küszöbök és képletek a szerver kódjával (server/utils/*, shared/utils/*) egyeznek.
const open = useGuide()
const panel = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

const SECTIONS = [
  { id: 'alap', title: 'Alapfogalmak' },
  { id: 'glukoz', title: 'Glükózmutatók' },
  { id: 'trend', title: 'Trend és változás' },
  { id: 'agp', title: 'Glükózprofil (AGP)' },
  { id: 'inzulin', title: 'Inzulin, TDD, besorolás' },
  { id: 'hatas', title: 'Inzulinhatás, aktív inzulin' },
  { id: 'felszivodas', title: 'CH-felszívódás, aktív CH' },
  { id: 'bolus', title: 'Bóluskalkulátor' },
  { id: 'zsiros', title: 'Zsíros ételek' },
  { id: 'hipo', title: 'Hipók' },
  { id: 'elorejelzes', title: 'Előrejelzés és értesítések' },
  { id: 'etkezes', title: 'Étkezéselemzés' },
  { id: 'becsles', title: 'Becslés az adataidból' },
  { id: 'bazis', title: 'Bázisellenőrzés' },
  { id: 'labor', title: 'Labor HbA1c és GMI' },
  { id: 'grafikon', title: 'Napi grafikon részletei' },
  { id: 'korlatok', title: 'Korlátok' },
]

function close() {
  open.value = false
}
/** A szakasz helye a görgethető törzsön belül (a fejléc magassága nélkül). */
function sectionTop(id: string): number | null {
  const el = body.value?.querySelector<HTMLElement>(`#guide-${id}`)
  if (!el || !body.value) return null
  return el.getBoundingClientRect().top - body.value.getBoundingClientRect().top + body.value.scrollTop - 8
}
function goto(id: string) {
  const top = sectionTop(id)
  if (top != null) body.value!.scrollTop = top
}

watch(open, async (v) => {
  if (!import.meta.client) return
  if (v) {
    returnFocus = document.activeElement as HTMLElement | null
    document.documentElement.classList.add('guide-lock')
    await nextTick()
    closeBtn.value?.focus()
    if (body.value) body.value.scrollTop = v !== 'tartalom' ? sectionTop(v) ?? 0 : 0
  } else {
    document.documentElement.classList.remove('guide-lock')
    returnFocus?.focus?.()
  }
})

// Esc bezárja; Tab a panelen belül marad.
function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') { e.preventDefault(); close(); return }
  if (e.key !== 'Tab' || !panel.value) return
  const f = [...panel.value.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'))
  if (!f.length) return
  const first = f[0]
  const last = f[f.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.documentElement.classList.remove('guide-lock')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="guide">
      <div v-if="open" class="guide-backdrop" @click.self="close">
        <aside ref="panel" class="guide-panel" role="dialog" aria-modal="true" aria-labelledby="guide-title">
          <header class="guide-head">
            <h2 id="guide-title">Hogyan számol a Cukornapló?</h2>
            <button ref="closeBtn" type="button" class="ghost sm" aria-label="Bezárás" @click="close">✕</button>
          </header>

          <div ref="body" class="guide-body" tabindex="-1">
            <p class="muted small">
              Minden szám, görbe és becslés leírása: honnan jön, mit számol, milyen küszöbökkel. Minden érték
              tájékoztató; a terápia módosításáról a diabetológusoddal dönts.
            </p>
            <nav class="guide-toc" aria-label="Tartalom">
              <button v-for="s in SECTIONS" :key="s.id" type="button" class="tag-toggle" @click="goto(s.id)">{{ s.title }}</button>
            </nav>

            <!-- 1. Alapfogalmak -->
            <section id="guide-alap">
              <h3>Alapfogalmak és mértékegységek</h3>
              <dl class="guide-dl">
                <div><dt>Glükóz</dt><dd>mmol/L. A CGM (Guardian 4) 5 percenként mér; ami mg/dL-ben érkezik, azt 18,018-cal osztva váltjuk át.</dd></div>
                <div><dt>Inzulin</dt><dd>egység (E). A gyors hatású (NovoRapid) bólusok és a bázis (Toujeo) kézi könyvelésből (napló, bóluskalkulátor); a régebbi adatok egy része az InPenből (Apple Health) jött. A be nem írt bázist nem becsüljük.</dd></div>
                <div><dt>Szénhidrát (CH)</dt><dd>gramm (g).</dd></div>
                <div><dt>Kézi vércukor</dt><dd>kézzel mért érték (mmol/L), a naplóban „+ Vércukor”. Jelölve marad, hogy nem szenzoradat.</dd></div>
                <div><dt>CH-arány (ICR)</dt><dd>g/E: hány gramm szénhidrátot fed le 1 egység inzulin. Nagyobb szám = kevesebb inzulin ugyanarra az ételre.</dd></div>
                <div><dt>Érzékenység (ISF)</dt><dd>mmol/L/E: mennyivel csökkenti a vércukrot 1 egység inzulin a teljes hatásidő alatt.</dd></div>
                <div><dt>Célérték</dt><dd>mmol/L: erre a szintre számol a korrekció (a Terápia oldalon napszakonként).</dd></div>
                <div><dt>Céltartomány</dt><dd>alapból 3,9–10,0 mmol/L, a főoldalon állítható. A 3,0 és a 13,9 határ rögzített (nemzetközi konszenzus).</dd></div>
                <div><dt>Napszakok</dt><dd>a Terápia oldalon megadott kezdő időpontoktól a következő kezdetéig tartanak; az utolsó éjfélen át az elsőig. Minden adag, étkezés és mérés a saját időpontja szerinti napszakhoz tartozik.</dd></div>
              </dl>
            </section>

            <!-- 2. Glükózmutatók -->
            <section id="guide-glukoz">
              <h3>Glükózmutatók (csempék, riport)</h3>
              <dl class="guide-dl">
                <div><dt>Átlag glükóz</dt><dd>az időszak összes CGM-mérésének számtani átlaga.</dd></div>
                <div><dt>Szórás (SD)</dt><dd>a mérések szórása (mintaszórás, n − 1-gyel osztva).</dd></div>
                <div><dt>Variációs koefficiens (CV)</dt><dd><code class="guide-f">CV = SD ÷ átlag × 100%</code>. legfeljebb 36% „stabil”, fölötte „ingadozó” (Battelino 2019).</dd></div>
                <div><dt>TIR / TAR / TBR</dt><dd>
                  A mérések hány százaléka esett az egyes sávokba (minden mérés egyformán számít):
                  nagyon alacsony &lt; 3,0 · alacsony 3,0–3,9 · <b>céltartomány 3,9–10,0</b> (a határok benne vannak) ·
                  magas 10,0–13,9 · nagyon magas &gt; 13,9. A TAR a két magas, a TBR a két alacsony sáv összege.
                  Nemzetközi cél: TIR &gt; 70%, TBR &lt; 4%, ezen belül 3,0 alatt &lt; 1%, TAR &lt; 25%.
                </dd></div>
                <div><dt>Szenzoradat</dt><dd>
                  <code class="guide-f">lefedettség = mérések száma ÷ (eltelt idő ÷ 5 perc)</code>, ahol az eltelt idő az
                  időszakon belül az első szenzormérés óta tart (ha csak az időszak egy részéről van adat, az nem rontja). A mai
                  napon csak a mostanáig eltelt idő számít. 70% alatt a mutatók kevésbé megbízhatók.
                </dd></div>
                <div><dt>Dupla mérés</dt><dd>
                  ugyanaz a szenzormérés két úton is beérkezhet (CareLink és Apple Health, ~1 perc eltéréssel). A 2,5 percen
                  belüli, 0,2 mmol/L-nél kisebb eltérésű szenzorértéket csak egyszer vesszük fel; a már meglévő duplákból a
                  CareLink-es (pontos időpontú) sor marad. Egy 5 perces méréshez csak egy CareLink-érték tartozhat.
                </dd></div>
                <div><dt>Kizárt szakasz</dt><dd>
                  a napi grafikon „Szenzorhiba kijelölése” gombjával (utána kattints a hibás szakasz elejére, majd a végére)
                  egy szakasz szenzorértékei kizárhatók, pl. ráfekvés okozta hamis mélynél. Ezek semmibe nem számítanak bele
                  (mutatók, hipóesemények, elemzés, előrejelzés), a grafikonon szürke szaggatott vonallal látszanak; a grafikon
                  alatti „Kizárva …” címke × gombjával visszavonható. A kézi mérést nem érinti.
                </dd></div>
                <div><dt>GMI (becsült HbA1c)</dt><dd>
                  <code class="guide-f">GMI (%) = 3,31 + 0,02392 × átlag (mg/dL)</code>, ahol mg/dL = mmol/L × 18,018
                  (Bergenstal 2018). mmol/mol-ban: <code class="guide-f">(GMI − 2,15) × 10,929</code>. Legalább 14 nap jó
                  lefedettségű adatból értelmes.
                </dd></div>
              </dl>
            </section>

            <!-- 3. Trend -->
            <section id="guide-trend">
              <h3>Trend (nyilak) és „Változásban”</h3>
              <p>
                A változás sebessége egy mérésnél: <code class="guide-f">(mostani − korábbi érték) ÷ eltelt percek</code>, ahol a
                korábbi érték a 10–20 perccel előbbi mérések közül a 15 perchez legközelebbi. Egyetlen zajos mérés így kevésbé torzít.
              </p>
              <table class="table guide-table">
                <thead><tr><th>Sebesség (mmol/L/perc)</th><th>Jelzés</th><th>Óránként kb.</th></tr></thead>
                <tbody>
                  <tr><td>&lt; 0,06</td><td>stabil (vízszintes vonal)</td><td>&lt; 3,6</td></tr>
                  <tr><td>≥ 0,06</td><td>lassú változás, 1 nyíl</td><td>≥ 3,6</td></tr>
                  <tr><td>≥ 0,11</td><td>emelkedés / esés, 2 nyíl</td><td>≥ 6,6</td></tr>
                  <tr><td>≥ 0,17</td><td>gyors változás, 3 nyíl</td><td>≥ 10,2</td></tr>
                </tbody>
              </table>
              <p>
                <b>Változásban (% az időnek):</b> két egymást követő mérés közti időszakot (legfeljebb 15 perces rés) a második
                mérés sebessége szerint soroljuk be; az eredmény az idő hány százalékában volt lassú, közepes vagy gyors a változás.
              </p>
            </section>

            <!-- 4. AGP -->
            <section id="guide-agp">
              <h3>Glükózprofil (AGP, időszakos nézet)</h3>
              <p>
                Az időszak minden napja egy közös 24 órás tengelyre kerül. 15 perces sávonként (a simítás miatt a szomszédos
                ±15 perc méréseivel együtt) kiszámoljuk a mediánt (szaggatott vonal), a 25–75%-os és az 5–95%-os percentilist
                (lineáris interpolációval). Ahol egy sávban 5-nél kevesebb mérés van, ott nincs érték. Az alatta lévő inzulin-
                és CH-oszlopok óránkénti napi átlagok.
              </p>
            </section>

            <!-- 5. Inzulin -->
            <section id="guide-inzulin">
              <h3>Inzulin: besorolás, TDD, kördiagram</h3>
              <p>Ha a bólus típusa nincs megadva („Automatikus”), így becsüljük (a naplóban kézzel bármikor felülírható, és a kézi beállítás mindig erősebb):</p>
              <ol class="guide-ol">
                <li><b>Bázis</b>, ha a típus nélküli adag pontosan akkora, mint a főoldalon beállított „Bázisadagom” (±0,05 E), vagy a maximális bólusnál nagyobb és a bázisadag ±25%-án belül van (pl. 50 E az 52 helyett), vagy kézzel bázisnak jelölted. A típus nélküli adagot a program mindig a mostani bázisadag szerint sorolja be, az adatbázisban nem írja át.</li>
                <li><b>Étkezési bólus</b>, ha a beadás után 60 percen belül (előbólus) vagy előtte 30 percen belül szénhidrát van a naplóban.</li>
                <li>Egyébként <b>korrekció</b>: a CH nélküli adag. Ha a bejegyzésnek van típusa („korrekció”, „étkezés”), azt használjuk.</li>
              </ol>
              <dl class="guide-dl">
                <div><dt>TDD</dt><dd>Total Daily Dose: a napi összes inzulin (étkezési + korrekció + bázis), a beadás időpontja szerint, csak a naplózott adagokból (a be nem írt bázist nem becsüljük). Minden nézetben (napi, időszak, 14 napos táblázat, riport) ugyanígy számol. Időszakos nézetben napi átlag, de csak azokra a napokra osztva, amelyeken volt inzulin- vagy CH-bejegyzés (a kimaradt napok nem húzzák le); a mai, még le nem zárt nap kimarad az átlagból, ha van lezárt nap adattal.</dd></div>
                <div><dt>„Ma eddig”</dt><dd>a mai nap összesítője csak a mostanáig beadott adagokat tartalmazza.</dd></div>
                <div><dt>Kördiagram</dt><dd>a TDD-n belüli arány: étkezési bólus, korrekció, bázis, százalékban.</dd></div>
                <div><dt>Kézi bejegyzés</dt><dd>dátum és időpont megadható. Ha ±30 percen belül már van ugyanekkora bejegyzés, rákérdez (véletlen dupla beírás ellen). Ha telefonról (Apple Health) később ugyanaz az adag érkezik, a kézi sor beolvad.</dd></div>
              </dl>
            </section>

            <!-- 6. Inzulinhatás -->
            <section id="guide-hatas">
              <h3>Inzulinhatás-görbe és aktív inzulin</h3>
              <p>
                A gyors hatású inzulin hatását exponenciális modellel írjuk le (ugyanaz, mint az OpenAPS / Loop rendszerekben).
                Két paramétere van: a <b>csúcsidő</b> (tp: NovoRapid, Humalog, Apidra 75 perc; Fiasp, Lyumjev 55 perc) és a
                <b>hatásidő</b> (td, DIA: a Terápia oldalon, napszakonként külön is). A csúcs legfeljebb a hatásidő 40%-a lehet;
                rövid hatásidőnél ezért előrébb kerül.
              </p>
              <pre class="guide-pre">τ = tp · (1 − tp/td) ÷ (1 − 2·tp/td)
a = 2τ ÷ td
S = 1 ÷ (1 − a + (1 + a) · e^(−td/τ))

hatás(t)  = S ÷ τ² · t · (1 − t/td) · e^(−t/τ)
aktív(t)  = 1 − S·(1 − a) · ((t² ÷ (τ·td·(1 − a)) − t/τ − 1) · e^(−t/τ) + 1)</pre>
              <ul class="guide-ul">
                <li><b>hatás(t)</b>: az adag hányad része hat éppen a t. percben (a görbe alatti terület 1). A Terápia kártyán ez a kitöltött görbe, a csúcshoz igazítva 100%.</li>
                <li><b>aktív(t)</b>: a beadott adag még hatásban lévő része (1 → 0); a hatásidő végén 0.</li>
                <li><b>Aktív inzulin most</b> = Σ adag × aktív(eltelt idő), minden gyors hatású adagra, a <i>beadás</i> napszakának hatásidejével. A bázis (Toujeo) nem számít bele: annak nincs kifejezett csúcsa, egyenletesen hat 24 órán túl.</li>
                <li><b>A napi grafikon bólusgörbéi</b>: minden adagnál az oszlop tetejétől indul, és azt mutatja, hány egység van még belőle hatásban.</li>
              </ul>
            </section>

            <!-- 6b. Szénhidrát-felszívódás -->
            <section id="guide-felszivodas">
              <h3>Szénhidrát-felszívódás, aktív CH</h3>
              <p>
                Az <b>aktív CH (COB)</b> az a szénhidrát, ami még nem szívódott fel. A felszívódás üteme étkezésenként más, ezért két forrás van:
              </p>
              <ul class="guide-ul">
                <li><b>Tanult görbe</b> (a Terápia oldalon): a tiszta étkezéseidből számolja ki, milyen ütemben szívódik fel nálad a szénhidrát. Az inzulin hatását levonja a vércukor-változásból (bólusonként a saját hatásgörbéjével és az ISF-fel), ami marad, az a szénhidrát hatása. Ennek a végponti értékhez mért hányada a felszívódott arány, a medián a tiszta étkezésekből. Külön tanul <b>normál</b>, <b>zsíros / fehérjedús</b> és <b>gyors CH</b> kategóriára (a gyors CH-hoz nem kell saját bólus). Kategóriánként legalább 3 tiszta étkezés kell, 5 a megbízhatóhoz.</li>
                <li><b>Alapértelmezett</b>, amíg nincs elég tiszta étkezés: óránként felszívódó gramm (alapból normál 20, zsíros 12, gyors 30 g/óra, a Terápia oldalon állítható), ívelt alakkal.</li>
              </ul>
              <pre class="guide-pre">alapértelmezett teljes idő = szénhidrát ÷ g/óra   (45 perc – 8 óra)
x = eltelt idő ÷ teljes idő
felszívódott(x) = 2x²              ha x &lt; 0,5
                = 1 − 2(1 − x)²    ha x ≥ 0,5</pre>
              <ul class="guide-ul">
                <li><b>Mennyiség</b>: a nagyobb étkezés tovább tart. A tanult görbe a tanuló étkezések átlagos méretére érvényes; más méretnél az időt arányosan nyújtjuk vagy összehúzzuk, legfeljebb a felére vagy a duplájára.</li>
                <li><b>Tiszta étkezés</b> (a felszívódás tanulásához): volt szénhidrát és inzulin (gyors CH-nál inzulin nélkül is), előtte 1 óráig nincs más bólus és egy korábbi étkezés CH-ja már felszívódott, és utána a tanulási ablak végéig nincs korrekció, ráétkezés vagy más bólus, sport-, betegség- vagy alkohol-jegyzet. A <b>tanulási ablak</b> a várható felszívódási idő (a beállított ütemből és az étkezés méretéből) másfélszerese, de legalább 1,5 óra (gyors), 2 óra (normál) vagy 4 óra (zsíros), legfeljebb 6 óra: rövidebb, mint a CH-arány 4 órás végpontja. Normál és zsíros étkezésnél a kezdő vércukor nem lehet alacsony és nem változhat gyorsan; a gyors CH-nál (tipikusan hipó kezelése) ez nem kizáró ok. Az ablakban legalább 70%-ban kell szenzoradat.</li>
                <li><b>Aktív CH most</b> = Σ szénhidrát × (1 − felszívódott(eltelt idő)). A napi grafikonon ez az étkezés oszlopától induló ív.</li>
              </ul>
            </section>

            <!-- 7. Bóluskalkulátor -->
            <section id="guide-bolus">
              <h3>Bóluskalkulátor</h3>
              <pre class="guide-pre">étkezési adag = szénhidrát (g) ÷ CH-arány (g/E)
korrekció     = (vércukor − célérték) ÷ érzékenység (mmol/L/E)</pre>
              <ul class="guide-ul">
                <li><b>Célérték fölött</b>: a még aktív inzulin a korrekcióból vonódik le, legfeljebb nulláig; az étkezési adagból nem (a Medtronic kalkulátorok logikája).</li>
                <li><b>Célérték alatt</b>: a korrekció negatív, és csökkenti az étkezési adagot; óvatosságból az aktív inzulin is levonódik belőle (ez szigorúbb a Medtronicnál), mert az tovább csökkenti a vércukrot. A levonás a célértéknél nulláról indul, és 1 mmol/L-rel a célérték alatt éri el a teljeset, így a javaslat a célérték körül nem ugrik.</li>
                <li><b>Javasolt adag</b> = max(0, étkezési + korrekció − levont aktív inzulin), <b>0,5 E-re lefelé kerekítve</b>, és legfeljebb a beállított maximális dózis.</li>
                <li><b>Vércukor</b>: a legutóbbi CGM-érték, ha 15 percnél frissebb; különben be kell írni.</li>
                <li><b>Átmenet a napszakok között</b> (kikapcsolható): a CH-arány és az érzékenység a napszak kezdetén a beállított érték, és a következő napszak kezdetéig egyenletesen halad annak értékéig. Pl. 06:00-kor 2 g/E, 12:00-kor 4 g/E → 09:00-kor 3 g/E. A célérték mindig a napszaké. Átmenet nélkül az érték a napszakhatáron lépcsősen vált.</li>
                <li><b>Váltott műszak</b> (Terápia oldal, „Váltott műszak” kártya): megjelölöd, hogy ez a hét délelőttös vagy délutános, és onnan hetente váltakozik; a hétvége szabadnap lehet, egyes napok a főoldalon, a nap fejlécénél átállíthatók (szabadság, csere). Ha a terápiás beállításoknál bekapcsolod a „Külön beállítás a délutános hétre” lehetőséget, a délutános héten (és ha így állítod, szabadnapon) azok a napszakértékek érvényesek a kalkulátorban, az aktív inzulinban, az előrejelzésben és a javaslatokban. A kártya és a riport a mutatókat műszak szerint is kiírja (célban töltött idő egész napra és 00–06, 06–14, 14–22, 22–24 óra között, bólus, korrekció, CH naponta). Az elemzés napszakonkénti becslései az alap beállítás napszakai szerint csoportosítanak.</li>
                <li><b>Figyelmeztetések</b>: alacsony vércukor (a céltartomány alja alatt), a maximális dózis elérése, 14 mmol/L fölött ketonvizsgálat, gyors emelkedés / esés (2–3 nyíl) – a trendet a számítás nem veszi figyelembe.</li>
                <li>A számolt szénhidrát és adag kérésre <b>beírható a naplóba</b> (a mostani időponttal; az adag átírható a ténylegesen beadottra).</li>
                <li><b>Zsíros / fehérjedús étel</b> (tájékoztató, a számolt adag nem változik): ha megadod a zsír és a fehérje grammját, kiírja a varsói módszer szerinti plusz-javaslatot: <code class="guide-f">zsír-fehérje egység = (zsír × 9 + fehérje × 4) ÷ 100</code>, egységenként annyi inzulin, mint 10 g CH-hoz, a Terápia oldalon beállított %-kal (alapból 50%), 0,5 E-re lefelé kerekítve. A hatása kb. 1–1,5 óra múlva kezdődik, és 1 egységnél 3, 2-nél 4, 3-nál 5, 4 vagy több egységnél 8 óráig tart. Beírás után 1,5 óra múlva push-emlékeztető jöhet a mostani cukorral (ha be van kapcsolva, és a cukor nincs a célérték alatt; ha alatta van vagy nincs friss szenzoradat, még egy óráig később is jöhet, ha addig nem adtál inzulint). Ha a Terápia oldalon az <b>egyben, evéskor</b> időzítés van beállítva, a kalkulátor kiírja az összeadott adagot (étkezési + zsír-fehérje), és 75 perc múlva ellenőrző emlékeztető jön a mostani cukorral és trenddel, mert ilyenkor az első 1–1,5 órában több inzulin hat, mint amennyi CH felszívódik (korai hipó veszélye).</li>
                <li><b>Saját zsír-fehérje %</b> (Terápia oldal, „Zsíros ételek”): a zsíros jelölésű, zsír / fehérje grammal beírt étkezéseknél a végpontban (a várt hatásidő vége, 4–8 óra) a megfigyelt változásból levonja a CH teljes hatását (CH × ISF ÷ CH-arány) és hozzáadja a ténylegesen hatott inzulinét (a plusz adagot és a korrekciót is). A maradék a zsír-fehérje hatása: <code class="guide-f">saját % = maradék × CH-arány ÷ ISF ÷ (egység × 10 g) × 100</code>, a kiértékelhető étkezések mediánja (legalább 3, megbízható 6-tól). Kiértékelhető, ha a végpontig nincs más étel és hipó, elég a szenzoradat, és nem alacsony vagy gyorsan változó vércukorról indul. Ha a következő étel legalább 3 óra után és a várt hatásidő 75%-án túl jön, a végpont 5 perccel előtte van (rövidített végpont).</li>
                <li><b>Korrekció zsíros étel után</b>: ha 5 órán belül zsíros étel volt zsír-fehérje javaslattal, a kalkulátor jelzi, hogy a korrekció és a zsír-fehérje adag átfed (a mostani emelkedés egy része már a zsír hatása), ezért nem összeadandó. Az étkezés után 30 perccel vagy később beadott inzulint plusz adagnak / korrekciónak tekinti: ilyenkor az 1,5 órás emlékeztető nem jön, a push pedig a kalkulátor szerinti korrekciót is kiírja.</li>
                <li><b>Értesítésnapló</b>: a kiküldött push értesítések a főoldal jobb sávjában visszanézhetők (60 napig), rákattintva nagyban, a teljes szöveggel.</li>
                <li><b>Gyors CH</b>: grammonként ugyanannyi inzulin kell hozzá, csak gyorsabban emel; a kalkulátor az időzítésre figyelmeztet (10–15 perccel evés előtt beadott adag).</li>
                <li>Ha újabb a kézzel felvitt vércukor a szenzor értékénél, azt használja („kézi” jelzéssel).</li>
              </ul>
            </section>

            <!-- Zsíros ételek: mit jelölj zsírosnak -->
            <section id="guide-zsiros">
              <h3>Zsíros ételek: mit jelölj zsírosnak?</h3>
              <p>
                A zsír és a fehérje is emeli a vércukrot, csak később (1–1,5 óra múlva kezdődően, órákig), és a zsír az inzulin
                hatását is rontja. Ökölszabály <b>zsír-fehérje egységben</b> (1 egység = 100 kcal zsírból és fehérjéből, kb. 11 g zsír
                vagy 25 g fehérje):
              </p>
              <ul class="guide-ul">
                <li><b>2 egységtől</b> (kb. 200 kcal zsírból és fehérjéből, pl. 15 g zsír + 15 g fehérje, vagy 20 g zsír): jelöld <b>zsíros</b>nak, és add meg a zsír és a fehérje grammját.</li>
                <li><b>1–2 egység</b>: határeset. Jelöld, ha nálad ilyenkor 2–4 óra múlva rendszeresen emelkedik a cukor (a Terápia oldal „Zsíros ételek” kártyája meg fogja mutatni).</li>
                <li><b>1 egység alatt</b> (pl. kevés vaj a kenyéren): ne jelöld.</li>
              </ul>
              <table class="table guide-table">
                <thead><tr><th>Étel (tájékoztató)</th><th class="num">Zsír / fehérje</th><th class="num">Egység</th><th>Zsíros?</th></tr></thead>
                <tbody>
                  <tr><td>2 szelet kenyér kevés vajjal, lekvárral</td><td class="num">5 / 6 g</td><td class="num">0,7</td><td>nem</td></tr>
                  <tr><td>sovány csirkemell rizzsel</td><td class="num">3 / 25 g</td><td class="num">1,3</td><td>nem (a fehérje lassan hat)</td></tr>
                  <tr><td>2 tojás (rántotta)</td><td class="num">11 / 12 g</td><td class="num">1,5</td><td>határeset</td></tr>
                  <tr><td>50 g sajt (pl. sajtos kenyér)</td><td class="num">14 / 12 g</td><td class="num">1,8</td><td>határeset, inkább igen</td></tr>
                  <tr><td>100 g párizsi</td><td class="num">25 / 12 g</td><td class="num">2,7</td><td>igen</td></tr>
                  <tr><td>fél pizza (kb. 250 g)</td><td class="num">25 / 25 g</td><td class="num">3,3</td><td>igen</td></tr>
                  <tr><td>hamburger</td><td class="num">25 / 25 g</td><td class="num">3,3</td><td>igen</td></tr>
                  <tr><td>tejszínes-sajtos tészta</td><td class="num">30 / 20 g</td><td class="num">3,5</td><td>igen</td></tr>
                  <tr><td>rántott hús krumplival</td><td class="num">30 / 35 g</td><td class="num">4,1</td><td>igen</td></tr>
                </tbody>
              </table>
              <ul class="guide-ul">
                <li>A pontos értéket a csomagolás tápérték-táblázatából (zsír, fehérje 100 g-ra) vagy egy kalóriaszámláló appból kapod; a táblázat csak tájékoztató.</li>
                <li><b>Mit csinál a jelölés</b>: a CH felszívódását lassabbnak veszi (aktív CH, előrejelzés), kihagyja az étkezést a CH-arány becsléséből, és a zsír / fehérje grammjából tájékoztató plusz-javaslatot és 1,5 órás emlékeztetőt ad (lásd: Bóluskalkulátor). Ezért ne jelölj mindent zsírosnak: ha minden étkezés zsíros, nem marad mihez mérni a CH-arányt.</li>
                <li>A plusz adag mennyiségéről (a varsói érték hány %-a) a diabetológussal egyeztess.</li>
              </ul>
            </section>

            <!-- 8. Hipók -->
            <section id="guide-hipo">
              <h3>Hipóesemények</h3>
              <p>A nemzetközi CGM-konszenzus (Battelino 2023) szerint:</p>
              <ul class="guide-ul">
                <li><b>Esemény</b>: legalább 15 percig (3 egymást követő mérés) a céltartomány alja (3,9) alatt.</li>
                <li><b>Vége</b>: legalább 15 percig újra fölötte. A közben visszaeső mérések ugyanahhoz az eseményhez tartoznak. 20 percnél hosszabb adatkiesés lezárja az eseményt.</li>
                <li><b>2. szint</b>: közben legalább 15 percig 3,0 alatt.</li>
                <li><b>Éjszakai</b>: 0 és 6 óra között kezdődött.</li>
                <li><b>Előtte</b>: a kezdet előtti 4 órában beadott utolsó gyors hatású adag, a kezdetkor még aktív inzulin, és a 6 órán belüli jegyzetek (pl. sport, alkohol).</li>
                <li><b>Kezelés</b>: a kezdet előtt 15 perccel és a vége után 15 percen belül beírt szénhidrát (a „gyors” jelölés látszik).</li>
                <li><b>Utána</b>: a legmagasabb érték a vége utáni 2 órában; kiemelve, ha a céltartomány fölé ment (túlkezelés lehet).</li>
                <li><b>Megfigyelések</b> (legalább 2 eseménynél): ha a hipók legalább fele bólus utáni 4 órában kezdődött; ha legalább 30%-uk éjszakai vagy túlkezelt; ha bármelyik előtt sport- vagy alkohol-jegyzet volt; és a leggyakoribb kezdési óra, ha abban legalább 2 esemény és az összes 30%-a kezdődött.</li>
              </ul>
              <p class="muted small">Éjszakai, hirtelen eső és kezelés nélkül gyorsan visszaugró értékek mögött kompressziós hipó (a szenzoron fekvés) is lehet.</p>
            </section>

            <!-- 9. Étkezéselemzés -->
            <!-- 8b. Előrejelzés és értesítések -->
            <section id="guide-elorejelzes">
              <h3>Előrejelzés és értesítések</h3>
              <p>A főoldali sáv, a grafikon szaggatott vonala és a telefonos értesítések ugyanazt a becslést használják. A számolás az utolsó mérés időpontjától indul (t = a mérés óta eltelt idő a célidőpontig), így a mérés és a „most” közti inzulin- és CH-hatás sem marad ki.</p>
              <pre class="guide-pre">modell(t) = utolsó érték − Σ adag × (aktív(mérés) − aktív(mérés + t)) × ISF(adag napszaka)
            + Σ szénhidrát × (felszívódott(mérés + t) − felszívódott(mérés)) × (ISF ÷ CH-arány)(étkezés napszaka)

trend(t)  = utolsó érték + meredekség × t        (az utolsó 20 perc legkisebb négyzetes egyenese)
becslés(t) = (modell(t) · w + trend(t)) ÷ (w + 1),   w = 0,1 · 2,5^(t / 5 perc)</pre>
              <p>Minden adag és étkezés a saját beadási (étkezési) napszakának ISF-jével és CH-arányával hat, ezért napszakhatáron nem ugrik a becslés.</p>
              <ul class="guide-ul">
                <li><b>Négy módszer</b>: <i>változatlan</i> (az utolsó érték marad), <i>trend</i> (csillapított meredekség, legfeljebb 20 percig), <i>modell + lendület</i> és <i>keverés</i> (a fenti képlet: rövid távon a trend, hosszabb távon a modell dönt; a modell súlya 5 percenként 2,5-szeresére nő, az xDrip+ megoldásához hasonlóan). A becslés legalább 1,5, legfeljebb 30 mmol/L.</li>
                <li><b>Automatikus módszerválasztás</b>: a Terápia oldali, 14 napos visszateszt alapján a program 15, 30 és 60 percre, külön aktív inzulin / CH mellett és nyugodt időszakban a legkisebb hibájú módszert használja; ha az egyszerűbb legfeljebb 3%-kal rosszabb, az egyszerűbbet. Kevés mintánál (20 alatt) a trend az alap. Így a bonyolultabb modell csak akkor számít, ha a te adataidon tényleg pontosabb.</li>
                <li><b>Előre kiszámolt eredmények</b>: a Terápia oldal nehéz számolásai (becslések, felszívódás, előrejelzés-teszt) éjszaka (04:00 után) és induláskor futnak le, az oldal az utolsó kész eredményt mutatja a számolás időpontjával. Az Újraszámolás gomb azonnal újraszámol; terápia- vagy célbeállítás mentésekor a tárolt eredmények törlődnek és a háttérben újraszámolódnak. Kézi bejegyzés, törlés, típus- vagy CH-jelölés, jegyzet, import és új inzulin / CH után a következő megnyitáskor a háttérben frissülnek (az új szenzormérések nem indítanak újraszámolást); programfrissítés után a régi változatú eredmény nem használható, újraszámolódik.</li>
                <li><b>Hosszú távú érték</b> = utolsó érték − az összes (a mérés óta még) aktív inzulin hatása + az összes még fel nem szívódott CH hatása.</li>
                <li><b>Hipó-veszély</b>: a becsült mélypont (a választott módszer, a trend és a keverés közül óvatosan a legkisebb érték) az előrejelzési távolságon belül a céltartomány alja alá esik (vagy már alatta vagy), és nincs friss kezelés (az utolsó 20 percben legalább 10 g CH).</li>
                <li><b>CH-javaslat</b> = (célérték − mélypont) ÷ (ISF ÷ CH-arány), ahol a mélypont a távon belüli legkisebb becsült érték és a hosszú távú érték közül a kisebb (nagy aktív inzulinnál a mélypont a távon túl is lehet); 5 g-ra kerekítve, 10–30 g között.</li>
                <li><b>Inzulinjavaslat</b>: ha a vércukor és a hosszú távú érték is a céltartomány fölött van, nincs hipó-veszély, ismert a trend és nem esik, 3 E-nél kevesebb az aktív inzulin, és az utolsó bólus óta legalább 1 óra eltelt (az egymásra adott adagok halmozása ellen). Legfeljebb óránként szól. Mennyisége (hosszú távú érték − célérték) ÷ ISF (a kalkulátorhoz hasonlóan a napszakok közti átmenettel), 0,5 E-re lefelé kerekítve, legfeljebb a maximális bólus. Beadás után az aktív inzulin levonása miatt magától megszűnik.</li>
                <li><b>Értesítések</b> (push): a háttér percenként ellenőriz; amíg a helyzet fennáll, a beállított időközönként (alapból 15 percenként) ismétel. A Beállítások oldalon tesztgombokkal próbálható ki.</li>
                <li>A Terápia oldalon az <b>előrejelzés pontossága</b> kártya a saját adataidon összeveti a módszereket a ténylegesen mért értékkel.</li>
              </ul>
            </section>

            <section id="guide-etkezes">
              <h3>Étkezéselemzés (időszakos nézet)</h3>
              <ul class="guide-ul">
                <li><b>Étkezés</b>: a 30 percen belül egymást követő CH-bejegyzések együtt, de legfeljebb 1 órán át (utána új étkezés kezdődik); zsíros, ha bármelyik része az, gyors, ha a CH többsége gyors; hozzá tartozik az étkezés előtt legfeljebb 60 perccel (előbólus) vagy az utolsó CH után legfeljebb 30 perccel beadott étkezési bólus. A CH nélküli adag korrekció, nem étkezés.</li>
                <li><b>Görbe</b>: 5 percenként, a kezdő vércukorhoz képest, 30 perccel előtte kezdve 4 óráig (zsíros / fehérjedús étkezésnél 6 óráig). Csak akkor számít, ha az ablak legalább 70%-ában van szenzoradat.</li>
                <li><b>Tiszta étkezés</b> (a CH-arány becsléséhez): az étkezés / saját bólus előtt 1 óráig nincs más bólus; egy korábbi étkezés CH-ja már felszívódott (a mérete szerinti felszívódási idő, a beállított g/óra ütemből, de legalább normál 4, zsíros 6, gyors 2 óra); 2 órával előtte nincs sport-, betegség- vagy alkohol-jegyzet; nem hipóból indul (a kezdő vércukor nincs a céltartomány alatt: ott a CH a hipó kezelése); a kezdő vércukor nem változik gyorsan (15 perc alatt kevesebb mint 0,11 mmol/L/perc, vagyis kevesebb mint 2 nyíl); és a végpontig (a napszak hatásideje, de legalább 4, zsírosnál 6 óra) nincs más bólus, CH vagy zavaró jegyzet. Ha ilyen csak 3 óra után jön, az étkezés a zavarásig számít (<i>rövidített ablak</i>, lásd a Becslésnél).</li>
                <li><b>Mutatók</b> (mediánok): emelkedés (csúcs − kezdő érték), a csúcs ideje, eltérés 2 és 4 óra múlva, előbólus (a bólus és az étkezés közti idő; negatív = előre adott). A sáv a 25–75%.</li>
                <li><b>Értékelés</b>: <i>alacsony</i>, ha a céltartomány alá ment vagy 4 óra múlva több mint 2 mmol/L-rel alacsonyabb; <i>magas</i>, ha korrekció követte vagy 4 óra múlva több mint 2-vel magasabb; <i>kiugrás</i>, ha a csúcs a céltartomány fölé ment; különben <i>rendben</i>.</li>
                <li><b>Zsíros / fehérjedús</b> jelölés: külön mutatjuk 6 órás görbével, és kimarad a CH-arány becsléséből. <b>Gyors CH</b>: benne marad.</li>
              </ul>
            </section>

            <!-- 10. Becslés -->
            <section id="guide-becsles">
              <h3>Becslés az adataidból (Terápia oldal)</h3>
              <p>Napszakonként legalább 3 tiszta esemény kell a becsléshez, 5 a megbízhatóhoz; a végeredmény a medián.</p>
              <h4>Hatásidő és érzékenység (ISF) – tiszta korrekciókból</h4>
              <ul class="guide-ul">
                <li><b>Tiszta korrekció</b>: 1 órával előtte és utána a beadás napszakára beállított hatásidőig nincs CH, más bólus, sem sport-, betegség- vagy alkohol-jegyzet; a korábbi étkezés CH-ja már felszívódott (a mérete szerinti felszívódási idő, de legalább normál 4, zsíros 6, gyors 2 óra), a korábbi bólusok még ható maradéka legfeljebb a korrekció 15%-a (de legalább 0,25 E), és a kezdő vércukor nem változik gyorsan (1 nyíl alatt); ebben az ablakban legalább 70%-ban van szenzoradat; annyit esett, amennyi az adagból várható (adag × beállított ISF) negyede, legalább 0,3 és legfeljebb 1 mmol/L (pl. 4 E × 0,5 = 2 mmol/L várható → 0,5 elég). Ha utána sem jön étel vagy bólus, a görbét legfeljebb 6 óráig, az első ilyen eseményig tovább használjuk (a hatásidő illesztéséhez). <i>Rövidített ablak</i>: ha a hatásidőn belül, de legalább 3 órával a korrekció után jön étel, bólus vagy zavaró jegyzet (pl. vacsora), a korrekció addig számít; 3 órán belül nem tiszta.</li>
                <li>Minden korrekció esését 1 egységre vetítjük (esés ÷ adag), és 5 percenként vesszük a korrekciók <b>adaggal súlyozott</b> mediánját: egy 1 E-s korrekciónál a mérési zaj és a bázis-sodródás egységnyire vetítve négyszer akkora, mint egy 4 E-snél, ezért a kis adagok kevesebbet számítanak.</li>
                <li>Erre illesztjük a fenti inzulinmodellt: hatásidő 2 órától a Terápia oldalon kiválasztott bólusinzulin alkalmazási előírás szerinti leghosszabb hatásidejéig (NovoRapid: 5 óra), 15 percenként; csúcs 40–120 perc (5 percenként, legfeljebb a hatásidő 40%-a). Minden párra az esés nagysága zárt alakban adódik: <code class="guide-f">esés(t) ≈ ISF × (1 − aktív(t))</code>, a legkisebb négyzetek módszerével; a legkisebb eltérésű pár nyer. Az amplitúdó az ISF.</li>
                <li><b>Nem megbízható</b>, ha határ nélkül hosszabb hatásidő illene jobban, vagyis a vércukor az inzulin leghosszabb hatásidején túl is esett. Ezt az inzulin nem magyarázza (inkább a bázis vagy más tényező), ezért ilyenkor a hatásidő és az érzékenység nem kerül át a szerkesztőbe.</li>
                <li><b>A görbe vége</b>: ahol az események felénél (de legalább 3 eseménynél) kevesebbnél van adat, ott a medián nem számít bele az illesztésbe. Ha az így megmaradó görbe rövidebb, mint az illesztett hatásidő (30 percnél jobban), az ISF és a hatásidő <b>nem megbízható</b>: a görbe vége kevés (főleg éjszakai) eseményből állna.</li>
                <li><b>Napszakhatár</b>: minden esemény a beadás (étkezés) időpontjának napszakához tartozik, akkor is, ha a hatása átnyúlik a következőbe; a hatásidő is a beadás napszakáé.</li>
              </ul>
              <h4>CH-arány – tiszta étkezésekből</h4>
              <pre class="guide-pre">végpont = a napszak hatásideje, de legalább 4 és legfeljebb 6 óra (zsírosnál 6 óra; rövidített ablaknál a zavarás)
hatott inzulin = Σ bólus × (aktív(étkezéskor) − aktív(végpontban))
étkezésre jutó inzulin = hatott inzulin + (érték a végpontban − kezdő érték) ÷ ISF
CH-arány = felszívódott szénhidrát ÷ étkezésre jutó inzulin</pre>
              <p>
                <b>Rövidített ablak</b>: ha a tiszta étkezést legalább 3 óra után megzavarja valami (korrekció, ráevés, hipó
                kezelése, sport / betegség / alkohol jegyzet), az étkezés a zavarásig számít, végpontja a zavarás időpontja.
                3 órán belüli zavarásnál nem számít. A képletben a szénhidrátból csak a végpontig felszívódott rész szerepel
                (az alapértelmezett felszívódási modellből, a beállított g/óra ütemmel); ez a teljes ablakú, nagy étkezéseknél is
                érvényes. A rövidített étkezések a tanult felszívódási görbébe nem kerülnek be.
              </p>
              <p>
                A „hatott inzulin” az étkezés és a végpont között ténylegesen hatott rész: a saját bólus(ok), és a korábbi (de
                1 óránál régebbi) bólusok még ható maradéka, a fenti inzulinmodellel, a beadás napszakának hatásidejével.
              </p>
              <p>
                Vagyis: ha a végpontban magasabb vagy, több inzulin kellett volna (kisebb g/E), ha alacsonyabb, kevesebb. Az ISF itt a
                beállított érték, ezért ha az ISF rossz, a CH-arány becslése is torz – előbb az ISF-et érdemes rendbe tenni.
                Zsíros étkezések nem számítanak; 0,2 E-nél kisebb eredményt kihagyunk.
              </p>
              <p>
                <b>Megbízhatóság</b>: ha a tiszta étkezések legalább felénél a vércukor a végpont előtti fél órában még több mint
                0,6 mmol/L-t emelkedik, a szénhidrát nem szívódott fel teljesen, és a CH-arány túl nagy (kevés inzulin) lehet:
                ilyenkor „még emelkedik” jelzést kap, és a „Becslések beírása” nem veszi át. Azt a CH-arányt sem veszi át, amelyik
                mellett az ISF is több mint 10%-kal változna, mert a CH-arány a régi ISF-fel készült. Zsíros / fehérjedús étkezésnél a végpont 6 óra.
              </p>
              <p>
                <b>Bázis-sodródás</b>: ha egy napszak böjti időszakaiban (lásd a Bázisellenőrzést) a vércukor átlagosan legalább
                0,3 mmol/L-t változik óránként (legalább 3 óra adatból, 3 különböző napról), a bázis nem fedi az alapigényt, és ez
                a korrekciók esését és az étkezések végpontját is torzítja: a napszak ISF-, hatásidő- és CH-arány-becslése
                „nem megbízható” lesz (a táblázatban „sodródás” jelöli), és a „Becslések beírása” nem veszi át.
              </p>
              <p>
                <b>Tájékoztató kiinduló érték</b>: a Terápia oldal az utolsó 30 nap átlagos napi összinzulinjából (TDD, bázissal)
                kiírja az ökölszabályok szerinti értéket: <code class="guide-f">ISF ≈ 100 ÷ TDD</code> (mmol/L/E) és
                <code class="guide-f">CH-arány ≈ 500 ÷ TDD</code> (g/E). Ezek csak kiindulópontok; figyelmeztetés csak akkor jelenik
                meg, ha a beállított ISF több mint kétszeresen eltér ettől.
              </p>
              <p>
                A <b>tiszta étkezések görbéje</b> napszakonként mutatja a vércukor változását a kezdő értékhez képest (medián,
                legalább 3 étkezésnél 25–75%-os sávval). Ha 4 óra múlva 1 mmol/L-nél többel a kezdő érték fölött marad, a CH-arány
                gyenge lehet; ha 1-nél többel alatta, erős.
              </p>
            </section>

            <!-- 11. Bázis -->
            <section id="guide-bazis">
              <h3>Bázisellenőrzés</h3>
              <ul class="guide-ul">
                <li><b>Kizárt időszakok</b>: étkezés után 4 óra (zsírosnál 6, gyors CH-nál 2), minden bólus után a hatásideje, és minden céltartomány alatti mérés után 2 óra.</li>
                <li>A maradék „böjt” időben 5 percenként vesszük a 15 perccel későbbi értékhez képesti változást, és óránkénti sebességre váltjuk (mmol/L/óra), ha mindkét időpont böjt.</li>
                <li>Óránként és négy napszakra (0–4, 4–8, 8–12, 12–24 óra) átlagolunk. <b>Stabil</b>: ±0,3 mmol/L/óra (6 óra alatt kb. ±1,7); fölötte emelkedik, alatta csökken. 1 óránál kevesebb adatnál „kevés adat”.</li>
                <li>Tartós emelkedés vagy esés egy napszakban a bázis vagy a napszak beállításának jele lehet.</li>
              </ul>
            </section>

            <!-- 12. Labor -->
            <section id="guide-labor">
              <h3>Labor HbA1c és GMI</h3>
              <p>
                Minden beírt labor HbA1c mellé a labor előtti 90 nap szenzoradataiból számolt GMI kerül (a HbA1c nagyjából az
                előző 2–3 hónap átlagát tükrözi), az eltéréssel és a 90 napos lefedettséggel. 20 fölötti beírt értéket mmol/mol-nak
                veszünk: <code class="guide-f">% = mmol/mol ÷ 10,929 + 2,15</code>. 0,5 százalékpontos eltérés gyakori és egyéni
                (pl. a vörösvérsejtek élettartama miatt).
              </p>
            </section>

            <!-- 12b. Napi grafikon -->
            <section id="guide-grafikon">
              <h3>Napi grafikon részletei</h3>
              <ul class="guide-ul">
                <li><b>Átlógás az előző / következő napra</b>: ha az inzulin vagy a szénhidrát hatása éjfél után is tart, vagy az előző napról még hat, a tengely meghosszabbodik (legfeljebb 8 óra). Az átlógó szakasz halványabb, az éjfelet szaggatott vonal jelzi; látszik az adag oszlopa, a hatásgörbe, és a szomszéd nap vércukra is.</li>
                <li><b>Napi összinzulin</b>: a beadás időpontja szerint számít (az este 23-kor beadott adag teljes egészében aznapé), a hatásgörbe az átlógó szakaszon látszik.</li>
                <li><b>Előrejelzés</b>: a mai napon a görbe végén szaggatott vonal (2, 3 vagy 4 óra, állítható). A felvett adagokból és CH-ból számol; új étkezést vagy adagot nem ismer.</li>
                <li><b>Kézi vércukor</b>: rombusz jelöli. Pontos mérésként beleszámít az átlagba, a célban töltött időbe és a hipóesemények felismerésébe, de a szenzorlefedettségbe, a trendnyílba és a görbe vonalába nem.</li>
              </ul>
            </section>

            <!-- 13. Korlátok -->
            <section id="guide-korlatok">
              <h3>Korlátok</h3>
              <ul class="guide-ul">
                <li>A CGM kb. 10%-ot téved, és 5–15 percet késik az ujjbegyes méréshez képest; gyors változásnál többet.</li>
                <li>Az aktív inzulin csak a beírt adagokból számol: a be nem írt (vagy később beírt) adag addig hiányzik belőle.</li>
                <li>A modell nem ismeri a sportot, betegséget, stresszt, alkoholt és a beadás helyét; a zsír / fehérje késői hatását csak a „zsíros” jelölt étkezésekre tanulja meg.</li>
                <li>Az előrejelzés és a javaslatok becslések: új étkezést, adagot nem ismernek, a CareLink-adat késhet, és nem helyettesítik a szenzor és a pumpa riasztásait. Az inzulinjavaslat beadás előtt ellenőrzendő.</li>
                <li>A becslések kevés eseményből szórnak; mindig a darabszámmal együtt értelmezd őket.</li>
                <li>Saját nyilvántartás, nem orvostechnikai eszköz. Kezelési döntéshez a Guardian app értékeit és a diabetológusod útmutatását használd.</li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
