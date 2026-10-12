<script setup lang="ts">
// Az InPen-automatizálás képernyőképe (public/guide/).
const AUTOMATION_SHOT = '/guide/automatizalas.webp'
import widgetTemplate from '../../docs/scriptable-widget.js?raw'
// Telefonos beállító varázsló: kapcsolatteszt, InPen → Egészség, küldés módja, beállítás, próba.
const { data: s } = await useFetch('/api/settings')
const token = computed(() => s.value?.token ?? '')
const ingestUrl = computed(() => (import.meta.client ? window.location.origin : '') + '/api/ingest')

// Scriptable-widget: a szkript sablonja, a saját címeddel és kulcsoddal kitöltve (csak bejelentkezve érhető el).
const widgetCopied = ref(false)
async function copyWidget() {
  const code = widgetTemplate
    .replace(/const URL_BASE = '[^']*'/, () => `const URL_BASE = '${window.location.origin}'`)
    .replace(/const KULCS = '[^']*'/, () => `const KULCS = '${token.value}'`)
  try {
    await navigator.clipboard.writeText(code)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = code
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  widgetCopied.value = true
  setTimeout(() => (widgetCopied.value = false), 2000)
}

function isLanUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const [a, b] = h.split('.').map(Number)
      return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
    }
    return false
  } catch {
    return false
  }
}
const lan = computed(() => isLanUrl(ingestUrl.value))

const steps = ['Kapcsolat', 'InPen', 'Küldés módja', 'Beállítás', 'Próba']
const step = ref(1)
const method = ref<'hae' | 'sc' | ''>('')
function goMethod(m: 'hae' | 'sc') { method.value = m; step.value = 4 }

// --- Élő próba: a /api/status figyelése ---
const liveStatus = ref('Várakozás az adatra…')
const liveCounts = ref<{ glucose: number; insulin: number; carbs: number } | null>(null)
const liveClass = ref('')
let startTs = 0
let timer: any = null
async function poll() {
  try {
    const d: any = await $fetch('/api/status')
    if (d.ok) {
      liveCounts.value = d.counts
      if (d.last && d.last.at >= startTs) {
        const warn = d.last.errors?.length && !d.last.inserted && !d.last.duplicates
        liveClass.value = warn ? 'warn' : 'ok'
        liveStatus.value = `✓ Adat érkezett: ${d.last.inserted} új, ${d.last.duplicates} már megvolt` +
          (d.last.errors?.length ? ` · hibás sorok: ${d.last.errors.join(' · ')}` : '')
      }
    }
  } catch { /* hálózati hiba, újrapróbáljuk */ }
  timer = setTimeout(poll, 3000)
}
watch(step, (v) => {
  if (v === 5 && !timer) { startTs = Math.floor(Date.now() / 1000) - 5; poll() }
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <main>
    <ol class="stepper" aria-label="Lépések">
      <li v-for="(label, i) in steps" :key="i" :class="i + 1 === step ? 'current' : (i + 1 < step ? 'done' : '')">
        <span>{{ i + 1 }}</span>{{ label }}
      </li>
    </ol>

    <!-- 1. Kapcsolat -->
    <section v-if="step === 1" class="card wizard">
      <h1>Eléri-e a telefon a szervert?</h1>
      <ol class="steps">
        <li v-if="lan">Csatlakoztasd az iPhone-t <b>ugyanarra a wifire</b>, amin ez a gép van.</li>
        <li v-else>Az iPhone bármilyen hálózatról elérheti (wifi, mobilnet), nem kell ugyanazon a wifin lennie.</li>
        <li>Nyisd meg iPhone-on a <b>Safari</b>t, és írd be ezt a címet:
          <div class="value"><CopyChip :value="ingestUrl" /></div>
        </li>
        <li>Nézd meg, mit ír ki:
          <table class="table outcomes">
            <tbody>
              <tr><td class="ok">✓</td><td><code>{"ok":false,"error":"Csak POST kérést fogadok."}</code></td><td><b>Rendben</b>, mehetsz tovább.</td></tr>
              <tr v-if="lan"><td class="bad">✕</td><td>Sokáig tölt, majd hiba</td><td>A telefon nem látja a gépet: nem ugyanaz a wifi, vagy a tűzfal tiltja. Próbáld a gép <b>Mobil hotspot</b>jával.</td></tr>
              <tr v-else><td class="bad">✕</td><td>Tanúsítványhiba / „nem biztonságos”</td><td>A HTTPS még nincs kész. A reverse proxy a domain HTTPS-ét a szerver portjára irányítsa.</td></tr>
            </tbody>
          </table>
        </li>
      </ol>
      <div class="nav-row"><span /><button class="btn" @click="step = 2">Működik, tovább →</button></div>
    </section>

    <!-- 2. InPen -->
    <section v-else-if="step === 2" class="card wizard">
      <h1>InPen → Egészség app</h1>
      <p>Az InPen app beírja az adagokat és a szénhidrátot az iPhone Egészség appjába, onnan küldjük tovább.</p>
      <ol class="steps">
        <li><b>InPen app</b> → <b>Settings</b> → <b>Connections</b> → <b>Apple Health</b> → <b>Turn All Categories On</b>.</li>
        <li>Ellenőrzés: <b>Egészség app</b> → <b>Böngészés</b> → <b>Inzulinadagolás</b>. Ott kell látnod a mai InPen-adagokat.</li>
        <li>Ugyanígy nézd meg a <b>Szénhidrátok</b>at és a <b>Vércukor</b>t is.</li>
      </ol>
      <p class="muted">Ha a Vércukor üres, a Guardian app nem ír az Egészség appba. Ilyenkor a napló csak inzulint és CH-t mutat, a glükózt a CareLinkben látod.</p>
      <div class="nav-row"><button class="btn ghost" @click="step = 1">← Vissza</button><button class="btn" @click="step = 3">Tovább →</button></div>
    </section>

    <!-- 3. Küldés módja -->
    <section v-else-if="step === 3" class="card wizard">
      <h1>Hogyan küldje a telefon az adatokat?</h1>
      <div class="choices">
        <button class="choice" @click="goMethod('hae')">
          <span class="tag">Ajánlott</span>
          <b>Health Auto Export app</b>
          <span>Csak be kell állítani, kb. 5 perc. Fizetős, 7 nap ingyenes próbával.</span>
        </button>
        <button class="choice" @click="goMethod('sc')">
          <b>Parancsok app (ingyenes)</b>
          <span>A telefonon kézzel kell összerakni egy parancsot, kb. 15 perc.</span>
        </button>
      </div>
      <div class="nav-row"><button class="btn ghost" @click="step = 2">← Vissza</button><span /></div>
    </section>

    <!-- 4. Beállítás: Health Auto Export -->
    <section v-else-if="step === 4 && method === 'hae'" class="card wizard">
      <h1>Health Auto Export beállítása</h1>
      <ol class="steps">
        <li>Telepítsd az App Store-ból: <b>Health Auto Export – JSON+CSV</b>. Nyisd meg, és engedélyezd az Egészség-hozzáférést (Vércukor, Inzulinadagolás, Szénhidrátok).</li>
        <li>Alul az <b>Automations</b> fül → <b>+</b> → típus: <b>REST API</b>.</li>
        <li>Töltsd ki így:
          <table class="table form-map">
            <tbody>
              <tr><td>URL</td><td><CopyChip :value="ingestUrl" /></td></tr>
              <tr><td>Header</td><td>Key: <CopyChip value="X-Token" /><br>Value: <CopyChip :value="token" /></td></tr>
              <tr><td>Data Type</td><td>Health Metrics</td></tr>
              <tr><td>Metrics</td><td>Csak ez a három: <b>Blood Glucose</b>, <b>Insulin Delivery</b>, <b>Carbohydrates</b></td></tr>
              <tr><td>Export Format</td><td><b>JSON</b></td></tr>
              <tr><td>Aggregate Data</td><td><b>Kikapcsolva</b> (vagy a legkisebb Time Grouping)</td></tr>
              <tr><td>Sync Cadence</td><td>pl. 15 perc vagy 1 óra</td></tr>
            </tbody>
          </table>
        </li>
        <li>Mentsd el, és kapcsold be (Enabled).</li>
      </ol>
      <div class="nav-row"><button class="btn ghost" @click="step = 3">← Vissza</button><button class="btn" @click="step = 5">Kész, jöhet a próba →</button></div>
    </section>

    <!-- 4. Beállítás: Parancsok -->
    <section v-else-if="step === 4 && method === 'sc'" class="card wizard">
      <h1>Parancs összerakása (Parancsok app)</h1>
      <p>Először csak a <b>vércukor</b>-parancsot rakd össze és próbáld ki. Ha működik, lemásolod az inzulinhoz és a szénhidráthoz.</p>
      <h2>A) Új parancs</h2>
      <p>Parancsok app → <b>Parancsok</b> fül → <b>+</b> → nevezd el: <CopyChip value="Vércukor küldés" /></p>
      <h2>B) Műveletek, ebben a sorrendben</h2>
      <div class="actions">
        <div class="action">
          <div class="action-title"><span>1</span>Egészségügyi minták keresése</div>
          <table class="table form-map"><tbody>
            <tr><td>Típus</td><td><b>Vércukor</b></td></tr>
            <tr><td>Dátum</td><td>Kezdő dátum → az utolsó → <b>3 nap</b></td></tr>
            <tr><td>Mértékegység</td><td><b>mmol/L</b></td></tr>
            <tr><td>Rendezés</td><td>Kezdő dátum, legrégebbi elöl</td></tr>
            <tr><td>Korlát</td><td><b>kikapcsolva</b></td></tr>
          </tbody></table>
        </div>
        <div class="action">
          <div class="action-title"><span>2</span>Egészségügyi minta részleteinek lekérése</div>
          <p>Részlet: <b>Kezdő dátum</b> (bemenet: Egészségügyi minták).</p>
        </div>
        <div class="action">
          <div class="action-title"><span>3</span>Szöveg egyesítése</div>
          <p>Bemenet: a 2. lépés eredménye. Elválasztó: <b>Új sor</b>.</p>
        </div>
        <div class="action">
          <div class="action-title"><span>4</span>Egészségügyi minta részleteinek lekérése <small>(még egyszer)</small></div>
          <p>Részlet: <b>Érték</b>. A bemenet az <b>Egészségügyi minták</b> legyen (nem az Egyesített szöveg!).</p>
        </div>
        <div class="action">
          <div class="action-title"><span>5</span>Szöveg egyesítése <small>(még egyszer)</small></div>
          <p>Bemenet: a 4. lépés (Érték). Elválasztó: <b>Új sor</b>.</p>
        </div>
        <div class="action">
          <div class="action-title"><span>6</span>URL tartalmának lekérése</div>
          <div class="value"><CopyChip :value="ingestUrl" /></div>
          <table class="table form-map"><tbody>
            <tr><td>Metódus</td><td><b>POST</b></td></tr>
            <tr><td>Fejléc</td><td>Kulcs: <CopyChip value="X-Token" /><br>Szöveg: <CopyChip :value="token" /></td></tr>
            <tr><td>Kérés törzse</td><td><b>Űrlap</b>, három <b>Szöveg</b> mező:</td></tr>
            <tr><td>1. mező</td><td>Kulcs: <CopyChip value="type" /> · Szöveg: <CopyChip value="glucose" /></td></tr>
            <tr><td>2. mező</td><td>Kulcs: <CopyChip value="dates" /> · Szöveg: a 3. lépés Egyesített szövege</td></tr>
            <tr><td>3. mező</td><td>Kulcs: <CopyChip value="values" /> · Szöveg: az 5. lépés Egyesített szövege</td></tr>
          </tbody></table>
        </div>
        <div class="action">
          <div class="action-title"><span>7</span>Eredmény megjelenítése</div>
          <p>Csak a próbához. Futtasd ▶. Siker: <code>{"ok":true,"inserted":288,…}</code></p>
        </div>
      </div>
      <h2>C) Inzulin és szénhidrát</h2>
      <p>Ha a vércukor-parancs működik: <b>Duplikálás</b> kétszer. A másolatokban csak ezt írd át:</p>
      <table class="table form-map"><tbody>
        <tr><th /><th>Inzulin</th><th>Szénhidrát</th></tr>
        <tr><td>1. Típus</td><td><b>Inzulinadagolás</b></td><td><b>Szénhidrátok</b></td></tr>
        <tr><td>1. Mértékegység</td><td><b>NE</b></td><td><b>g</b></td></tr>
        <tr><td>6. <code>type</code> mező</td><td><CopyChip value="insulin" /></td><td><CopyChip value="carbs" /></td></tr>
      </tbody></table>

      <h2>Minta: a kész szénhidrát-parancs</h2>
      <p class="muted small">
        Így néz ki egy működő szénhidrát-parancs. A vércukornál a típus <b>Vércukor</b>, a mértékegység <b>mmol/L</b>, a
        <code>type</code> mező <code>glucose</code>; az inzulinnál <b>Inzulinadagolás</b>, <b>NE</b>, <code>insulin</code>.
        A rendezés mindegy (a szerver az időpont szerint tárol), és a képen látható régi <code>/api/ingest.php</code> cím is működik.
        A kulcs helyén a saját kulcsod legyen. Koppints a képre a nagyobb változathoz.
      </p>
      <div class="shot-row">
        <figure>
          <a href="/guide/parancs-1.webp" target="_blank" rel="noopener"><img src="/guide/parancs-1.webp" width="240" height="403" loading="lazy" alt="Egészségügyi minták keresése: típus Szénhidrát, kezdési dátum az előző 3 napban, mértékegység g, korlát kikapcsolva"></a>
          <figcaption>1. Egészségügyi minták keresése</figcaption>
        </figure>
        <figure>
          <a href="/guide/parancs-2.webp" target="_blank" rel="noopener"><img src="/guide/parancs-2.webp" width="240" height="403" loading="lazy" alt="Kezdési dátum és Érték lekérése az egészségügyi mintákból, mindkettő egyesítése új sorok elválasztóval"></a>
          <figcaption>2–5. Dátumok és értékek egyesítése</figcaption>
        </figure>
        <figure>
          <a href="/guide/parancs-3.webp" target="_blank" rel="noopener"><img src="/guide/parancs-3.webp" width="240" height="403" loading="lazy" alt="URL tartalmának lekérése: POST, X-Token fejléc, űrlap type, dates és values mezőkkel"></a>
          <figcaption>6. URL tartalmának lekérése</figcaption>
        </figure>
      </div>

      <h2>D) Biztonsági mentés a parancsokról</h2>
      <ul class="steps">
        <li><b>iCloud</b> (a legegyszerűbb): iPhone Beállítások → a neved → iCloud → az alkalmazások listájában a <b>Parancsok</b> legyen bekapcsolva. Így új telefonra is átjönnek, és az iPhone iCloud-mentése is tartalmazza őket.</li>
        <li><b>Fájlba</b>: a Parancsok appban nyomd hosszan a parancsot → <b>Megosztás</b> → fent a <b>Beállítások</b> → <b>Fájl</b> → Kész → <b>Mentés a Fájlokba</b>. Egy <code>.shortcut</code> fájl lesz belőle, amit később egy koppintással visszaimportálhatsz.</li>
        <li>A mentett parancsban benne van a kulcsod (X-Token). Ne oszd meg, és ne használj nyilvános iCloud-linket. Ha mégis kikerülne, a Beállítások oldalon generálj új kulcsot, és írd át a parancsokban.</li>
      </ul>
      <div class="nav-row"><button class="btn ghost" @click="step = 3">← Vissza</button><button class="btn" @click="step = 5">Kész, jöhet a próba →</button></div>
    </section>

    <!-- fallback, ha a 4. lépésre mód nélkül érne -->
    <section v-else-if="step === 4" class="card wizard">
      <p>Válaszd ki a küldés módját.</p>
      <div class="nav-row"><button class="btn ghost" @click="step = 3">← Vissza</button><span /></div>
    </section>

    <!-- 5. Próba -->
    <section v-else-if="step === 5" class="card wizard">
      <h1>Próba és automatikus küldés</h1>
      <ol class="steps">
        <li v-if="method === 'hae'">A Health Auto Exportban nyisd meg a Cukornapló automatizmust, és nyomd meg a <b>Manual Export</b> gombot.</li>
        <li v-else>A Parancsok appban futtasd a parancsot (vércukor/inzulin/CH).</li>
        <li>Ez az oldal magától frissül, amint megérkezik az adat:</li>
      </ol>
      <div class="live" :class="liveClass">
        <div class="live-status">{{ liveStatus }}</div>
        <div v-if="liveCounts" class="live-counts">
          <span>Glükóz: <b>{{ liveCounts.glucose }}</b></span>
          <span>Inzulin: <b>{{ liveCounts.insulin }}</b></span>
          <span>Szénhidrát: <b>{{ liveCounts.carbs }}</b></span>
        </div>
      </div>
      <p v-if="method === 'hae'" class="muted small">Automatikus küldéshez a Health Auto Export a beállított gyakorisággal magától küld.</p>
      <template v-else>
        <h2>Automatikus küldés (Parancsok → Automatizálás)</h2>
        <ol class="steps">
          <li>Parancsok app → <b>Automatizálás</b> fül → <b>+</b> → <b>App</b>.</li>
          <li>App: <b>InPen</b>; jelöld be: <b>megnyitáskor</b> és <b>bezáráskor</b>; válaszd az <b>Azonnali futtatás</b>t (különben minden alkalommal rákérdez).</li>
          <li>Új üres parancs, benne három <b>Parancs futtatása</b> művelet egymás után: <b>Inzulin</b>, <b>Szénhidrát</b>, <b>Vércukor</b> (a saját parancsaid nevei).</li>
        </ol>
        <p class="muted small">Így minden InPen-használat után magától felmegy az utolsó 3 nap; a már meglévő adatokat a szerver nem duplázza.</p>
        <figure v-if="AUTOMATION_SHOT" class="shot-single">
          <a :href="AUTOMATION_SHOT" target="_blank" rel="noopener"><img :src="AUTOMATION_SHOT" width="240" height="318" loading="lazy" alt="Automatizálás: InPen megnyitásakor vagy bezárásakor az Inzulin, a Szénhidrát és a Vércukor parancs futtatása"></a>
          <figcaption>Minta: az InPen-automatizálás</figcaption>
        </figure>
      </template>
      <div class="nav-row"><button class="btn ghost" @click="step = 4">← Vissza</button><NuxtLink class="btn" to="/">Kész, irány a napló →</NuxtLink></div>
    </section>

    <section class="card">
      <h2>Widget a telefon képernyőjére</h2>
      <p class="muted small">
        Vércukor, trendnyíl, aktív szénhidrát (CH), aktív inzulin (B) és a 3 órás vonal a kezdő- vagy zárképernyőn.
        A kitöltött szkript tartalmazza a címedet és a kulcsodat, ezért csak bejelentkezve másolható; ne oszd meg.
      </p>
      <ol class="steps">
        <li>Telepítsd az ingyenes <b>Scriptable</b> appot.</li>
        <li>Nyomd meg az alábbi gombot, majd a Scriptable-ben: <b>+</b> (új szkript) → illeszd be → mentsd.</li>
        <li>Widget kitétele: asztal hosszan nyomva → <b>+</b> → <b>Scriptable</b> (kicsi, zárképernyőn téglalap vagy kör) → koppints rá → <b>Script</b>: a mentett szkript.</li>
      </ol>
      <div class="btn-row"><button type="button" :disabled="!token" @click="copyWidget">{{ widgetCopied ? 'Másolva ✓' : 'Kitöltött szkript másolása' }}</button></div>
    </section>
  </main>
</template>
