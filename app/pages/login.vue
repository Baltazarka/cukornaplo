<script setup lang="ts">
const password = ref('')
// „Maradjak bejelentkezve”: 24 órán át, a böngésző bezárása után is (a választás megmarad ebben a böngészőben).
const remember = ref(true)
onMounted(() => {
  try { remember.value = localStorage.getItem('cukornaplo.remember') !== '0' } catch { /* nincs tároló */ }
})
watch(remember, (v) => {
  try { localStorage.setItem('cukornaplo.remember', v ? '1' : '0') } catch { /* nincs tároló */ }
})
const error = ref('')
useToastFrom(error, 'error')
const busy = ref(false)
const auth = useAuthState()
const route = useRoute()
// A megosztási link lejártakor ide jut a megtekintő.
const expired = computed(() => route.query.lejart === '1')

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { password: password.value, remember: remember.value } })
    if (auth.value) auth.value.authed = true
    await navigateTo('/')
  } catch (e: any) {
    error.value = e?.data?.error ?? 'Hibás jelszó.'
  } finally {
    busy.value = false
  }
}

// Belépés Face ID-val / Touch ID-val (passkey). Két út:
//  - automatikus kitöltés: a jelszómezőt megérintve a billentyűzet fölötti sáv felajánlja a mentett
//    passkey-t (iCloud-kulcskarika, Bitwarden stb.), egy koppintás + Face ID;
//  - a gomb: azonnal feldobja a passkey-ablakot.
// Az új kérés a SimpleWebAuthn-ben automatikusan megszakítja a függőben lévőt.
const passkeyOk = ref(false)
onMounted(async () => {
  passkeyOk.value = !!auth.value.hasPasskey && !!window.PublicKeyCredential
  if (!passkeyOk.value) return
  // Előbb kerüljön a DOM-ba a jelszómező „webauthn” autocomplete-je, különben az automatikus kitöltés nem indul.
  await nextTick()
  startAutofill()
})
async function startAutofill() {
  const { browserSupportsWebAuthnAutofill } = await import('@simplewebauthn/browser')
  if (await browserSupportsWebAuthnAutofill()) passkeyLogin(true)
}
onBeforeUnmount(async () => {
  const { WebAuthnAbortService } = await import('@simplewebauthn/browser')
  WebAuthnAbortService.cancelCeremony()
})
async function passkeyLogin(autofill = false) {
  // Az automatikus kitöltés a háttérben vár: csak akkor jelzünk „foglalt”-at, ha már választottál passkey-t.
  let mine = !autofill
  if (mine) {
    busy.value = true
    error.value = ''
  }
  try {
    const { startAuthentication } = await import('@simplewebauthn/browser')
    const optionsJSON = await $fetch<any>('/api/auth/passkey/login-options', { method: 'POST' })
    const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill })
    mine = true
    busy.value = true
    await $fetch('/api/auth/passkey/login-verify', { method: 'POST', body: { response, remember: remember.value } })
    if (auth.value) auth.value.authed = true
    await navigateTo('/')
  } catch (e: any) {
    // Megszakítás (NotAllowedError / AbortError, pl. a gomb leváltotta az automatikus kitöltést) → nincs hibaüzenet.
    if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') error.value = e?.data?.error ?? 'A passkey-s belépés nem sikerült.'
    // A gombos próbálkozás után az automatikus kitöltés újra induljon.
    if (!autofill && passkeyOk.value) startAutofill()
  } finally {
    if (mine) busy.value = false
  }
}
</script>

<template>
  <main>
    <section class="card narrow">
      <h1>Belépés</h1>
      <p v-if="expired" class="notice">A megtekintési link lejárt. Ha tovább szeretnéd nézni, kérj új linket attól, aki küldte.</p>
      <label class="remember">
        <input v-model="remember" type="checkbox"> Maradjak bejelentkezve 24 órán át
      </label>
      <div v-if="passkeyOk" class="stack">
        <button type="button" :disabled="busy" @click="passkeyLogin()">🔐 Belépés Face ID-val / Touch ID-val</button>
        <p class="muted small" style="text-align:center;margin:0">vagy jelszóval:</p>
      </div>
      <form class="stack" @submit.prevent="submit">
        <label>Jelszó
          <input v-model="password" type="password" :autocomplete="passkeyOk ? 'current-password webauthn' : 'current-password'" required autofocus>
        </label>
        <button type="submit" :disabled="busy">Belépés</button>
      </form>
    </section>
  </main>
</template>
