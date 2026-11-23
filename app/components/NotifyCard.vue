<script setup lang="ts">
// Telefonos (push) értesítések: hipó-veszély, szénhidrát-javaslat, inzulinjavaslat, szenzor és transzmitter.
// Az eszköz engedélyezése itt történik; minden értesítéstípushoz van tesztgomb.
const { data, refresh } = await useFetch<any>('/api/notify/settings', { key: 'notify-settings' })
const { data: push, refresh: pushRefresh } = await useFetch<any>('/api/push/key', { key: 'push-key' })

const form = reactive({ hypoPush: true, carbsPush: true, insulinPush: false, hypoHorizon: 30, insulinMin: 1, doseStep: 1, repeatMin: 15, devicePush: true, fpuPush: true })
watchEffect(() => {
  if (data.value?.settings) Object.assign(form, data.value.settings)
})

const msg = ref('')
const err = ref<string[]>([])
useToastFrom(msg, 'success')
useToastFrom(err, 'error')
const busy = ref('')

async function save() {
  busy.value = 'save'
  msg.value = ''
  err.value = []
  try {
    await $fetch('/api/notify/settings', { method: 'POST', body: { ...form } })
    await refresh()
    msg.value = 'Mentve.'
  } catch (e: any) {
    err.value = [e?.data?.error ?? 'A mentés nem sikerült.']
  } finally {
    busy.value = ''
  }
}

const TESTS = [
  { kind: 'hypo', label: 'Hipó-veszély teszt' },
  { kind: 'carbs', label: 'CH-javaslat teszt' },
  { kind: 'insulin', label: 'Inzulinjavaslat teszt' },
  { kind: 'device', label: 'Szenzorlejárat teszt' },
  { kind: 'fpu', label: 'Zsíros étel teszt' },
] as const
async function test(kind: string) {
  busy.value = `test-${kind}`
  msg.value = ''
  err.value = []
  try {
    const r = await $fetch<any>('/api/notify/test', { method: 'POST', body: { kind } })
    msg.value = `Tesztértesítés elküldve ${r.sent} eszközre. Pár másodperc múlva meg kell érkeznie.`
  } catch (e: any) {
    err.value = [e?.data?.error ?? 'A tesztértesítés nem sikerült.']
  } finally {
    busy.value = ''
  }
}

// ---- eszköz engedélyezése ----
const supported = ref(false)
const standalone = ref(false)
const isIos = ref(false)
const permission = ref<NotificationPermission | 'unsupported'>('unsupported')
const thisEndpoint = ref('')

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}
onMounted(async () => {
  supported.value = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  isIos.value = /iphone|ipad|ipod/i.test(navigator.userAgent)
  standalone.value = (navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches
  if (supported.value) {
    permission.value = Notification.permission
    thisEndpoint.value = (await currentSub())?.endpoint ?? ''
  }
})
const thisDeviceOn = computed(() => !!thisEndpoint.value && !!push.value?.devices?.some((d: any) => d.endpoint === thisEndpoint.value))

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
function deviceName() {
  const ua = navigator.userAgent
  return /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : 'Eszköz'
}
async function enablePush() {
  busy.value = 'push'
  msg.value = ''
  err.value = []
  try {
    const perm = await Notification.requestPermission()
    permission.value = perm
    if (perm !== 'granted') throw new Error('Az értesítések nincsenek engedélyezve ezen az eszközön.')
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(push.value.publicKey) }))
    await $fetch('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), name: deviceName() } })
    thisEndpoint.value = sub.endpoint
    await pushRefresh()
    msg.value = 'Az értesítés engedélyezve ezen az eszközön. Próbáld ki a tesztgombokkal.'
  } catch (e: any) {
    err.value = [e?.data?.error ?? e?.message ?? 'Az értesítés engedélyezése nem sikerült.']
  } finally {
    busy.value = ''
  }
}
async function disablePush() {
  busy.value = 'push'
  msg.value = ''
  err.value = []
  try {
    const sub = await currentSub()
    const endpoint = sub?.endpoint ?? thisEndpoint.value
    await sub?.unsubscribe()
    if (endpoint) await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint } })
    thisEndpoint.value = ''
    await pushRefresh()
    msg.value = 'Az értesítés kikapcsolva ezen az eszközön.'
  } catch (e: any) {
    err.value = [e?.data?.error ?? e?.message ?? 'A kikapcsolás nem sikerült.']
  } finally {
    busy.value = ''
  }
}
const noDevice = computed(() => !push.value?.devices?.length)
</script>

<template>
  <section id="ertesitesek" class="card">
    <h2>Értesítések a telefonra (push)</h2>
    <p class="muted">
      A rendszer a felvett inzulinból, szénhidrátból és a trendből megbecsüli a vércukrodat, és értesítést küld.
      Ez <b>nem helyettesíti a szenzor és a pumpa riasztásait</b>: a CareLink adata késhet, az iPhone pedig a némítást és a „Ne zavarjanak” módot nem töri át.
    </p>
    <p v-if="data?.lastError" class="alert">Utolsó hiba: {{ data.lastError }}</p>

    <h3 class="notify-sub">1. Eszköz engedélyezése</h3>
    <p v-if="!supported" class="alert">
      <template v-if="isIos && !standalone">iPhone-on az értesítés csak a kezdőképernyőre tett appban működik (iOS 16.4 vagy újabb): Safari → Megosztás → „Hozzáadás a kezdőképernyőhöz”, majd nyisd meg onnan, és gyere vissza ide.</template>
      <template v-else>Ez a böngésző nem támogatja a push értesítéseket.</template>
    </p>
    <template v-else>
      <p v-if="permission === 'denied'" class="alert">Az értesítések le vannak tiltva ehhez az oldalhoz. Engedélyezd az eszköz beállításaiban (iPhone: Beállítások → Értesítések → Cukornapló), majd töltsd újra az oldalt.</p>
      <p class="muted small">Állapot ezen az eszközön: <b>{{ thisDeviceOn ? 'engedélyezve' : 'ki van kapcsolva' }}</b>.</p>
      <ul v-if="push?.devices?.length" class="plain">
        <li v-for="d in push.devices" :key="d.endpoint" class="copyrow">
          <span>{{ d.name }} <span class="muted small">· {{ new Date(d.createdAt * 1000).toLocaleDateString('hu-HU') }}<template v-if="d.endpoint === thisEndpoint"> · ez az eszköz</template></span></span>
        </li>
      </ul>
      <div class="notify-actions">
        <button v-if="!thisDeviceOn" type="button" :disabled="busy !== ''" @click="enablePush">Értesítések engedélyezése ezen az eszközön</button>
        <button v-else type="button" class="ghost" :disabled="busy !== ''" @click="disablePush">Kikapcsolás ezen az eszközön</button>
      </div>
    </template>

    <h3 class="notify-sub">2. Mikor szóljon?</h3>
    <form class="stack" @submit.prevent="save">
      <label>Ismétlés, amíg a helyzet fennáll
        <select v-model.number="form.repeatMin">
          <option :value="15">15 percenként</option>
          <option :value="30">30 percenként</option>
          <option :value="60">óránként</option>
        </select>
      </label>
      <fieldset class="notify-block">
        <label class="check"><input v-model="form.hypoPush" type="checkbox"> Hipó-veszély</label>
        <p class="muted small">Szól, ha a becsült vércukor a céltartomány alá esne, vagy már alatta van. Ha romlik (legalább 0,3-del lejjebb, vagy 3,0 alá), a fenti időközönként ismétlődik; ha nem változik, ritkábban (kétszer akkora időközzel, legalább félóránként). Beírt szénhidrát (≥ 10 g) után 30 percig nem szól.</p>
        <label>Előrejelzés távolsága
          <select v-model.number="form.hypoHorizon">
            <option :value="15">15 perc</option>
            <option :value="30">30 perc</option>
            <option :value="45">45 perc</option>
            <option :value="60">60 perc</option>
          </select>
        </label>
        <p v-if="data?.lastHypo" class="muted small">Utolsó: {{ new Date(data.lastHypo * 1000).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }) }}</p>
      </fieldset>

      <fieldset class="notify-block">
        <label class="check"><input v-model="form.carbsPush" type="checkbox"> Szénhidrát-javaslat (pl. „kb. 15 g CH kellene”)</label>
        <p class="muted small">Hipó-veszélynél megmondja, mennyi gyors szénhidrát kellene (10–30 g). Ha a hipó-veszély értesítés is be van kapcsolva, a kettő egy közös értesítésben érkezik.</p>
      </fieldset>

      <fieldset class="notify-block">
        <label class="check"><input v-model="form.insulinPush" type="checkbox"> Inzulinjavaslat (pl. „kb. 3 E inzulin javasolt”)</label>
        <p class="muted small">Magas vércukornál, ha az aktív inzulin levonása után is a céltartomány fölött maradna. A javaslat a teljes szükséglet fele (egy lépés, egy óra múlva újraszámol), a napszak ISF-jéből és célértékéből számolva, a toll lépésére lefelé kerekítve, a maximális bólusig. Az aktív inzulin levonása miatt a beadás után magától elhallgat. Ez a ritkább, konzervatívabb javaslat (legfeljebb óránként); a gyakoribb, nyugtázást kérő változathoz lásd az <NuxtLink to="/autopilot">Autopilot</NuxtLink> oldalt.</p>
        <label>Legalább ennyi E-nél szóljon
          <input v-model.number="form.insulinMin" type="number" step="0.5" min="0.5" max="10">
        </label>
        <label>A toll adagolási lépésköze
          <select v-model.number="form.doseStep">
            <option :value="1">1 E (egész egységek)</option>
            <option :value="0.5">0,5 E</option>
          </select>
        </label>
        <p v-if="data?.lastInsulin" class="muted small">Utolsó: {{ new Date(data.lastInsulin * 1000).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }) }}</p>
      </fieldset>

      <fieldset class="notify-block">
        <label class="check"><input v-model="form.fpuPush" type="checkbox"> Zsíros étel emlékeztető</label>
        <p class="muted small">Ha a bóluskalkulátorból zsíros / fehérjedús étkezést írsz be zsír- és fehérjegrammal, és jön ki plusz-javaslat, 1,5 óra múlva szól a mostani cukorral és a javasolt plusz adaggal. Nem szól, ha a cukor a célérték alatt van, vagy ha közben törölted az étkezést.</p>
      </fieldset>

      <fieldset class="notify-block">
        <label class="check"><input v-model="form.devicePush" type="checkbox"> Szenzor és transzmitter</label>
        <p class="muted small">A CareLink adataiból: {{ SENSOR_ENDING_HOURS }} órával a szenzor lejárata előtt (szenzoronként egyszer), és ha a transzmitter töltöttsége {{ TRANSMITTER_LOW }}% alá esik (12 óránként).</p>
      </fieldset>

      <div class="notify-actions">
        <button type="submit" :disabled="busy !== ''">Mentés</button>
      </div>
    </form>

    <h3 class="notify-sub">3. Tesztek</h3>
    <p class="muted small">Mintaadatokkal küld egy értesítést az engedélyezett eszközökre (nem a valós vércukrodat használja).</p>
    <div class="notify-actions">
      <button v-for="t in TESTS" :key="t.kind" type="button" class="ghost" :disabled="busy !== '' || noDevice" @click="test(t.kind)">{{ t.label }}</button>
    </div>
  </section>
</template>

<style scoped>
.notify-block { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.notify-block p { margin: 0; }
.check { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.notify-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.notify-sub { margin: 20px 0 8px; font-size: 14px; font-weight: 600; }
ul.plain { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
</style>
