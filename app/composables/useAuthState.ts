// A bejelentkezési állapot (a globális útvonalvédő tölti fel). viewer: megosztási linkkel belépett,
// csak olvasható megtekintő, a link lejáratának idejével.
export interface AuthState {
  hasPassword: boolean
  hasPasskey?: boolean
  authed: boolean
  viewer: { expiresAt: number } | null
  /** Jelszó nélkül, nem a szerver gépéről: az első beállításhoz a szerver naplójában lévő beállító kód kell. */
  needsSetupCode?: boolean
}
export function useAuthState() {
  return useState<AuthState>('auth', () => ({ hasPassword: false, authed: false, viewer: null }))
}
/** Csak olvasható nézet (megtekintő)? */
export function useReadOnly() {
  const auth = useAuthState()
  return computed(() => !auth.value.authed && !!auth.value.viewer)
}
