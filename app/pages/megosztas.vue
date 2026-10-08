<script setup lang="ts">
// Megosztási link fogadása: a tokent becseréli csak olvasható munkamenetre, majd a napi nézetre lép.
// A token az URL-ből azonnal eltűnik (ne maradjon az előzményekben).
const route = useRoute()
const error = ref('')
onMounted(async () => {
  const token = typeof route.query.t === 'string' ? route.query.t : ''
  history.replaceState(null, '', '/megosztas')
  try {
    await $fetch('/api/auth/share', { method: 'POST', body: { token } })
    await navigateTo('/', { replace: true })
  } catch (e: any) {
    error.value = e?.data?.error ?? 'A link lejárt vagy érvénytelen.'
  }
})
</script>

<template>
  <main>
    <section class="card narrow">
      <h1>Cukornapló</h1>
      <p v-if="error" class="alert">{{ error }} Kérj új linket attól, aki küldte.</p>
      <p v-else class="muted">Megnyitás…</p>
    </section>
  </main>
</template>
