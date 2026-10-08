<script setup lang="ts">
const password = ref('')
const error = ref('')
const busy = ref(false)
const auth = useState<{ hasPassword: boolean; authed: boolean }>('auth')

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
</script>

<template>
  <main>
    <section class="card narrow">
      <h1>Belépés</h1>
      <p v-if="error" class="alert">{{ error }}</p>
      <form class="stack" @submit.prevent="submit">
        <label>Jelszó
          <input v-model="password" type="password" autocomplete="current-password" required autofocus>
        </label>
        <button type="submit" :disabled="busy">Belépés</button>
      </form>
    </section>
  </main>
</template>
