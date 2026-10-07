<script setup lang="ts">
const auth = useState<{ hasPassword: boolean; authed: boolean }>('auth', () => ({ hasPassword: false, authed: false }))
const route = useRoute()

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  auth.value = { ...auth.value, authed: false }
  await navigateTo('/login')
}

// Téma: rendszer → világos → sötét. A mentett értéket a head-szkript már alkalmazta.
const theme = ref<'system' | 'light' | 'dark'>('system')
onMounted(() => {
  try {
    const t = localStorage.getItem('theme')
    theme.value = t === 'light' || t === 'dark' ? t : 'system'
  } catch { /* nincs localStorage */ }
})
function cycleTheme() {
  const order: ('system' | 'light' | 'dark')[] = ['system', 'light', 'dark']
  const next = order[(order.indexOf(theme.value) + 1) % 3]
  theme.value = next
  try {
    if (next === 'system') {
      document.documentElement.removeAttribute('data-theme')
      localStorage.removeItem('theme')
    } else {
      document.documentElement.setAttribute('data-theme', next)
      localStorage.setItem('theme', next)
    }
  } catch { /* nincs localStorage */ }
}
const themeIcon = computed(() => (theme.value === 'dark' ? '🌙' : theme.value === 'light' ? '☀️' : '🖥️'))
const themeLabel = computed(() => (theme.value === 'dark' ? 'Sötét' : theme.value === 'light' ? 'Világos' : 'Rendszer'))
</script>

<template>
  <div>
    <header class="topbar">
      <NuxtLink class="brand" to="/">Cukornapló</NuxtLink>
      <div class="topbar-right">
        <nav v-if="auth.authed">
          <NuxtLink to="/" :class="{ active: route.path === '/' }">Napi nézet</NuxtLink>
          <NuxtLink to="/telefon" :class="{ active: route.path === '/telefon' }">Telefon beállítása</NuxtLink>
          <NuxtLink to="/adatok" :class="{ active: route.path === '/adatok' }">Adatok és import</NuxtLink>
          <a href="#" @click.prevent="logout">Kilépés</a>
        </nav>
        <button class="theme-toggle" :title="'Téma: ' + themeLabel" aria-label="Téma váltása" @click="cycleTheme">
          <span aria-hidden="true">{{ themeIcon }}</span>
        </button>
      </div>
    </header>
    <NuxtPage />
  </div>
</template>
