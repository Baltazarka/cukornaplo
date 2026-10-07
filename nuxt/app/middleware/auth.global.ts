// SPA-oldali őr: jelszó nélkül a beállításra, bejelentkezés nélkül a belépésre küld.
export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useState<{ hasPassword: boolean; authed: boolean }>('auth', () => ({ hasPassword: false, authed: false }))
  const state = await $fetch('/api/auth/state').catch(() => ({ hasPassword: false, authed: false }))
  auth.value = state

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
