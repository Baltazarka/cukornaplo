// SPA-oldali őr: jelszó nélkül a beállításra, bejelentkezés nélkül a belépésre küld.
// A megosztási linkkel belépett megtekintő csak a napi nézetet és a riportot láthatja.
const VIEWER_PAGES = new Set(['/', '/riport'])

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthState()
  if (to.path === '/megosztas') return // a link fogadóoldala maga intézi a belépést
  const state = await $fetch<any>('/api/auth/state').catch(() => ({ hasPassword: false, authed: false, viewer: null }))
  auth.value = { hasPassword: state.hasPassword, hasPasskey: !!state.hasPasskey, authed: state.authed, viewer: state.viewer ?? null }

  if (!state.authed && state.viewer) {
    return VIEWER_PAGES.has(to.path) ? undefined : navigateTo('/')
  }
  if (!state.hasPassword) {
    return to.path === '/setup' ? undefined : navigateTo('/setup')
  }
  if (!state.authed && to.path !== '/login') {
    return navigateTo('/login')
  }
  if (state.authed && (to.path === '/login' || to.path === '/setup')) {
    return navigateTo('/')
  }
})
