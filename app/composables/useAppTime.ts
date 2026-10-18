// Az app időzónája szerinti mostani idő (a böngésző órája más időzónában lehet, pl. utazáskor).
// A setupban kell meghívni; a visszaadott függvények bárhol (kattintáskor, időzítőből) használhatók.
export function useAppTime() {
  const tz = String(useRuntimeConfig().public.appTz || 'Europe/Budapest')
  let dtf: Intl.DateTimeFormat | null = null
  try {
    dtf = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  } catch { /* ismeretlen időzóna: a böngésző órája */ }
  /** Most, az app időzónájában: [óra, perc]. */
  const nowHM = (): [number, number] => {
    const d = new Date()
    if (!dtf) return [d.getHours(), d.getMinutes()]
    const p: Record<string, string> = {}
    for (const part of dtf.formatToParts(d)) p[part.type] = part.value
    return [Number(p.hour), Number(p.minute)]
  }
  return {
    /** A nap perce most (0–1439). */
    nowMinute: () => { const [h, m] = nowHM(); return h * 60 + m },
    /** Most „HH:MM” formában. */
    nowTime: () => nowHM().map((x) => String(x).padStart(2, '0')).join(':'),
  }
}
