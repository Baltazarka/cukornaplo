<script setup lang="ts">
const auth = useAuthState()
const viewerUntil = computed(() =>
  auth.value.viewer ? new Date(auth.value.viewer.expiresAt * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : '')
const route = useRoute()

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  auth.value = { ...auth.value, authed: false, viewer: null }
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
// Mobil menü (hamburger): oldalváltáskor automatikusan bezárul.
const menuOpen = ref(false)
watch(() => route.path, () => { menuOpen.value = false })

// A számítások magyarázata (oldalról beúszó panel); a mobil menü közben bezárul.
function showGuide() {
  menuOpen.value = false
  openGuide()
}

const themeIcon = computed(() => (theme.value === 'dark' ? '🌙' : theme.value === 'light' ? '☀️' : '🖥️'))
const themeLabel = computed(() => (theme.value === 'dark' ? 'Sötét' : theme.value === 'light' ? 'Világos' : 'Rendszer'))
</script>

<template>
  <div>
    <header class="topbar" :class="{ 'menu-open': menuOpen }">
      <NuxtLink class="brand" to="/">Cukornapló</NuxtLink>
      <div class="topbar-right">
        <nav v-if="!auth.authed && auth.viewer">
          <NuxtLink to="/" :class="{ active: route.path === '/' }">Napi nézet</NuxtLink>
          <NuxtLink to="/riport" :class="{ active: route.path === '/riport' }">Riport</NuxtLink>
          <a href="#" @click.prevent="showGuide">Számítások</a>
          <span class="viewer-badge" title="Megosztási linkkel megnyitva, csak olvasható">Megtekintés · {{ viewerUntil }}-ig</span>
          <a href="#" @click.prevent="logout">Kilépés</a>
        </nav>
        <nav v-if="auth.authed">
          <NuxtLink to="/" :class="{ active: route.path === '/' }">Napi nézet</NuxtLink>
          <NuxtLink to="/terapia" :class="{ active: route.path === '/terapia' }">Terápia</NuxtLink>
          <NuxtLink to="/telefon" :class="{ active: route.path === '/telefon' }">Telefon beállítása</NuxtLink>
          <NuxtLink to="/adatok" :class="{ active: route.path === '/adatok' }">Beállítások</NuxtLink>
          <a href="#" @click.prevent="showGuide">Számítások</a>
          <a href="#" @click.prevent="logout">Kilépés</a>
        </nav>
        <button class="theme-toggle" :title="'Téma: ' + themeLabel" aria-label="Téma váltása" @click="cycleTheme">
          <span aria-hidden="true">{{ themeIcon }}</span>
        </button>
        <button v-if="auth.authed || auth.viewer" class="menu-toggle" :aria-expanded="menuOpen" aria-label="Menü" @click="menuOpen = !menuOpen">
          <span aria-hidden="true">{{ menuOpen ? '✕' : '☰' }}</span>
        </button>
      </div>
    </header>
    <NuxtPage />
    <CalcGuide />
  </div>
</template>
