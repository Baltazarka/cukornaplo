<script setup lang="ts">
const password = ref('')
const password2 = ref('')
const setupCode = ref('')
const error = ref('')
const busy = ref(false)
const auth = useState<{ hasPassword: boolean; authed: boolean; needsSetupCode?: boolean }>('auth')
const needsCode = computed(() => !!auth.value?.needsSetupCode)

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/setup', {
      method: 'POST',
      body: { password: password.value, password2: password2.value, setup_code: setupCode.value },
    })
    if (auth.value) { auth.value.hasPassword = true; auth.value.authed = true }
    await navigateTo('/')
  } catch (e: any) {
    error.value = e?.data?.error ?? 'Nem sikerült a beállítás.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main>
    <section class="card narrow">
      <h1>Jelszó beállítása</h1>
      <p class="muted">Ezzel a jelszóval tudod majd megnyitni a naplódat. Az adatok csak ezen a szerveren tárolódnak.</p>
      <p v-if="error" class="alert">{{ error }}</p>
      <form class="stack" @submit.prevent="submit">
        <template v-if="needsCode">
          <label>Beállító kód
            <input v-model="setupCode" type="text" required autocomplete="off" autocapitalize="characters" placeholder="XXXXXX">
          </label>
          <p class="muted small">A kódot a szerver naplójában találod. Dockerben: <code>docker logs cukornaplo-nuxt 2&gt;&amp;1 | grep kód</code>. Ez védi meg, hogy más ne állíthasson be jelszót helyetted.</p>
        </template>
        <label>Jelszó (legalább 8 karakter)
          <input v-model="password" type="password" autocomplete="new-password" required minlength="8">
        </label>
        <label>Jelszó még egyszer
          <input v-model="password2" type="password" autocomplete="new-password" required minlength="8">
        </label>
        <button type="submit" :disabled="busy">Mentés és belépés</button>
      </form>
    </section>
  </main>
</template>
