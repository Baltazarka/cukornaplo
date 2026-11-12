<script setup lang="ts">
import type { DeviceStatus } from '#shared/utils/device'
const route = useRoute()
const router = useRouter()

const date = computed(() => (typeof route.query.date === 'string' ? route.query.date : ''))
// Időszak: 1 = napi nézet, 7 / 14 / 30 = időszakos (AGP) nézet. Az URL-ben ?days=7 formában.
const PERIODS = [1, 7, 14, 30]
const period = computed(() => {
  const n = Number(route.query.days)
  return PERIODS.includes(n) ? n : 1
})
const { data, refresh } = await useFetch<any>('/api/day', { query: { date } })
// Napló-módosítás után a kalkulátor (aktív inzulin) és a hipó-figyelmeztetés is frissül.
const entriesChanged = useEntriesChanged()
const appTime = useAppTime()
// Megosztási linkkel belépett megtekintő: minden szerkesztő elem rejtve.
const readOnly = useReadOnly()
const { data: agp, refresh: refreshAgp } = await useAsyncData(
  'agp',
  () => (period.value > 1 ? $fetch<any>('/api/agp', { query: { end: date.value || undefined, days: period.value } }) : Promise.resolve(null)),
  { watch: [period, date] },
)

// Automatikus frissítés: percenként megnézi, jött-e új adat (pl. CareLink, telefon), és ha igen,
// újratölti a nézetet; ettől függetlenül 5 percenként mindenképp (a „most” is halad). Háttérben
// lévő lapon szünetel, visszatéréskor azonnal ellenőriz.
let stamp = ''
const clAlert = ref<{ level: string; message: string; detail?: string } | null>(null)
const device = ref<DeviceStatus | null>(null)
async function checkFresh(force = false) {
  const v = await $fetch<{ stamp: string; alert: any; device: DeviceStatus | null }>('/api/version').catch((e) => {
    // Lejárt munkamenet (pl. a megosztási link ideje letelt): vissza a belépéshez.
    if (e?.statusCode === 401 || e?.response?.status === 401) navigateTo(readOnly.value ? '/login?lejart=1' : '/login')
    return null
  })
  if (!v) return
  clAlert.value = v.alert
  device.value = v.device ?? null
  const changed = stamp !== '' && v.stamp !== stamp
  stamp = v.stamp
  if (changed || force) {
    await Promise.all([refresh(), period.value > 1 ? refreshAgp() : null, refreshNuxtData('therapy')])
  }
}
let pollTimer: ReturnType<typeof setInterval> | undefined
let fullTimer: ReturnType<typeof setInterval> | undefined
const onVisible = () => { if (!document.hidden) checkFresh() }
onMounted(() => {
  checkFresh()
  pollTimer = setInterval(() => { if (!document.hidden) checkFresh() }, 60_000)
  fullTimer = setInterval(() => { if (!document.hidden) checkFresh(true) }, 300_000)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(pollTimer)
  clearInterval(fullTimer)
  document.removeEventListener('visibilitychange', onVisible)
})

function nav(d: string | null, days = period.value) {
  const query: Record<string, string> = {}
  if (d) query.date = d
  if (days > 1) query.days = String(days)
  router.push({ query })
}
function go(d: string) {
  nav(d)
}
function openDay(d: string) {
  nav(d, 1)
}

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

// Sáv-feliratok a beállított céltartományból.
const bandLabels = computed<[string, string, string][]>(() => {
  const r = data.value?.range ?? { veryLow: 3, low: 3.9, high: 10, veryHigh: 13.9 }
  return [
    ['veryHigh', 'Nagyon magas', `> ${fmt(r.veryHigh)}`],
    ['high', 'Magas', `${fmt(r.high)}–${fmt(r.veryHigh)}`],
    ['inRange', 'Céltartomány', `${fmt(r.low)}–${fmt(r.high)}`],
    ['low', 'Alacsony', `${fmt(r.veryLow)}–${fmt(r.low)}`],
    ['veryLow', 'Nagyon alacsony', `< ${fmt(r.veryLow)}`],
  ]
})

// Céltartomány szerkesztése.
const editLow = ref<number | null>(null)
const editHigh = ref<number | null>(null)
const saving = ref(false)
watchEffect(() => {
  if (data.value && editLow.value === null) {
    editLow.value = data.value.range.low
    editHigh.value = data.value.range.high
  }
})
async function saveRange() {
  saving.value = true
  try {
    await $fetch('/api/settings', { method: 'POST', body: { range_low: editLow.value, range_high: editHigh.value } })
    editLow.value = null
    await refresh()
    entriesChanged()
  } catch (err: any) {
    useToast().error(err?.data?.error ?? 'A mentés nem sikerült.')
  } finally {
    saving.value = false
  }
}

// Váltott műszak: a megnézett nap műszakjának átállítása (a beosztás szerintire visszaállítva a kézi jelölés törlődik).
async function setDayShift(kind: string) {
  try {
    await $fetch('/api/shift-day', { method: 'POST', body: { date: data.value!.day, shift: kind } })
    await refreshNuxtData('therapy')
    entriesChanged()
  } catch (err: any) {
    useToast().error(err?.data?.error ?? 'A műszak mentése nem sikerült.')
  }
  await refresh()
}

// Szénhidrát jelölése: zsíros / fehérjedús (a CH-arány becslése kihagyja, az elemzés külön mutatja),
// vagy gyors CH (pl. hipó kezelése). A kettő kizárja egymást; újra kattintva a jelölés lekerül.
async function toggleCarbTag(e: any, tag: 'fatty' | 'fast') {
  try {
    await $fetch('/api/entry-tag', { method: 'POST', body: { id: e.id, tag: e.sub === tag ? null : tag } })
    entriesChanged()
  } catch (err: any) {
    useToast().error(err?.data?.error ?? 'A jelölés nem sikerült.')
  }
  await refresh()
}
// Zsír / fehérje utólag (zsíros CH-sornál): a zsír-fehérje javaslat kiértékeléséhez.
const macroEdit = ref<{ id: number; fat: string; protein: string } | null>(null)
const macroError = ref('')
useToastFrom(macroError, 'error')
function openMacroEdit(e: any) {
  macroEdit.value = { id: e.id, fat: e.fat == null ? '' : String(e.fat).replace('.', ','), protein: e.protein == null ? '' : String(e.protein).replace('.', ',') }
}
async function saveMacros() {
  const m = macroEdit.value!
  macroError.value = '' // az ismételt, azonos hiba is jelenjen meg
  try {
    await $fetch('/api/entry-macros', { method: 'POST', body: { id: m.id, fat: m.fat, protein: m.protein } })
    macroEdit.value = null
    await refresh()
  } catch (err: any) {
    macroError.value = err?.data?.error ?? 'A mentés nem sikerült.'
  }
}
/** A kalkulátorból beírt bólus bontása: ételre, korrekció, aktív inzulin, zsír-fehérje, és ha átírtad, a javasolt. */
const calcText = (e: any) => {
  const c = e.calc
  if (!c) return ''
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v))
  const parts = [
    c.carbDose > 0 ? `ételre ${fmt(c.carbDose)} E${c.carbs ? ` (${fmt(c.carbs, 0)} g)` : ''}` : '',
    c.bg != null && c.correction !== 0 ? `korrekció ${sign(c.correction)} E (${fmt(c.bg)} → ${fmt(c.target)})` : '',
    c.iobUsed > 0 ? `aktív inzulin −${fmt(c.iobUsed)} E` : '',
    c.fpu > 0 ? `zsír-fehérje +${fmt(c.fpu)} E` : '',
  ].filter(Boolean)
  const suggested = (c.dose ?? 0) + (c.fpu ?? 0)
  if (Math.abs(suggested - e.v) >= 0.05) parts.push(`javasolt ${fmt(suggested)} E, beírva ${fmt(e.v)} E`)
  return parts.join(' · ')
}
const macroText = (e: any) => [e.fat != null ? `${fmt(e.fat, 0)} g zsír` : '', e.protein != null ? `${fmt(e.protein, 0)} g fehérje` : ''].filter(Boolean).join(', ')
async function setSub(e: any, v: string) {
  try {
    await $fetch('/api/entry-subtype', { method: 'POST', body: { id: e.id, subtype: v } })
    entriesChanged()
  } catch (err: any) {
    useToast().error(err?.data?.error ?? 'A típus mentése nem sikerült.')
  }
  // Hibánál is: a legördülő visszaáll a mentett értékre.
  await refresh()
}

// Egy inzulin- vagy CH-sor törlése (megerősítéssel). A telefon később sem tölti vissza.
const deletingId = ref<string | null>(null)
async function deleteEvent(e: any) {
  const amount = e.type === 'carbs' ? `${fmt(e.v, 0)} g` : e.type === 'glucose' ? `${fmt(e.v)} mmol/L` : `${fmt(e.v)} E`
  if (!(await askConfirm(`Biztos törlöd ezt a bejegyzést?\n\n${e.time}  ${eventLabel(e)}  ${amount}`, { confirmLabel: 'Törlés', danger: true }))) return
  deletingId.value = e.type + e.id
  try {
    await $fetch('/api/entry-delete', { method: 'POST', body: { id: e.id } })
    entriesChanged()
    await refresh()
  } catch (err: any) {
    useToast().error(err?.data?.error ?? 'A törlés nem sikerült.')
  } finally {
    deletingId.value = null
  }
}

// Kizárt szenzorszakaszok a naplóban (szürkén): a kizárt értékek mintázata (kis görbe), a legkisebb / legnagyobb
// érték, és a szakasz előtti / utáni érvényes mérés, hogy látszódjon, mennyire tért el.
const hmMs = (ms: number) => new Date(ms).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
const excludedRows = computed<any[]>(() => {
  const d = data.value
  if (!d) return []
  const pts = (d.excludedGlucose ?? []) as [number, number][]
  const good = (d.glucose ?? []) as [number, number][]
  return ((d.excluded ?? []) as { id: number; from: number; to: number }[])
    .filter((x) => x.to >= d.dayStartMs && x.from < d.dayEndMs)
    .map((x) => {
      const v = pts.filter((p) => p[0] >= x.from && p[0] <= x.to)
      const lo = v.length ? v.reduce((a, p) => (p[1] < a[1] ? p : a)) : null
      const hi = v.length ? v.reduce((a, p) => (p[1] > a[1] ? p : a)) : null
      const before = [...good].reverse().find((p) => p[0] < x.from)
      const after = good.find((p) => p[0] > x.to)
      // Kis görbe (SVG polyline, 120 × 22): a kizárt értékek a szakasz előtti / utáni méréssel együtt.
      const line = [...(before && x.from - before[0] <= 20 * 60000 ? [before] : []), ...v, ...(after && after[0] - x.to <= 20 * 60000 ? [after] : [])]
      let spark = ''
      if (line.length > 1) {
        const t0 = line[0][0]
        const t1 = line[line.length - 1][0]
        const vMin = Math.min(...line.map((p) => p[1]))
        const vMax = Math.max(...line.map((p) => p[1]), vMin + 1)
        spark = line.map((p) => `${(((p[0] - t0) / (t1 - t0 || 1)) * 118 + 1).toFixed(1)},${(21 - ((p[1] - vMin) / (vMax - vMin)) * 20).toFixed(1)}`).join(' ')
      }
      return {
        type: 'excluded', id: x.id, ts: x.from, time: hmMs(x.from), from: x.from, to: x.to, n: v.length,
        lo, hi, before: before?.[1] ?? null, after: after?.[1] ?? null, spark,
      }
    })
})
async function undoExcluded(x: any) {
  if (!(await askConfirm(`Visszavonod a kizárást (${hmMs(x.from)}–${hmMs(x.to)})? Az értékek újra beleszámítanak.`, { confirmLabel: 'Visszavonás' }))) return
  try {
    await $fetch('/api/excluded-delete', { method: 'POST', body: { id: x.id } })
    entriesChanged()
  } catch (err: any) {
    useToast().error(err?.data?.error ?? 'A visszavonás nem sikerült.')
  }
  await refresh()
}

// Napló: bejegyzések, jegyzetek és kizárt szenzorszakaszok időrendben.
const logRows = computed<any[]>(() =>
  [...(data.value?.events ?? []), ...(data.value?.notes ?? []).map((n: any) => ({ ...n, type: 'note' })), ...excludedRows.value].sort((a, b) => a.ts - b.ts))

// Napló szűrése napszakra (délelőtt / délután, 12:00-nál vág); nincs kijelölve = az egész nap és az összevető grafikon.
const half = ref<'am' | 'pm' | null>(null)
watch(() => data.value?.day, () => { half.value = null })
const shownRows = computed(() => (half.value ? logRows.value.filter((e) => (e.time < '12:00') === (half.value === 'am')) : logRows.value))

// Új jegyzet: időpont (mai napon most, különben 12:00), címkék, szöveg.
const noteForm = ref<{ time: string; tags: string[]; text: string } | null>(null)
const noteError = ref('')
useToastFrom(noteError, 'error')
const noteSaving = ref(false)
function defaultTime() {
  return data.value?.day === data.value?.today ? appTime.nowTime() : '12:00'
}
function openNoteForm() {
  entryForm.value = null
  noteForm.value = { time: defaultTime(), tags: [], text: '' }
  noteError.value = ''
}
function toggleNoteTag(id: string) {
  const f = noteForm.value!
  f.tags = f.tags.includes(id) ? f.tags.filter((t) => t !== id) : [...f.tags, id]
}
async function saveNote() {
  noteSaving.value = true
  noteError.value = ''
  try {
    await $fetch('/api/notes', { method: 'POST', body: { date: data.value!.day, ...noteForm.value } })
    noteForm.value = null
    await refresh()
  } catch (e: any) {
    noteError.value = e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    noteSaving.value = false
  }
}
// Kézi inzulin / CH: időpont (mai napon most, különben 12:00), mennyiség, típus vagy jelölés.
const entryForm = ref<{ type: 'insulin' | 'carbs' | 'glucose'; date: string; time: string; value: string; sub: string; fat: string; protein: string } | null>(null)
const entryError = ref('')
useToastFrom(entryError, 'error')
const entrySaving = ref(false)
// A legutóbb felvett CH vagy inzulin, hogy a Guardian appba is felvihesd (GuardianLine).
const lastGuardian = ref<{ carbs: number | null; dose: number | null; time: string } | null>(null)
function openEntryForm(type: 'insulin' | 'carbs' | 'glucose') {
  noteForm.value = null
  lastGuardian.value = null
  // Alapból a megnézett nap, de átírható (pl. tegnapi adag utólagos felvétele).
  const date = data.value?.day ?? ''
  entryForm.value = { type, date, time: date === data.value?.today ? defaultTime() : '12:00', value: '', sub: '', fat: '', protein: '' }
  entryError.value = ''
}

// „Éjszaka” téma: a mostani érték külön kártyán, alatta (telefonon) gyors gombok; a többi témában CSS-sel rejtve.
const nowReading = computed(() => {
  const gl = data.value?.glucose
  if (!gl?.length) return null
  const [ms, v] = gl[gl.length - 1]
  const r = data.value.range
  const zone = v < r.veryLow ? 'very-low' : v < r.low ? 'low' : v > r.veryHigh ? 'very-high' : v > r.high ? 'high' : 'in'
  return { v, time: new Date(ms).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }), zone }
})
// „Ma eddig” (telefonon, „Éjszaka” téma): a nap sávja, átlag / CV, a legalacsonyabb és legmagasabb érték időponttal,
// bólus / bázis / CH összesen.
const daySoFar = computed(() => {
  const d = data.value
  const s = d?.stats?.day
  if (!s?.n) return null
  const gl = (d.glucose ?? []).filter((p: any[]) => p[1] != null) as [number, number][]
  const hm = (ms: number) => new Date(ms).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const lo = gl.reduce<[number, number] | null>((b, p) => (!b || p[1] < b[1] ? p : b), null)
  const hi = gl.reduce<[number, number] | null>((b, p) => (!b || p[1] > b[1] ? p : b), null)
  const ins = (d.insulin ?? []) as [number, number, string][]
  return {
    low: (s.pct.veryLow ?? 0) + (s.pct.low ?? 0),
    inRange: s.pct.inRange ?? 0,
    high: (s.pct.high ?? 0) + (s.pct.veryHigh ?? 0),
    span: gl.length ? `${hm(gl[0][0])} – ${hm(gl[gl.length - 1][0])}` : '',
    avg: s.avg, cv: s.cv,
    lo: lo && { v: lo[1], t: hm(lo[0]) },
    hi: hi && { v: hi[1], t: hm(hi[0]) },
    bolus: (d.totals.meal ?? 0) + (d.totals.correction ?? 0),
    bolusN: ins.filter((p) => p[2] !== 'basal').length,
    basal: d.totals.basal ?? 0,
    carbs: d.totals.carbs ?? 0,
    carbsN: (d.carbs ?? []).length,
  }
})
const tirClass = (p: number) => (p >= 70 ? '' : p >= 50 ? 'mid' : 'bad')
const ZONE_LABEL ={ 'very-low': 'nagyon alacsony', low: 'alacsony', in: 'célban', high: 'magas', 'very-high': 'nagyon magas' } as const
// A várható érték 30 perc múlva (az előrejelzés görbéjéből), csak a mai napon.
const pred30 = ref<number | null>(null)
async function loadPred30() {
  if (unref(readOnly) || !data.value || data.value.day !== data.value.today) { pred30.value = null; return }
  try {
    const r = await $fetch<any>('/api/predict', { query: { series: 1 } })
    const s = (r.series ?? []) as [number, number][]
    if (!s.length) { pred30.value = null; return }
    const target = s[0][0] + 30 * 60000
    const p = s.reduce((b, q) => (Math.abs(q[0] - target) < Math.abs(b[0] - target) ? q : b))
    pred30.value = Math.abs(p[0] - target) <= 6 * 60000 ? p[1] : null
  } catch {
    pred30.value = null
  }
}
watch(() => [data.value?.day, data.value?.glucose?.length], loadPred30, { immediate: true })
async function quickEntry(type: 'insulin' | 'carbs') {
  openEntryForm(type)
  await nextTick()
  const form = document.querySelector('.log-card .note-form')
  form?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  form?.querySelector<HTMLInputElement>('.entry-amount')?.focus({ preventScroll: true })
}
function quickCalc() {
  const calc = document.querySelector('.bolus-calc')
  calc?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  calc?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
}
async function saveEntry(force = false) {
  const f = entryForm.value!
  entrySaving.value = true
  entryError.value = ''
  try {
    // Zsír / fehérje csak zsíros CH-nál megy (friss étkezésnél a szerver a zsír-fehérje emlékeztetőt is beállítja).
    const macros = f.type === 'carbs' && f.sub === 'fatty' ? { fat: f.fat, protein: f.protein } : { fat: '', protein: '' }
    await $fetch('/api/entry-add', { method: 'POST', body: { ...f, ...macros, force } })
    entryForm.value = null
    entriesChanged()
    if (f.type !== 'glucose') {
      const v = Number(f.value.replace(',', '.'))
      // Másik napra vett bejegyzésnél a dátum is kell, hogy a Guardianben is oda kerüljön.
      const time = f.date && f.date !== data.value!.today ? `${f.date.slice(5).replace('-', '.')}. ${f.time}` : f.time
      lastGuardian.value = { carbs: f.type === 'carbs' ? v : null, dose: f.type === 'insulin' ? v : null, time }
    }
    // Másik napra vett bejegyzésnél oda ugrunk, hogy látszódjon.
    if (f.date && f.date !== data.value!.day) go(f.date)
    else await refresh()
  } catch (e: any) {
    // Hasonló bejegyzés a közelben (pl. véletlenül kétszer beírva): rákérdezünk.
    if (e?.data?.duplicate && !force && (await askConfirm(`${e.data.error}

Mégis felveszed?`, { confirmLabel: 'Felveszem' }))) return saveEntry(true)
    entryError.value = e?.data?.duplicate ? '' : e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    entrySaving.value = false
  }
}

async function deleteNote(n: any) {
  const what = [...n.tags.map(noteTagLabel), n.text].filter(Boolean).join(', ')
  if (!(await askConfirm(`Biztos törlöd ezt a jegyzetet?\n\n${n.time}  ${what}`, { confirmLabel: 'Törlés', danger: true }))) return
  deletingId.value = 'note' + n.id
  try {
    await $fetch('/api/note-delete', { method: 'POST', body: { id: n.id } })
    await refresh()
  } catch (err: any) {
    useToast().error(err?.data?.error ?? 'A törlés nem sikerült.')
  } finally {
    deletingId.value = null
  }
}

const KIND_LABEL: Record<string, string> = { meal: 'Étkezési bólus', correction: 'Korrekció', basal: 'Bázis' }
const kindLabel = (e: any) => (e.kind === 'meal' && e.noCarbs ? 'Étkezési bólus, CH nélkül' : KIND_LABEL[e.kind] ?? 'Inzulin')
const eventLabel = (e: any) => (e.type === 'carbs' ? 'Szénhidrát' : e.type === 'glucose' ? 'Vércukor (kézi mérés)' : kindLabel(e))
const eventDot = (e: any) =>
  e.type !== 'insulin' ? e.type : e.kind === 'basal' ? 'basal' : e.kind === 'correction' ? 'correction' : 'insulin'
// A legördülő értéke: a kézi típus, vagy üres = automatikus (becsült) besorolás.
const subValue = (e: any) => (['meal', 'correction', 'basal'].includes(e.sub) ? e.sub : '')
</script>

<template>
  <main v-if="data" class="home" :class="{ 'has-right': !readOnly }">
    <div class="home-main">
    <div v-if="clAlert" class="cl-alert" :class="clAlert.level" role="alert">
      <div class="cl-alert-text">
        <b>{{ clAlert.message }}</b>
        <span v-if="clAlert.detail">{{ clAlert.detail }}</span>
      </div>
      <NuxtLink v-if="!readOnly" to="/adatok" class="btn ghost sm">CareLink beállítás</NuxtLink>
    </div>
    <HypoWarning v-if="!readOnly && period === 1 && data.day === data.today" />
    <div class="filters">
      <template v-if="period === 1">
        <button class="ghost" aria-label="Előző nap" @click="go(data.prev)">←</button>
        <input type="date" :value="data.day" :max="data.today" @change="go(($event.target as HTMLInputElement).value)">
        <button class="ghost" aria-label="Következő nap" :hidden="data.day >= data.today" @click="go(data.next)">→</button>
        <button v-if="data.day !== data.today" class="ghost" @click="go(data.today)">Ma</button>
      </template>
      <template v-else-if="agp">
        <button class="ghost" :aria-label="`Előző ${period} nap`" @click="go(agp.prevEnd)">←</button>
        <input type="date" :value="agp.end" :max="agp.today" aria-label="Az időszak utolsó napja" @change="go(($event.target as HTMLInputElement).value)">
        <button class="ghost" :aria-label="`Következő ${period} nap`" :hidden="!agp.nextEnd" @click="go(agp.nextEnd)">→</button>
        <button v-if="agp.end !== agp.today" class="ghost" @click="go(agp.today)">Ma</button>
      </template>
      <div class="segmented" role="group" aria-label="Időszak">
        <button v-for="p in PERIODS" :key="p" type="button" :aria-pressed="period === p" @click="nav(date, p)">{{ p }} nap</button>
      </div>
      <h1>{{ period === 1 ? data.label : agp?.label }}</h1>
      <!-- Váltott műszak: a nap műszakja (átállítható, pl. szabadság vagy csere). -->
      <template v-if="period === 1 && data.shift?.kind">
        <select
          v-if="!readOnly" class="shift-select" :value="data.shift.kind" aria-label="A nap műszakja"
          :title="data.shift.kind === data.shift.scheduled ? 'A beosztás szerint' : 'Kézzel átállítva'"
          @change="setDayShift(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="k in SHIFT_KINDS" :key="k" :value="k">{{ SHIFT_LABEL[k] }}{{ k === data.shift.scheduled ? '' : ' (átállítva)' }}</option>
        </select>
        <span v-else class="note-chip">{{ SHIFT_LABEL[data.shift.kind as 'morning'] }}</span>
      </template>
      <NuxtLink
        class="btn ghost report-link" :to="{ path: '/riport', query: { days: period > 1 ? period : 14, end: (period > 1 ? agp?.end : data.day) || undefined } }"
        title="Részletes, nyomtatható riport (PDF-be menthető)"
      ><span class="rl-long">Riport / PDF</span><span class="rl-short" aria-hidden="true">PDF</span></NuxtLink>
    </div>

    <PeriodView v-if="period > 1 && agp" :data="agp" @day="openDay" />

    <template v-if="period === 1">
    <section v-if="nowReading" class="card now-card" :class="'z-' + nowReading.zone" aria-label="Utolsó vércukor">
      <div class="now-main">
        <span class="now-label">{{ data.day === data.today ? 'Most' : 'A nap utolsó értéke' }} · {{ nowReading.time }} · Guardian</span>
        <span class="now-value">{{ sgText(nowReading.v) }} <small>mmol/L</small></span>
        <TrendArrows v-if="data.trend && data.day === data.today" :dir="data.trend.dir" :level="data.trend.level" class="now-trend" />
        <span class="now-zone">{{ ZONE_LABEL[nowReading.zone] }}</span>
      </div>
      <div class="now-facts">
        <div v-if="data.iobNow != null"><span>Aktív inzulin</span><b class="now-ins">{{ fmt(data.iobNow) }} E</b></div>
        <div v-if="data.cobNow != null"><span>Aktív CH</span><b class="now-carbs">{{ fmt(data.cobNow, 0) }} g</b></div>
        <div v-if="pred30 != null"><span>30 perc múlva</span><b>≈ {{ sgText(pred30) }}</b></div>
      </div>
    </section>
    <div v-if="!readOnly" class="quick-actions" role="group" aria-label="Gyors műveletek">
      <button type="button" class="qa-calc" @click="quickCalc">Kalkulátor</button>
      <button type="button" class="qa-carbs" @click="quickEntry('carbs')">+ CH</button>
      <button type="button" class="qa-ins" @click="quickEntry('insulin')">+ Inzulin</button>
    </div>
    <section v-if="daySoFar" class="card day-so-far" aria-label="A nap összesítése">
      <div class="dsf-head">
        <h2>{{ data.day === data.today ? 'Ma eddig' : 'A nap' }}</h2>
        <span class="muted small">{{ daySoFar.span }}</span>
      </div>
      <div class="dsf-bar" aria-hidden="true">
        <span v-if="daySoFar.low" class="z-low" :style="{ flexBasis: daySoFar.low + '%' }" />
        <span v-if="daySoFar.inRange" class="z-in" :style="{ flexBasis: daySoFar.inRange + '%' }" />
        <span v-if="daySoFar.high" class="z-high" :style="{ flexBasis: daySoFar.high + '%' }" />
      </div>
      <div class="dsf-legend small">
        <span>alacsony {{ fmt(daySoFar.low, 0) }}%</span>
        <b class="z-in-text">célban {{ fmt(daySoFar.inRange, 0) }}%</b>
        <span>magas {{ fmt(daySoFar.high, 0) }}%</span>
      </div>
      <div class="dsf-grid">
        <div><span>Átlag</span><b>{{ fmt(daySoFar.avg) }} <small>mmol/L</small></b></div>
        <div><span>Ingadozás (CV)</span><b>{{ fmt(daySoFar.cv, 0) }} %</b></div>
        <div v-if="daySoFar.lo"><span>Legalacsonyabb</span><b>{{ sgText(daySoFar.lo.v) }} <small>{{ daySoFar.lo.t }}</small></b></div>
        <div v-if="daySoFar.hi"><span>Legmagasabb</span><b>{{ sgText(daySoFar.hi.v) }} <small>{{ daySoFar.hi.t }}</small></b></div>
      </div>
      <div class="dsf-grid dsf-3">
        <div><span>Bólus</span><b class="now-ins">{{ daySoFar.bolus ? fmt(daySoFar.bolus) + ' E' : '–' }}</b><small>{{ daySoFar.bolusN }} adag</small></div>
        <div><span>Bázis</span><b class="dsf-basal">{{ daySoFar.basal ? fmt(daySoFar.basal, 0) + ' E' : '–' }}</b><small>{{ daySoFar.basal ? 'beadva' : 'még nincs' }}</small></div>
        <div><span>Szénhidrát</span><b class="now-carbs">{{ daySoFar.carbs ? fmt(daySoFar.carbs, 0) + ' g' : '–' }}</b><small>{{ daySoFar.carbsN }} étkezés</small></div>
      </div>
    </section>
    <section v-if="!data.stats.day.n && !data.events.length" class="card">
      <p>Erre a napra nincs adat.</p>
      <p class="muted">Ha még nem állítottad be, a <NuxtLink to="/telefon">Telefon beállítása</NuxtLink> varázsló végigvezet a telefonos küldésen, a szenzorgörbéhez pedig az <NuxtLink to="/adatok">Beállítások</NuxtLink> oldalon kötheted be a CareLinket.</p>
    </section>

    <StatTiles
      :stats="data.stats.day" :change="data.change" :range="data.range" :coverage="data.coverage" :hypos="data.hypos"
      :insulin="{ total: data.totals.insulin, meal: data.totals.meal, correction: data.totals.correction, basal: data.totals.basal }" :carbs="data.totals.carbs" :partial="data.day === data.today"
    />

    <section class="card day-chart-card">
      <div class="card-head">
        <h2>Napi görbe</h2>
        <form v-if="!readOnly" class="range-edit" @submit.prevent="saveRange">
          <span class="muted">Céltartomány:</span>
          <input v-model.number="editLow" type="number" step="0.1" min="3.1" max="13.7" aria-label="Alsó határ">
          <span class="muted">–</span>
          <input v-model.number="editHigh" type="number" step="0.1" min="3.6" max="13.8" aria-label="Felső határ">
          <span class="muted">mmol/L</span>
          <button type="submit" class="ghost sm" :disabled="saving">Mentés</button>
        </form>
      </div>
      <ClientOnly>
        <GlucoseDayChart :day="data" @changed="refresh(); entriesChanged()" />
        <template #fallback><div class="chart-box" /></template>
      </ClientOnly>
    </section>

    <div class="grid2">
      <section class="card log-card">
        <div class="card-head">
          <h2>Napló</h2>
          <div v-if="!readOnly && !noteForm && !entryForm" class="log-add">
            <button type="button" class="ghost sm" @click="openEntryForm('insulin')">+ Inzulin</button>
            <button type="button" class="ghost sm" @click="openEntryForm('carbs')">+ CH</button>
            <button type="button" class="ghost sm" title="Kézzel mért vércukor (ujjbegy, külön mérő); a szenzoradattól megkülönböztetve jelenik meg" @click="openEntryForm('glucose')">+ Vércukor</button>
            <button type="button" class="ghost sm" @click="openNoteForm">+ Jegyzet</button>
          </div>
        </div>
        <div class="log-half segmented" role="group" aria-label="Napszak">
          <button type="button" :aria-pressed="half === 'am'" @click="half = half === 'am' ? null : 'am'">Délelőtt</button>
          <button type="button" :aria-pressed="half === 'pm'" @click="half = half === 'pm' ? null : 'pm'">Délután</button>
        </div>
        <GuardianLine v-if="lastGuardian && !entryForm" v-bind="lastGuardian" @close="lastGuardian = null" />
        <form v-if="entryForm" class="note-form" @submit.prevent="saveEntry()">
          <b class="small">{{ entryForm.type === 'insulin' ? 'Inzulin felvétele' : entryForm.type === 'carbs' ? 'Szénhidrát felvétele' : 'Vércukor felvétele (kézi mérés)' }}</b>
          <div class="note-form-row">
            <label class="note-time">Dátum <input v-model="entryForm.date" type="date" :max="data.today" required></label>
            <label class="note-time">Időpont <input v-model="entryForm.time" type="time" required></label>
            <label class="note-time">Mennyiség
              <input
                v-model="entryForm.value" type="text" required class="entry-amount"
                :inputmode="entryForm.type === 'carbs' ? 'numeric' : 'decimal'" :placeholder="entryForm.type === 'insulin' ? 'pl. 4,5' : entryForm.type === 'glucose' ? 'pl. 6,8' : 'pl. 45'"
              >
              <span class="muted">{{ entryForm.type === 'insulin' ? 'E' : entryForm.type === 'glucose' ? 'mmol/L' : 'g' }}</span>
            </label>
            <select v-if="entryForm.type === 'insulin'" v-model="entryForm.sub" class="sub-select" aria-label="Típus">
              <option value="">Automatikus</option>
              <option value="meal">Étkezési bólus</option>
              <option value="correction">Korrekció</option>
              <option value="basal">Bázis</option>
            </select>
            <div v-else-if="entryForm.type === 'carbs'" class="note-tags" role="group" aria-label="Jelölés" :title="CARB_TAG_HINT.normal">
              <button type="button" class="tag-toggle" :aria-pressed="entryForm.sub === 'fatty'" :title="CARB_TAG_HINT.fatty" @click="entryForm.sub = entryForm.sub === 'fatty' ? '' : 'fatty'">{{ CARB_TAG_ICON.fatty }} zsíros</button>
              <button type="button" class="tag-toggle" :aria-pressed="entryForm.sub === 'fast'" :title="CARB_TAG_HINT.fast" @click="entryForm.sub = entryForm.sub === 'fast' ? '' : 'fast'">{{ CARB_TAG_ICON.fast }} gyors</button>
              <GuideLink section="zsiros" text="Zsíros ételek" label="Mit jelölj zsírosnak? Példák táblázattal" />
            </div>
            <template v-if="entryForm.type === 'carbs' && entryForm.sub === 'fatty'">
              <label class="note-time">Zsír <input v-model="entryForm.fat" type="text" inputmode="decimal" class="entry-amount" placeholder="g"> <span class="muted">g</span></label>
              <label class="note-time">Fehérje <input v-model="entryForm.protein" type="text" inputmode="decimal" class="entry-amount" placeholder="g"> <span class="muted">g</span></label>
            </template>
          </div>
          <p v-if="entryForm.type !== 'glucose'" class="muted small">Ha 30 percen belül már van ilyen típusú bejegyzés, rákérdez, hogy ne legyen véletlenül dupla.</p>
          <p v-else class="muted small">A kézi mérés „kézi” jelöléssel kerül a naplóba és a grafikonra. Pontos mérésként beleszámít az értékekbe (átlag, célban töltött idő, hipóesemények), de a szenzorlefedettségbe és a trendnyílba nem. A bóluskalkulátor használhatja, ha újabb a szenzor értékénél.</p>
          <div class="btn-row">
            <button type="submit" class="sm" :disabled="entrySaving">Mentés</button>
            <button type="button" class="ghost sm" @click="entryForm = null">Mégse</button>
          </div>
        </form>
        <form v-if="noteForm" class="note-form" @submit.prevent="saveNote">
          <div class="note-form-row">
            <label class="note-time">Időpont <input v-model="noteForm.time" type="time" required></label>
            <div class="note-tags" role="group" aria-label="Címkék">
              <button
                v-for="tg in NOTE_TAGS" :key="tg.id" type="button" class="tag-toggle"
                :aria-pressed="noteForm.tags.includes(tg.id)" @click="toggleNoteTag(tg.id)"
              >{{ tg.label }}</button>
            </div>
          </div>
          <input v-model="noteForm.text" type="text" maxlength="500" placeholder="Megjegyzés (pl. 40 perc futás, láz, 2 pohár bor)" aria-label="Megjegyzés">
          <div class="btn-row">
            <button type="submit" class="sm" :disabled="noteSaving">Mentés</button>
            <button type="button" class="ghost sm" @click="noteForm = null">Mégse</button>
          </div>
        </form>
        <p v-if="!readOnly" class="muted small">A bázis az, amit bázisnak jelölsz, vagy amit a Terápia oldalon beállított automatikus beírás rögzít. A típus nélküli bólus automatikusan: étkezési, ha 60 percen belül utána (előbólus) vagy 30 percen belül előtte szénhidrát is van; különben korrekció. Az „(auto)” sorokat a legördülővel bármikor átállíthatod (pl. korrekcióról étkezési bólusra), a × gombbal törölheted (a telefon sem tölti vissza).</p>
        <div v-if="!half && data.halves?.some((h: any) => h.stats.n)" class="half-compare">
          <div v-for="h in data.halves" :key="h.key" class="tir">
            <div class="tir-title">{{ h.label }} <span class="muted">{{ h.span }} óra</span></div>
            <p v-if="!h.stats.n" class="muted small">Nincs glükózadat.</p>
            <template v-else>
              <div class="tir-row">
                <div class="tir-bar">
                  <template v-for="[k] in bandLabels" :key="k">
                    <span v-if="h.stats.pct[k] > 0" class="seg" :class="'seg-' + k" :style="{ flexBasis: h.stats.pct[k] + '%' }" />
                  </template>
                </div>
                <ul class="tir-legend">
                  <li v-for="[k, name, range] in bandLabels" :key="k">
                    <span class="key" :class="'seg-' + k" />
                    <span>{{ name }} <span class="muted">{{ range }}</span></span>
                    <b>{{ fmt(h.stats.pct[k], 0) }}%</b>
                  </li>
                </ul>
              </div>
              <p class="small muted">átlag <b>{{ fmt(h.stats.avg) }}</b> mmol/L · CH <b>{{ fmt(h.carbs, 0) }}</b> g · bólus <b>{{ fmt(h.meal + h.correction) }}</b> E<template v-if="h.correction"> (ebből korrekció {{ fmt(h.correction) }})</template></p>
            </template>
          </div>
        </div>
        <div v-if="shownRows.length" class="table-wrap">
          <table class="table log-table">
            <thead><tr><th>Idő</th><th>Esemény</th><th class="num">Mennyiség</th><th class="num c-gl">Glükóz</th><th v-if="!readOnly"><span class="sr-only">Törlés</span></th></tr></thead>
            <tbody>
              <tr v-for="e in shownRows" :key="e.type + e.id" :class="{ 'note-row': e.type === 'note', 'excluded-row': e.type === 'excluded' }">
                <td class="num">{{ e.time }}</td>
                <template v-if="e.type === 'excluded'">
                  <td>
                    <span class="dot dot-excluded" />
                    Szenzorhiba, kizárva {{ hmMs(e.from) }}–{{ hmMs(e.to) }}
                    <svg v-if="e.spark" class="excl-spark" viewBox="0 0 120 22" width="120" height="22" aria-hidden="true"><polyline :points="e.spark" /></svg>
                    <div class="small excl-detail">
                      <template v-if="e.before != null">előtte {{ sgText(e.before) }} · </template>
                      <template v-if="e.lo">legalacsonyabb {{ sgText(e.lo[1]) }} ({{ hmMs(e.lo[0]) }})</template>
                      <template v-if="e.hi && e.hi[1] !== e.lo?.[1]"> · legmagasabb {{ sgText(e.hi[1]) }}</template>
                      <template v-if="e.after != null"> · utána {{ sgText(e.after) }}</template>
                    </div>
                  </td>
                  <td class="num">{{ e.n }} mérés</td>
                  <td class="num c-gl">{{ e.lo ? sgText(e.lo[1]) : '–' }}</td>
                </template>
                <template v-else-if="e.type === 'note'">
                  <td colspan="2">
                    <span class="dot dot-note" />
                    <span v-for="tg in e.tags" :key="tg" class="note-chip">{{ noteTagLabel(tg) }}</span>
                    <span class="note-text">{{ e.text }}</span>
                  </td>
                  <td class="c-gl" />
                </template>
                <template v-else>
                  <td>
                    <span class="dot" :class="'dot-' + eventDot(e)" />
                    <template v-if="e.type === 'insulin'">
                      <select v-if="!readOnly" :value="subValue(e)" class="sub-select" aria-label="Típus" @change="setSub(e, ($event.target as HTMLSelectElement).value)">
                        <option value="">{{ e.auto ? `${kindLabel(e)} (auto)` : 'Automatikus' }}</option>
                        <option value="meal">Étkezési bólus</option>
                        <option value="correction">Korrekció</option>
                        <option value="basal">Bázis</option>
                      </select>
                      <template v-else>{{ kindLabel(e) }}</template>
                      <span v-if="e.autoBasal" class="note-chip name-chip chip-auto">automatikus</span>
                      <span v-else-if="e.manual" class="note-chip name-chip">kézi</span>
                      <div v-if="calcText(e)" class="macro-line small muted" title="A bóluskalkulátor számítása a beíráskor">{{ calcText(e) }}</div>
                    </template>
                    <template v-else>
                      {{ eventLabel(e) }}
                      <template v-if="!readOnly && e.type === 'carbs'">
                        <button
                          type="button" class="tag-toggle tag-fatty" :aria-pressed="e.sub === 'fatty'"
                          :title="CARB_TAG_HINT.fatty"
                          @click="toggleCarbTag(e, 'fatty')"
                        >{{ CARB_TAG_ICON.fatty }} zsíros</button>
                        <button
                          type="button" class="tag-toggle tag-fast" :aria-pressed="e.sub === 'fast'"
                          :title="CARB_TAG_HINT.fast"
                          @click="toggleCarbTag(e, 'fast')"
                        >{{ CARB_TAG_ICON.fast }} gyors</button>
                      </template>
                      <span v-else-if="e.type === 'carbs' && e.sub === 'fatty'" class="note-chip tag-fatty">{{ CARB_TAG_ICON.fatty }} zsíros</span>
                      <span v-else-if="e.type === 'carbs' && e.sub === 'fast'" class="note-chip tag-fast">{{ CARB_TAG_ICON.fast }} gyors</span>
                      <!-- Zsíros CH: zsír / fehérje (megjelenítés, és utólagos beírás / javítás). -->
                      <div v-if="e.type === 'carbs' && e.sub === 'fatty'" class="macro-line small">
                        <template v-if="macroEdit?.id === e.id">
                          <input v-model="macroEdit.fat" type="text" inputmode="decimal" placeholder="zsír" aria-label="Zsír, gramm"> g zsír,
                          <input v-model="macroEdit.protein" type="text" inputmode="decimal" placeholder="fehérje" aria-label="Fehérje, gramm"> g fehérje
                          <button type="button" class="sm" @click="saveMacros">Mentés</button>
                          <button type="button" class="link-btn" @click="macroEdit = null">Mégse</button>
                        </template>
                        <template v-else>
                          <span class="muted">{{ macroText(e) || 'zsír / fehérje nincs megadva' }}</span>
                          <button v-if="!readOnly" type="button" class="link-btn" @click="openMacroEdit(e)">{{ macroText(e) ? 'javítás' : 'megadás' }}</button>
                        </template>
                      </div>
                    </template>
                  </td>
                  <td class="num"><span v-if="e.autoBasal" class="note-chip manual-chip" title="A Terápia oldalon beállított időpontban automatikusan beírva">automatikus</span><span v-else-if="e.manual" class="note-chip manual-chip" title="Kézzel felvett bejegyzés">kézi</span>{{ e.type === 'carbs' ? fmt(e.v, 0) + ' g' : e.type === 'glucose' ? fmt(e.v) + ' mmol/L' : fmt(e.v) + ' E' }}</td>
                  <td class="num c-gl">{{ e.glucose != null ? sgText(e.glucose) : '–' }}</td>
                </template>
                <td v-if="!readOnly" class="act">
                  <button
                    type="button" class="row-del" :disabled="deletingId === e.type + e.id"
                    :aria-label="e.type === 'excluded' ? `${e.time} kizárás visszavonása` : `${e.time} ${e.type === 'note' ? 'jegyzet' : eventLabel(e)} törlése`"
                    :title="e.type === 'excluded' ? 'Kizárás visszavonása' : 'Törlés'"
                    @click="e.type === 'excluded' ? undoExcluded(e) : e.type === 'note' ? deleteNote(e) : deleteEvent(e)"
                  >×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted">{{ logRows.length ? 'Ebben a napszakban nincs bejegyzés.' : 'Erre a napra nincs bejegyzés.' }}</p>
      </section>

      <section class="card">
        <h2>Idő a tartományokban <GuideLink section="glukoz" /></h2>
        <div v-for="(s, title) in { 'Ez a nap': data.stats.day, 'Utolsó 14 nap': data.stats.range14 }" :key="title" class="tir">
          <div class="tir-title">{{ title }}</div>
          <p v-if="!s.n" class="muted">Nincs glükózadat.</p>
          <div v-else class="tir-row">
            <div class="tir-bar">
              <template v-for="[k] in bandLabels" :key="k">
                <span v-if="s.pct[k] > 0" class="seg" :class="'seg-' + k" :style="{ flexBasis: s.pct[k] + '%' }" />
              </template>
            </div>
            <ul class="tir-legend">
              <li v-for="[k, name, range] in bandLabels" :key="k">
                <span class="key" :class="'seg-' + k" />
                <span>{{ name }} <span class="muted">{{ range }}</span></span>
                <b>{{ fmt(s.pct[k], 0) }}%</b>
              </li>
            </ul>
          </div>
        </div>
        <dl v-if="data.stats.range14.n" class="facts">
          <div><dt>14 napos átlag</dt><dd>{{ fmt(data.stats.range14.avg) }} mmol/L</dd></div>
          <div><dt>GMI (becsült HbA1c)</dt><dd>{{ fmt(data.stats.range14.gmi) }}%</dd></div>
          <div><dt>Variabilitás (CV)</dt><dd>{{ fmt(data.stats.range14.cv, 0) }}%</dd></div>
        </dl>
      </section>
    </div>

    <section class="card">
      <h2>Utolsó 14 nap</h2>
      <div class="table-wrap">
        <table class="table days-table">
          <thead><tr><th>Nap</th><th class="num">Átlag</th><th class="num">Célban</th><th class="num">Alacsony</th><th class="num">Inzulin</th><th class="num">Adag</th><th class="num">CH</th></tr></thead>
          <tbody>
            <tr v-for="row in data.summary" :key="row.date" :class="{ current: row.date === data.day }">
              <td><a href="#" @click.prevent="go(row.date)">{{ row.label }} <span class="muted">{{ row.weekday }}</span></a></td>
              <td class="num">{{ fmt(row.avg) }}</td>
              <td class="num"><span v-if="row.inRange != null" class="tir-mini" :class="tirClass(row.inRange)"><span :style="{ width: row.inRange + '%' }" /></span><span class="tir-val" :class="row.inRange != null && tirClass(row.inRange)">{{ row.inRange != null ? fmt(row.inRange, 0) + '%' : '–' }}</span></td>
              <td class="num" :class="{ 'c-low': row.low >= 4 }">{{ row.low != null ? fmt(row.low, 0) + '%' : '–' }}</td>
              <td class="num c-ins">{{ row.insulin ? fmt(row.insulin) + ' E' : '–' }}</td>
              <td class="num c-muted">{{ row.doses || '–' }}</td>
              <td class="num c-carbs">{{ row.carbs ? fmt(row.carbs, 0) + ' g' : '–' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    </template>
    </div>

    <!-- Asztali nézetben bal oldali sáv, keskeny kijelzőn a tartalom alatt. -->
    <aside class="home-side">
      <BolusCalc v-if="!readOnly" @logged="refresh" />
      <TherapyCard />
    </aside>

    <!-- Asztali nézetben jobb oldali sáv (szenzorállapot, értesítésnapló), keskeny kijelzőn a bóluskalkulátor után. -->
    <aside v-if="!readOnly" class="home-right">
      <SensorCard v-if="device" :device="device" />
      <NotifyLogCard />
    </aside>

    <p class="muted small disclaimer">Saját nyilvántartás, nem orvostechnikai eszköz. Kezelési döntéshez a Guardian app értékeit és a diabetológusod útmutatását használd.</p>
  </main>
</template>
