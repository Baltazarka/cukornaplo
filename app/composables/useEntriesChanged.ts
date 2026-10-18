// Napló-módosítás (új bejegyzés, törlés, típus- vagy CH-jelölés) után: a bóluskalkulátor aktív inzulinja és a
// hipó-figyelmeztetés is újraszámolódjon, ne csak a napi nézet.
export function useEntriesTick() {
  return useState<number>('entries-tick', () => 0)
}

export function useEntriesChanged() {
  const tick = useEntriesTick()
  return () => {
    tick.value++
    refreshNuxtData('bolus-context').catch(() => null)
  }
}
