<script setup lang="ts">
const { data, refresh } = await useFetch('/api/settings')
const auth = useState<{ hasPassword: boolean; authed: boolean }>('auth')

const message = ref('')
const alert = ref('')
const importErrors = ref<string[]>([])

function flash(ok: string, bad = '') { message.value = ok; alert.value = bad }

const ingestUrl = computed(() => (import.meta.client ? window.location.origin : '') + '/api/ingest')

const labels: Record<string, string> = { glucose: 'Glükóz', insulin: 'Inzulin', carbs: 'Szénhidrát' }
function dt(ts: number | null): string {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* nem támogatott */ }
}

// --- CareLink belépési cím (ha nincs összekötve) ---
const clAuthUrl = ref('')
const clAuthErr = ref('')
const clCode = ref('')
async function loadAuthUrl() {
  const r: any = await $fetch('/api/carelink/authorize-url')
  if (r.ok) clAuthUrl.value = r.url
  else clAuthErr.value = r.error
}
onMounted(() => { if (!data.value?.carelink.connected) loadAuthUrl() })

// --- műveletek ---
const busy = ref('')

// Passkey-k (Face ID / Touch ID)
const { data: passkeys, refresh: pkRefresh } = await useFetch<{ id: string; name: string; createdAt: number; lastUsed: number | null }[]>('/api/auth/passkey/list')
const pkName = ref('')
const pkMsg = ref('')
const pkErr = ref('')
const pkSupported = ref(false)
onMounted(() => { pkSupported.value = !!window.PublicKeyCredential })
async function pkAdd() {
  busy.value = 'pk'; pkMsg.value = ''; pkErr.value = ''
  try {
    const { startRegistration } = await import('@simplewebauthn/browser')
    const optionsJSON = await $fetch<any>('/api/auth/passkey/register-options', { method: 'POST' })
    const response = await startRegistration({ optionsJSON })
    await $fetch('/api/auth/passkey/register-verify', { method: 'POST', body: { response, name: pkName.value } })
    pkName.value = ''
    pkMsg.value = 'A passkey hozzáadva. Legközelebb Face ID-val is beléphetsz.'
    await pkRefresh()
    if (auth.value) (auth.value as any).hasPasskey = true
  } catch (e: any) {
    if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') pkErr.value = e?.data?.error ?? e?.message ?? 'A passkey hozzáadása nem sikerült.'
  } finally {
    busy.value = ''
  }
}
async function pkDelete(id: string) {
  if (!confirm('Biztosan törlöd ezt a passkey-t?')) return
  busy.value = 'pk'
  try {
    await $fetch('/api/auth/passkey/delete', { method: 'POST', body: { id } })
    await pkRefresh()
    if (auth.value) (auth.value as any).hasPasskey = !!passkeys.value?.length
  } finally {
    busy.value = ''
  }
}
async function regenToken() {
  if (!confirm('Biztos? A régi kulccsal ezután nem lehet adatot küldeni.')) return
  busy.value = 'token'
  await $fetch('/api/token/regen', { method: 'POST' })
  await refresh()
  busy.value = ''
  flash('Új kulcs készült. A telefonon (Health Auto Export vagy Parancsok) is írd át!')
}

const importText = ref('')
const importFile = ref<File | null>(null)
async function doImport() {
  busy.value = 'import'
  importErrors.value = []
  try {
    const fd = new FormData()
    fd.append('lines', importText.value)
    if (importFile.value) fd.append('file', importFile.value)
    const r: any = await $fetch('/api/import', { method: 'POST', body: fd })
    importErrors.value = r.errors ?? []
    flash(`Import kész: ${r.inserted} új, ${r.duplicates} már megvolt, ${r.rejected} hibás sor.`)
    importText.value = ''
    importFile.value = null
    await refresh()
  } catch (e: any) {
    flash('', e?.data?.error ?? 'Az import nem sikerült.')
  } finally {
    busy.value = ''
  }
}

async function clConnect() {
  busy.value = 'cl-connect'
  try {
    const r: any = await $fetch('/api/carelink/connect', { method: 'POST', body: { code: clCode.value } })
    if (r.ok) {
      clCode.value = ''
      const p = r.poll
      flash(`CareLink kapcsolat kész: ${r.session?.name || r.session?.username}. ` +
        (p?.ok ? `Első lekérés: ${p.received} érték, ${p.inserted} új.` : `Az első lekérés hibát adott: ${p?.error}`))
      await refresh()
    } else {
      flash('', r.error)
    }
  } finally {
    busy.value = ''
  }
}
async function clPoll() {
  busy.value = 'cl-poll'
  const r: any = await $fetch('/api/carelink/poll', { method: 'POST' })
  await refresh()
  busy.value = ''
  r.ok ? flash(`CareLink: ${r.received} érték, ${r.inserted} új` + (r.latest ? `, a legfrissebb ${new Date(r.latest * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}-kor.` : '.'))
    : flash('', 'CareLink hiba: ' + r.error)
}
async function clPatient(e: Event) {
  busy.value = 'cl-patient'
  await $fetch('/api/carelink/patient', { method: 'POST', body: { patient: (e.target as HTMLSelectElement).value } })
  await refresh()
  busy.value = ''
  flash('Páciens beállítva.')
}
async function clDisconnect() {
  if (!confirm('Biztos törlöd a CareLink kapcsolatot? A letöltött adatok megmaradnak.')) return
  await $fetch('/api/carelink/disconnect', { method: 'POST' })
  clAuthUrl.value = ''
  await refresh()
  await loadAuthUrl()
  flash('A CareLink kapcsolat törölve. A már letöltött adatok megmaradnak.')
}

async function resetDb() {
  if (!confirm('Biztos törlöd az ÖSSZES mért adatot? Ez nem vonható vissza. A jelszó és a CareLink kapcsolat megmarad.')) return
  const r: any = await $fetch('/api/reset', { method: 'POST', body: { confirm: true } })
  await refresh()
  flash(`Törölve: ${r.deleted} bejegyzés.`)
}
async function factoryReset() {
  if (!confirm('MINDENT töröl: a mért adatokat, a jelszót, a passkey-ket, az API-kulcsot és a CareLink kapcsolatot is. Utána elölről kell beállítani. Biztos?')) return
  await $fetch('/api/factory-reset', { method: 'POST', body: { confirm: true } })
  if (auth.value) { auth.value.hasPassword = false; auth.value.authed = false }
  await navigateTo('/setup')
}
</script>

<template>
  <main v-if="data">
    <p v-if="alert" class="alert">{{ alert }}</p>
    <p v-if="message" class="notice">{{ message }}</p>

    <section class="card">
      <h2>Tárolt adatok</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Típus</th><th class="num">Bejegyzés</th><th>Első</th><th>Utolsó</th></tr></thead>
          <tbody>
            <tr v-for="(c, type) in data.counts" :key="type">
              <td>{{ labels[type] }}</td>
              <td class="num">{{ c.count }}</td>
              <td>{{ dt(c.first) }}</td>
              <td>{{ dt(c.last) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted">
        Utolsó adatfogadás:
        <template v-if="data.last">
          {{ dt(data.last.at) }} ({{ data.last.via }}): {{ data.last.inserted }} új, {{ data.last.duplicates }} már megvolt<template v-if="data.last.errors?.length">, hibák: {{ data.last.errors.join(' · ') }}</template>
        </template>
        <template v-else>még nem érkezett adat.</template>
      </p>
    </section>

    <section class="card" id="carelink">
      <h2>CareLink: folyamatos szenzorgörbe</h2>
      <template v-if="data.carelink.connected">
        <div class="table-wrap">
          <table class="table form-map">
            <tbody>
              <tr><td>Fiók</td><td>{{ data.carelink.session?.name || data.carelink.session?.username || '–' }} <span class="muted">({{ data.carelink.session?.role }})</span></td></tr>
              <tr v-if="data.carelink.session?.patients?.length">
                <td>Követett páciens</td>
                <td>
                  <select v-if="data.carelink.session.patients.length > 1" :value="data.carelink.patient || data.carelink.session.patients[0].username" @change="clPatient">
                    <option v-for="p in data.carelink.session.patients" :key="p.username" :value="p.username">{{ p.name || p.username }} ({{ p.device }})</option>
                  </select>
                  <span v-else>{{ data.carelink.session.patients[0].name || data.carelink.session.patients[0].username }} <span class="muted">({{ data.carelink.session.patients[0].device }})</span></span>
                </td>
              </tr>
              <tr><td>Utolsó lekérés</td><td>{{ dt(data.carelink.lastPollAt) }}</td></tr>
              <tr><td>Utolsó sikeres</td><td>{{ data.carelink.lastOkAt ? dt(data.carelink.lastOkAt) + ' · ' + (data.carelink.lastCount ?? 0) + ' érték, ' + (data.carelink.lastInserted ?? 0) + ' új' : '–' }}</td></tr>
              <tr><td>Legfrissebb érték</td><td>{{ dt(data.carelink.lastSgAt) }}</td></tr>
              <tr v-if="data.carelink.lastError"><td>Hiba</td><td class="err-text">{{ data.carelink.lastError }}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">A szerver 5 percenként magától lekéri az új értékeket.</p>
        <div class="btn-row">
          <button :disabled="busy === 'cl-poll'" @click="clPoll">Lekérés most</button>
          <a class="btn ghost" href="/api/carelink/raw">Nyers válasz letöltése</a>
          <button class="ghost" @click="clDisconnect">Kapcsolat bontása</button>
        </div>
      </template>
      <template v-else>
        <p v-if="clAuthErr" class="alert">{{ clAuthErr }}</p>
        <p v-if="data.carelink.lastError" class="alert">{{ data.carelink.lastError }}</p>
        <p>A Guardian app élőben tölt fel a CareLinkbe. Ha itt beállítod a <b>gondozói (care partner) fiókodat</b>, a szerver onnan 5 percenként lekéri a szenzorértékeket.</p>
        <p class="muted small">Nem hivatalos módszer (mint az xDrip+ CareLink Follower). A gondozói fiókban a kétlépcsős azonosítás (MFA) legyen kikapcsolva. A jelszavad nem kerül ide, csak egy belépési kulcs.</p>
        <ol class="steps">
          <li><b>Számítógépen</b> Chrome/Edge: új lap, <b>F12</b> → <b>Network</b> fül → pipáld be a <b>Preserve log</b>ot.</li>
          <li>Nyisd meg a CareLink belépést:
            <a v-if="clAuthUrl" class="btn sm" :href="clAuthUrl" target="_blank" rel="noopener">CareLink belépés megnyitása</a>
            <span v-else class="muted">(cím betöltése…)</span>
          </li>
          <li>Lépj be a <b>gondozói fiókkal</b>. Utána a Network szűrőjébe írd: <code>code=</code>, a <b>302</b>-es sornál a <b>location</b> értéke: <code>com.medtronic.carepartner:/sso?code=…</code> — Copy value.
            <br><span class="muted small">Tipp: sok böngészőben belépés után a <b>címsorban</b> is megjelenik a <code>com.medtronic.carepartner:/sso?code=…</code> – onnan is kimásolhatod, DevTools nélkül.</span></li>
          <li>Illeszd be ide (a teljes címet vagy csak a kódot), és kapcsolódj. A kód csak pár percig él.</li>
        </ol>
        <form class="stack" @submit.prevent="clConnect">
          <textarea v-model="clCode" rows="3" required placeholder="com.medtronic.carepartner:/sso?code=…" />
          <button type="submit" :disabled="busy === 'cl-connect'">Kapcsolódás</button>
        </form>
      </template>
    </section>

    <section class="card">
      <h2>Belépés Face ID-val / Touch ID-val (passkey)</h2>
      <p class="muted">Az eszközöd biometrikus azonosításával jelszó nélkül léphetsz be. A jelszó tartaléknak megmarad. Minden eszközön (telefon, laptop) külön kell hozzáadni.</p>
      <p v-if="pkMsg" class="notice">{{ pkMsg }}</p>
      <p v-if="pkErr" class="alert">{{ pkErr }}</p>
      <ul v-if="passkeys?.length" class="plain">
        <li v-for="p in passkeys" :key="p.id" class="copyrow">
          <span>{{ p.name }} <span class="muted small">· hozzáadva {{ new Date(p.createdAt * 1000).toLocaleDateString('hu-HU') }}<template v-if="p.lastUsed">, utoljára {{ new Date(p.lastUsed * 1000).toLocaleDateString('hu-HU') }}</template></span></span>
          <button class="ghost sm" :disabled="busy === 'pk'" @click="pkDelete(p.id)">Törlés</button>
        </li>
      </ul>
      <form v-if="pkSupported" class="stack" @submit.prevent="pkAdd">
        <label>Az eszköz neve
          <input v-model="pkName" type="text" maxlength="60" placeholder="pl. iPhone">
        </label>
        <button type="submit" :disabled="busy === 'pk'">Passkey hozzáadása ezen az eszközön</button>
      </form>
      <p v-else class="muted small">Ez a böngésző nem támogatja a passkey-t.</p>
    </section>

    <section class="card">
      <h2>Kapcsolat a telefonnal</h2>
      <p class="muted">A telefon ide küldi az adatokat (X-Token fejléccel):</p>
      <div class="kv">
        <span>Cím (URL)</span>
        <span class="copyrow"><code>{{ ingestUrl }}</code><button class="ghost sm" @click="copy(ingestUrl)">Másolás</button></span>
        <span>X-Token</span>
        <span class="copyrow"><code>{{ data.token }}</code><button class="ghost sm" @click="copy(data.token)">Másolás</button></span>
      </div>
      <button class="ghost" :disabled="busy === 'token'" @click="regenToken">Új kulcs generálása</button>
    </section>

    <section class="card">
      <h2>Kézi import</h2>
      <p class="muted">Soronként: <code>típus;dátum;érték</code> (típus: <code>glucose</code>, <code>insulin</code>, <code>carbs</code>). JSON is beilleszthető.</p>
      <form class="stack" @submit.prevent="doImport">
        <textarea v-model="importText" rows="5" placeholder="Illeszd be a sorokat…" />
        <label>vagy fájl (.txt / .csv / .json)
          <input type="file" accept=".txt,.csv,.json" @change="importFile = ($event.target as HTMLInputElement).files?.[0] ?? null">
        </label>
        <button type="submit" :disabled="busy === 'import'">Import</button>
      </form>
      <details v-if="importErrors.length" class="card" open>
        <summary>Hibás sorok ({{ importErrors.length }})</summary>
        <ul class="errors"><li v-for="(e, i) in importErrors" :key="i">{{ e }}</li></ul>
      </details>

      <details class="import-xml">
        <summary>Régebbi adatok a teljes Apple Health exportból</summary>
        <p class="muted small">Egészség app → profilkép → <i>Összes egészségügyi adat exportálása</i>. A kicsomagolt <code>export.xml</code> parancssorból tölthető be (nagy fájlhoz is, streamelve):</p>
        <pre>$env:DATA_DIR="C:\wamp64\www\cukornaplo\data"
node scripts/import-health-export.ts C:\útvonal\export.xml 2026-01-01</pre>
        <p class="muted small">A második paraméter (kezdő dátum) elhagyható. A <code>DATA_DIR</code> arra az adatmappára mutasson, amit az app is használ.</p>
      </details>
    </section>

    <ProfileCard />
    <MailSettingsCard />
    <ShareCard />
    <NotifyCard />

    <section class="card danger">
      <h2>Visszaállítás</h2>
      <div class="danger-row">
        <div>
          <b>Mért adatok törlése</b>
          <p class="muted small">Minden glükóz-, inzulin- és CH-bejegyzés törlése. A jelszó, a kulcs és a CareLink kapcsolat megmarad.</p>
        </div>
        <button class="ghost danger-btn" @click="resetDb">Adatok törlése</button>
      </div>
      <div class="danger-row">
        <div>
          <b>Minden elölről (gyári visszaállítás)</b>
          <p class="muted small">A mért adatok, a jelszó, a passkey-k, az API-kulcs és a CareLink kapcsolat is törlődik. Utána új jelszót kell beállítani.</p>
        </div>
        <button class="ghost danger-btn" @click="factoryReset">Minden törlése</button>
      </div>
    </section>
  </main>
</template>
