<script setup lang="ts">
const password = ref('')
const error = ref('')
const busy = ref(false)
const auth = useAuthState()
const route = useRoute()
// A megosztási link lejártakor ide jut a megtekintő.
const expired = computed(() => route.query.lejart === '1')

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { password: password.value } })
    if (auth.value) auth.value.authed = true
    await navigateTo('/')
  } catch (e: any) {
    error.value = e?.data?.error ?? 'Hibás jelszó.'
  } finally {
    busy.value = false
  }
}

// Belépés Face ID-val / Touch ID-val (passkey).
const passkeyOk = ref(false)
onMounted(() => {
  passkeyOk.value = !!auth.value.hasPasskey && !!window.PublicKeyCredential
})
async function passkeyLogin() {
  busy.value = true
  error.value = ''
  try {
    const { startAuthentication } = await import('@simplewebauthn/browser')
    const optionsJSON = await $fetch<any>('/api/auth/passkey/login-options', { method: 'POST' })
    const response = await startAuthentication({ optionsJSON })
    await $fetch('/api/auth/passkey/login-verify', { method: 'POST', body: { response } })
    if (auth.value) auth.value.authed = true
    await navigateTo('/')
  } catch (e: any) {
    // A felhasználó megszakította (NotAllowedError) → nincs hibaüzenet.
    if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') error.value = e?.data?.error ?? 'A passkey-s belépés nem sikerült.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main>
    <section class="card narrow">
      <h1>Belépés</h1>
      <p v-if="expired" class="notice">A megtekintési link lejárt. Ha tovább szeretnéd nézni, kérj új linket attól, aki küldte.</p>
      <p v-if="error" class="alert">{{ error }}</p>
      <div v-if="passkeyOk" class="stack">
        <button type="button" :disabled="busy" @click="passkeyLogin">🔐 Belépés Face ID-val / Touch ID-val</button>
        <p class="muted small" style="text-align:center;margin:0">vagy jelszóval:</p>
      </div>
      <form class="stack" @submit.prevent="submit">
        <label>Jelszó
          <input v-model="password" type="password" autocomplete="current-password" required autofocus>
        </label>
        <button type="submit" :disabled="busy">Belépés</button>
      </form>
    </section>
  </main>
</template>
