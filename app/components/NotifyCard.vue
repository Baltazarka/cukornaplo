<script setup lang="ts">
// E-mailes értesítések: hipó-előjelzés és heti riport (az e-mail-küldést a fenti kártyán kell beállítani).
const { data, refresh } = await useFetch<any>('/api/notify/settings', { key: 'notify-settings' })

const form = reactive({ email: '', hypo: false, hypoPush: true, hypoHorizon: 30, weekly: false, weeklyDay: 1, weeklyHour: 8 })
watchEffect(() => {
  if (data.value?.settings) Object.assign(form, data.value.settings)
})

const DAYS = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap']
const msg = ref('')
const err = ref<string[]>([])
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
    err.value = e?.data?.errors ?? [e?.data?.error ?? 'A mentés nem sikerült.']
  } finally {
    busy.value = ''
  }
}
async function test(kind: 'weekly' | 'hypo') {
  busy.value = kind
  msg.value = ''
  err.value = []
  try {
    const r = await $fetch<any>('/api/notify/test', { method: 'POST', body: { kind } })
    msg.value = `${kind === 'weekly' ? 'Heti riport' : 'Mintariasztás'} elküldve ide: ${r.to}.`
  } catch (e: any) {
    err.value = [e?.data?.error ?? 'A küldés nem sikerült.']
  } finally {
    busy.value = ''
  }
}
// ---- Telefonos (push) értesítés ----
const { data: push, refresh: pushRefresh } = await useFetch<any>('/api/push/key', { key: 'push-key' })
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
    if (perm !== 'granted') throw new Error('Az értesítések nincsenek engedélyezve ezen az eszközön (Beállítások → Értesítések).')
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(push.value.publicKey) }))
    await $fetch('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), name: deviceName() } })
    thisEndpoint.value = sub.endpoint
    await pushRefresh()
    msg.value = 'Az értesítés engedélyezve ezen az eszközön. Próbáld ki a tesztgombbal.'
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
async function testPush() {
  busy.value = 'pushtest'
  msg.value = ''
  err.value = []
  try {
    const r = await $fetch<any>('/api/push/test', { method: 'POST', body: {} })
    msg.value = `Tesztértesítés elküldve ${r.sent} eszközre. Pár másodperc múlva meg kell érkeznie.`
  } catch (e: any) {
    err.value = [e?.data?.error ?? 'A tesztértesítés nem sikerült.']
  } finally {
    busy.value = ''
  }
}
const when = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }) : '–')
</script>

<template>
  <section id="ertesitesek" class="card">
    <h2>Értesítések (e-mail)</h2>
    <p class="muted">A levelek a fenti e-mail-beállításon keresztül mennek ki.</p>
    <p v-if="data && !data.mailReady" class="alert">Az e-mail-küldés még nincs beállítva (Gmail-cím és alkalmazásjelszó).</p>
    <p v-if="msg" class="notice">{{ msg }}</p>
    <p v-for="e in err" :key="e" class="alert">{{ e }}</p>
    <p v-if="data?.lastError" class="alert">Utolsó hiba: {{ data.lastError }}</p>

    <form class="stack" @submit.prevent="save">
      <label>Értesítések címzettje
        <input v-model="form.email" type="text" inputmode="email" autocomplete="email" placeholder="valaki@example.com">
      </label>

      <fieldset class="notify-block">
        <label class="check"><input v-model="form.hypo" type="checkbox"> Hipó-előjelzés e-mailben</label>
        <p class="muted small">
          A rendszer az aktív inzulinból, a szénhidrátból és a trendből megbecsüli a vércukrot, és levelet küld, ha a céltartomány alá esne.
          Óránként legfeljebb egyet küld. Ez <b>nem helyettesíti a szenzor és a pumpa riasztásait</b>, és a CareLink-adatok késhetnek.
        </p>
        <label>Előrejelzés távolsága
          <select v-model.number="form.hypoHorizon">
            <option :value="15">15 perc</option>
            <option :value="30">30 perc</option>
            <option :value="45">45 perc</option>
            <option :value="60">60 perc</option>
          </select>
        </label>
        <p v-if="data?.lastHypo" class="muted small">Utolsó riasztás: {{ when(data.lastHypo) }}</p>
      </fieldset>

      <fieldset class="notify-block">
        <label class="check"><input v-model="form.hypoPush" type="checkbox"> A hipó-riasztás a telefonra is menjen (push értesítés)</label>
        <p class="muted small">Az e-mail mellett értesítést is küld a lenti módon engedélyezett eszközökre.</p>
      </fieldset>

      <fieldset class="notify-block">
        <label class="check"><input v-model="form.weekly" type="checkbox"> Heti riport e-mailben</label>
        <p class="muted small">Az elmúlt 7 nap átlaga, célban töltött ideje, hipói és inzulinja, az előző héthez hasonlítva.</p>
        <div class="notify-when">
          <label>Nap
            <select v-model.number="form.weeklyDay">
              <option v-for="(d, i) in DAYS" :key="d" :value="i + 1">{{ d }}</option>
            </select>
          </label>
          <label>Óra
            <select v-model.number="form.weeklyHour">
              <option v-for="h in 24" :key="h" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}:00</option>
            </select>
          </label>
        </div>
        <p v-if="data?.lastWeekly" class="muted small">Utoljára küldve: {{ data.lastWeekly }}</p>
      </fieldset>

      <div class="notify-actions">
        <button type="submit" :disabled="busy !== ''">Mentés</button>
        <button type="button" class="ghost" :disabled="busy !== ''" @click="test('weekly')">Heti riport küldése most</button>
        <button type="button" class="ghost" :disabled="busy !== ''" @click="test('hypo')">Mintariasztás küldése</button>
      </div>
    </form>

    <h3 class="notify-sub">Értesítés ezen az eszközön (push)</h3>
    <p v-if="!supported" class="alert">
      <template v-if="isIos && !standalone">iPhone-on az értesítés csak a kezdőképernyőre tett appban működik (iOS 16.4 vagy újabb): Safari → Megosztás → „Hozzáadás a kezdőképernyőhöz”, majd nyisd meg onnan, és gyere vissza ide.</template>
      <template v-else>Ez a böngésző nem támogatja a push értesítéseket.</template>
    </p>
    <template v-else>
      <p v-if="permission === 'denied'" class="alert">Az értesítések le vannak tiltva ehhez az oldalhoz. Engedélyezd az eszköz beállításaiban (iPhone: Beállítások → Értesítések → Cukornapló), majd töltsd újra az oldalt.</p>
      <p class="muted small">
        Állapot ezen az eszközön: <b>{{ thisDeviceOn ? 'engedélyezve' : 'ki van kapcsolva' }}</b>.
        Az iPhone értesítései nem törik át a némítást vagy a „Ne zavarjanak” módot, és a CareLink adata késhet, ezért ez nem helyettesíti a szenzor riasztásait.
      </p>
      <ul v-if="push?.devices?.length" class="plain">
        <li v-for="d in push.devices" :key="d.endpoint" class="copyrow">
          <span>{{ d.name }} <span class="muted small">· {{ new Date(d.createdAt * 1000).toLocaleDateString('hu-HU') }}<template v-if="d.endpoint === thisEndpoint"> · ez az eszköz</template></span></span>
        </li>
      </ul>
      <div class="notify-actions">
        <button v-if="!thisDeviceOn" type="button" :disabled="busy !== ''" @click="enablePush">Értesítések engedélyezése ezen az eszközön</button>
        <button v-else type="button" class="ghost" :disabled="busy !== ''" @click="disablePush">Kikapcsolás ezen az eszközön</button>
        <button type="button" class="ghost" :disabled="busy !== '' || !push?.devices?.length" @click="testPush">Tesztértesítés küldése</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.notify-block { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.notify-block p { margin: 0; }
.check { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.notify-when { display: flex; gap: 12px; flex-wrap: wrap; }
.notify-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.notify-sub { margin: 20px 0 8px; font-size: 14px; font-weight: 600; }
ul.plain { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
</style>
