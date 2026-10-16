// A böngészőfül címe bejelentkezve a widget adatait mutatja, és lapoz, hogy kiférjen (a végén mindig „Cukornapló”):
// „8,0 → · Cukornapló”, „CH 16 g · Cukornapló”, „B 11,6 E · Cukornapló”. Az adatot percenként kéri le, a részeket
// néhány másodpercenként váltja; a háttérben lévő fülön is frissül (ott látszik a fülsávon).
const APP = 'Cukornapló'
const FETCH_MS = 60_000
const ROTATE_MS = 4_000
/** Ennél régebbi utolsó mérésnél a kora is kiírva (perc). */
const STALE_MIN = 15

interface TabData {
  glucose: { v: number; ts: number; ageMin: number } | null
  trend: { dir: number; level: number } | null
  iob: number | null
  cob: number
  range: { low: number; high: number }
}

const n1 = (v: number) => v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** A lapozott részek a mostani adatokból (üres, ha nincs adat). */
export function tabParts(d: TabData | null): string[] {
  if (!d) return []
  const parts: string[] = []
  const g = d.glucose
  if (g) {
    const warn = g.v < d.range.low ? '⚠️ ' : ''
    const age = g.ageMin > STALE_MIN ? ` (${g.ageMin} p)` : ''
    parts.push(`${warn}${sgText(g.v)} ${widgetArrow(d.trend)}`.trim() + age)
  }
  if (d.cob > 0) parts.push(`CH ${Math.round(d.cob)} g`)
  if (d.iob != null && d.iob >= 0.1) parts.push(`B ${n1(d.iob)} E`)
  return parts
}

export function useTabTitle() {
  const auth = useAuthState()
  const data = ref<TabData | null>(null)
  const idx = ref(0)
  const parts = computed(() => (auth.value.authed ? tabParts(data.value) : []))
  useHead({ title: computed(() => (parts.value.length ? `${parts.value[idx.value % parts.value.length]} · ${APP}` : APP)) })

  async function load() {
    if (!auth.value.authed) { data.value = null; return }
    data.value = await $fetch<TabData>('/api/tab').catch(() => data.value)
  }
  let fetchTimer: ReturnType<typeof setInterval> | undefined
  let rotateTimer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    load()
    fetchTimer = setInterval(load, FETCH_MS)
    rotateTimer = setInterval(() => { idx.value++ }, ROTATE_MS)
  })
  onBeforeUnmount(() => {
    clearInterval(fetchTimer)
    clearInterval(rotateTimer)
  })
  // Belépés / kilépés után azonnal.
  watch(() => auth.value.authed, () => load())
  return { refresh: load }
}
