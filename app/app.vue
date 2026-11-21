<script setup lang="ts">
const auth = useAuthState()
// A böngészőfül címe: a widget adatai lapozva („8,0 → · Cukornapló”).
useTabTitle()
const viewerUntil = computed(() =>
  auth.value.viewer ? new Date(auth.value.viewer.expiresAt * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : '')
const route = useRoute()

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  auth.value = { ...auth.value, authed: false, viewer: null }
  await navigateTo('/login')
}

// Mobil menü (hamburger): oldalváltáskor automatikusan bezárul.
const menuOpen = ref(false)
watch(() => route.path, () => { menuOpen.value = false })

// A számítások magyarázata (oldalról beúszó panel); a mobil menü közben bezárul.
function showGuide() {
  menuOpen.value = false
  openGuide()
}

// Újratöltés (a telepített PWA-ban nincs böngészős frissítés) és „vissza a tetejére” gomb.
const showTop = ref(false)
function onScroll() { showTop.value = window.scrollY > 400 }
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
// Adatfrissítés oldalújratöltés nélkül: minden betöltött lekérdezést újraolvas (nézet, bólus-kalkulátor, terápia…).
const refreshing = ref(false)
async function reload() {
  if (refreshing.value) return
  refreshing.value = true
  // A bóluskalkulátor beírt értékeit is kiüríti.
  useState<number>('bolus-reset', () => 0).value++
  try {
    await refreshNuxtData()
  } catch { /* a következő automatikus frissítés úgyis megpróbálja */ }
  // Egy pillanatig látszik a forgás, hogy érezhető legyen a frissítés.
  setTimeout(() => { refreshing.value = false }, 400)
}
function toTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }
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
        <button v-if="auth.authed || auth.viewer" class="theme-toggle" :class="{ spinning: refreshing }" title="Adatok frissítése" aria-label="Adatok frissítése" @click="reload">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 6.1" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
        <button v-if="auth.authed || auth.viewer" class="menu-toggle" :aria-expanded="menuOpen" aria-label="Menü" @click="menuOpen = !menuOpen">
          <span aria-hidden="true">{{ menuOpen ? '✕' : '☰' }}</span>
        </button>
      </div>
    </header>
    <NuxtPage />
    <CalcGuide />
    <button v-show="showTop" type="button" class="to-top" aria-label="Vissza a tetejére" title="Vissza a tetejére" @click="toTop">↑</button>
    <ToastHost />
    <ConfirmHost />
  </div>
</template>
