<script setup lang="ts">
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
async function checkFresh(force = false) {
  const v = await $fetch<{ stamp: string; alert: any }>('/api/version').catch((e) => {
    // Lejárt munkamenet (pl. a megosztási link ideje letelt): vissza a belépéshez.
    if (e?.statusCode === 401 || e?.response?.status === 401) navigateTo(readOnly.value ? '/login?lejart=1' : '/login')
    return null
  })
  if (!v) return
  clAlert.value = v.alert
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
  } finally {
    saving.value = false
  }
}

// Bázis-küszöb és az inzulinsorok típusának utólagos állítása.
const basalDose = ref<number | null>(null)
const basalLoaded = ref(false)
watchEffect(() => {
  if (data.value && !basalLoaded.value) {
    basalDose.value = data.value.basalDose
    basalLoaded.value = true
  }
})
async function saveBasal() {
  await $fetch('/api/basal', { method: 'POST', body: { basal_dose: basalDose.value || null } })
  await refresh()
}
// Szénhidrát jelölése: zsíros / fehérjedús (a CH-arány becslése kihagyja, az elemzés külön mutatja),
// vagy gyors CH (pl. hipó kezelése). A kettő kizárja egymást; újra kattintva a jelölés lekerül.
async function toggleCarbTag(e: any, tag: 'fatty' | 'fast') {
  await $fetch('/api/entry-tag', { method: 'POST', body: { id: e.id, tag: e.sub === tag ? null : tag } })
  await refresh()
}
async function setSub(e: any, v: string) {
  await $fetch('/api/entry-subtype', { method: 'POST', body: { id: e.id, subtype: v } })
  await refresh()
}

// Egy inzulin- vagy CH-sor törlése (megerősítéssel). A telefon később sem tölti vissza.
const deletingId = ref<string | null>(null)
async function deleteEvent(e: any) {
  const amount = e.type === 'carbs' ? `${fmt(e.v, 0)} g` : `${fmt(e.v)} E`
  if (!confirm(`Biztos törlöd ezt a bejegyzést?\n\n${e.time}  ${eventLabel(e)}  ${amount}`)) return
  deletingId.value = e.type + e.id
  try {
    await $fetch('/api/entry-delete', { method: 'POST', body: { id: e.id } })
    await refresh()
  } catch (err: any) {
    alert(err?.data?.error ?? 'A törlés nem sikerült.')
  } finally {
    deletingId.value = null
  }
}

// Napló: bejegyzések és jegyzetek időrendben.
const logRows = computed<any[]>(() =>
  [...(data.value?.events ?? []), ...(data.value?.notes ?? []).map((n: any) => ({ ...n, type: 'note' }))].sort((a, b) => a.ts - b.ts))

// Új jegyzet: időpont (mai napon most, különben 12:00), címkék, szöveg.
const noteForm = ref<{ time: string; tags: string[]; text: string } | null>(null)
const noteError = ref('')
const noteSaving = ref(false)
function defaultTime() {
  const now = new Date()
  return data.value?.day === data.value?.today
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : '12:00'
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
const entryForm = ref<{ type: 'insulin' | 'carbs'; date: string; time: string; value: string; sub: string } | null>(null)
const entryError = ref('')
const entrySaving = ref(false)
function openEntryForm(type: 'insulin' | 'carbs') {
  noteForm.value = null
  // Alapból a megnézett nap, de átírható (pl. tegnapi adag utólagos felvétele).
  const date = data.value?.day ?? ''
  entryForm.value = { type, date, time: date === data.value?.today ? defaultTime() : '12:00', value: '', sub: '' }
  entryError.value = ''
}
async function saveEntry(force = false) {
  const f = entryForm.value!
  entrySaving.value = true
  entryError.value = ''
  try {
    await $fetch('/api/entry-add', { method: 'POST', body: { ...f, force } })
    entryForm.value = null
    // Másik napra vett bejegyzésnél oda ugrunk, hogy látszódjon.
    if (f.date && f.date !== data.value!.day) go(f.date)
    else await refresh()
  } catch (e: any) {
    // Hasonló bejegyzés a közelben (pl. az InPen már elküldte): rákérdezünk.
    if (e?.data?.duplicate && !force && confirm(`${e.data.error}

Mégis felveszed?`)) return saveEntry(true)
    entryError.value = e?.data?.duplicate ? '' : e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    entrySaving.value = false
  }
}

async function deleteNote(n: any) {
  const what = [...n.tags.map(noteTagLabel), n.text].filter(Boolean).join(', ')
  if (!confirm(`Biztos törlöd ezt a jegyzetet?\n\n${n.time}  ${what}`)) return
  deletingId.value = 'note' + n.id
  try {
    await $fetch('/api/note-delete', { method: 'POST', body: { id: n.id } })
    await refresh()
  } finally {
    deletingId.value = null
  }
}

const KIND_LABEL: Record<string, string> = { meal: 'Étkezési bólus', correction: 'Korrekció', basal: 'Bázis' }
const kindLabel = (e: any) => (e.kind === 'meal' && e.noCarbs ? 'Étkezési bólus, CH nélkül' : KIND_LABEL[e.kind] ?? 'Inzulin')
const eventLabel = (e: any) => (e.type === 'carbs' ? 'Szénhidrát' : kindLabel(e))
const eventDot = (e: any) =>
  e.type !== 'insulin' ? e.type : e.kind === 'basal' ? 'basal' : e.kind === 'correction' ? 'correction' : 'insulin'
// A legördülő értéke: a kézi típus, vagy üres = automatikus (becsült) besorolás.
const subValue = (e: any) => (['meal', 'correction', 'basal'].includes(e.sub) ? e.sub : '')
</script>

<template>
  <main v-if="data" class="home">
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
      <NuxtLink
        class="btn ghost report-link" :to="{ path: '/riport', query: { days: period > 1 ? period : 14, end: (period > 1 ? agp?.end : data.day) || undefined } }"
        title="Részletes, nyomtatható riport (PDF-be menthető)"
      >Riport / PDF</NuxtLink>
    </div>

    <PeriodView v-if="period > 1 && agp" :data="agp" @day="openDay" />

    <template v-if="period === 1">
    <section v-if="!data.stats.day.n && !data.events.length" class="card">
      <p>Erre a napra nincs adat.</p>
      <p class="muted">Ha még nem állítottad be, a <NuxtLink to="/telefon">Telefon beállítása</NuxtLink> varázsló végigvezet a telefonos küldésen, a szenzorgörbéhez pedig az <NuxtLink to="/adatok">Beállítások</NuxtLink> oldalon kötheted be a CareLinket.</p>
    </section>

    <StatTiles
      :stats="data.stats.day" :change="data.change" :range="data.range" :coverage="data.coverage" :hypos="data.hypos"
      :insulin="{ total: data.totals.insulin, meal: data.totals.meal, correction: data.totals.correction, basal: data.totals.basal, basalAssumedDays: data.totals.basalAssumedDays }" :carbs="data.totals.carbs" :partial="data.day === data.today"
    />

    <section class="card">
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
        <GlucoseDayChart :day="data" />
        <template #fallback><div class="chart-box" /></template>
      </ClientOnly>
    </section>

    <div class="grid2">
      <section class="card">
        <div class="card-head">
          <h2>Napló</h2>
          <div v-if="!readOnly && !noteForm && !entryForm" class="log-add">
            <button type="button" class="ghost sm" @click="openEntryForm('insulin')">+ Inzulin</button>
            <button type="button" class="ghost sm" @click="openEntryForm('carbs')">+ CH</button>
            <button type="button" class="ghost sm" @click="openNoteForm">+ Jegyzet</button>
          </div>
        </div>
        <form v-if="entryForm" class="note-form" @submit.prevent="saveEntry()">
          <b class="small">{{ entryForm.type === 'insulin' ? 'Inzulin felvétele' : 'Szénhidrát felvétele' }}</b>
          <div class="note-form-row">
            <label class="note-time">Dátum <input v-model="entryForm.date" type="date" :max="data.today" required></label>
            <label class="note-time">Időpont <input v-model="entryForm.time" type="time" required></label>
            <label class="note-time">Mennyiség
              <input
                v-model="entryForm.value" type="text" required class="entry-amount"
                :inputmode="entryForm.type === 'insulin' ? 'decimal' : 'numeric'" :placeholder="entryForm.type === 'insulin' ? 'pl. 4,5' : 'pl. 45'"
              >
              <span class="muted">{{ entryForm.type === 'insulin' ? 'E' : 'g' }}</span>
            </label>
            <select v-if="entryForm.type === 'insulin'" v-model="entryForm.sub" class="sub-select" aria-label="Típus">
              <option value="">Automatikus</option>
              <option value="meal">Étkezési bólus</option>
              <option value="correction">Korrekció</option>
              <option value="basal">Bázis</option>
            </select>
            <div v-else class="note-tags" role="group" aria-label="Jelölés">
              <button type="button" class="tag-toggle" :aria-pressed="entryForm.sub === 'fatty'" @click="entryForm.sub = entryForm.sub === 'fatty' ? '' : 'fatty'">zsíros</button>
              <button type="button" class="tag-toggle" :aria-pressed="entryForm.sub === 'fast'" @click="entryForm.sub = entryForm.sub === 'fast' ? '' : 'fast'">gyors</button>
            </div>
          </div>
          <p class="muted small">Ha az InPen később ugyanezt elküldi (azonos mennyiség, 30 percen belül), a kézi sor beolvad, nem lesz dupla.</p>
          <p v-if="entryError" class="err-text small">{{ entryError }}</p>
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
          <p v-if="noteError" class="err-text small">{{ noteError }}</p>
          <div class="btn-row">
            <button type="submit" class="sm" :disabled="noteSaving">Mentés</button>
            <button type="button" class="ghost sm" @click="noteForm = null">Mégse</button>
          </div>
        </form>
        <form v-if="!readOnly" class="range-edit" @submit.prevent="saveBasal">
          <span class="muted">Bázisadagom:</span>
          <input v-model.number="basalDose" type="number" step="0.5" min="0" max="100" placeholder="pl. 52" aria-label="Bázisadag (E)">
          <span class="muted">E</span>
          <button type="submit" class="ghost sm">Mentés</button>
        </form>
        <p v-if="!readOnly" class="muted small">A pontosan ekkora újonnan érkező adag bázis (üresen hagyva kikapcsolva). A többi bólus automatikusan: étkezési, ha 60 percen belül utána (előbólus) vagy 30 percen belül előtte szénhidrát is van; „CH nélküli” étkezési, ha nincs szénhidrát, de a vércukor a célérték + 2 mmol/L alatt volt; különben korrekció. Az „(auto)” sorokat a legördülővel bármikor átállíthatod (pl. korrekcióról étkezési bólusra), a × gombbal törölheted (a telefon sem tölti vissza).</p>
        <div v-if="logRows.length" class="table-wrap">
          <table class="table log-table">
            <thead><tr><th>Idő</th><th>Esemény</th><th class="num">Mennyiség</th><th class="num">Glükóz</th><th v-if="!readOnly"><span class="sr-only">Törlés</span></th></tr></thead>
            <tbody>
              <tr v-for="e in logRows" :key="e.type + e.id" :class="{ 'note-row': e.type === 'note' }">
                <td class="num">{{ e.time }}</td>
                <td v-if="e.type === 'note'" colspan="3">
                  <span class="dot dot-note" />
                  <span v-for="tg in e.tags" :key="tg" class="note-chip">{{ noteTagLabel(tg) }}</span>
                  <span class="note-text">{{ e.text }}</span>
                </td>
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
                    </template>
                    <template v-else>
                      {{ eventLabel(e) }}
                      <template v-if="!readOnly">
                        <button
                          type="button" class="tag-toggle" :aria-pressed="e.sub === 'fatty'"
                          title="Zsíros / fehérjedús étkezés: később emeli a vércukrot, ezért a CH-arány becslése kihagyja"
                          @click="toggleCarbTag(e, 'fatty')"
                        >zsíros</button>
                        <button
                          type="button" class="tag-toggle" :aria-pressed="e.sub === 'fast'"
                          title="Gyors szénhidrát (pl. hipó kezelése, gyümölcslé, szőlőcukor): hamar emel és hamar lecseng"
                          @click="toggleCarbTag(e, 'fast')"
                        >gyors</button>
                      </template>
                      <span v-else-if="e.sub === 'fatty'" class="note-chip">zsíros</span>
                      <span v-else-if="e.sub === 'fast'" class="note-chip">gyors</span>
                    </template>
                  </td>
                  <td class="num"><span v-if="e.manual" class="note-chip manual-chip" title="Kézzel felvett bejegyzés">kézi</span>{{ e.type === 'carbs' ? fmt(e.v, 0) + ' g' : fmt(e.v) + ' E' }}</td>
                  <td class="num">{{ e.glucose != null ? fmt(e.glucose) : '–' }}</td>
                </template>
                <td v-if="!readOnly" class="act">
                  <button
                    type="button" class="row-del" :disabled="deletingId === e.type + e.id"
                    :aria-label="`${e.time} ${e.type === 'note' ? 'jegyzet' : eventLabel(e)} törlése`" :title="'Törlés'"
                    @click="e.type === 'note' ? deleteNote(e) : deleteEvent(e)"
                  >×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted">Erre a napra nincs bejegyzés.</p>
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
        <table class="table">
          <thead><tr><th>Nap</th><th class="num">Átlag</th><th class="num">Célban</th><th class="num">Alacsony</th><th class="num">Inzulin</th><th class="num">Adag</th><th class="num">CH</th></tr></thead>
          <tbody>
            <tr v-for="row in data.summary" :key="row.date" :class="{ current: row.date === data.day }">
              <td><a href="#" @click.prevent="go(row.date)">{{ row.label }} <span class="muted">{{ row.weekday }}</span></a></td>
              <td class="num">{{ fmt(row.avg) }}</td>
              <td class="num">{{ row.inRange != null ? fmt(row.inRange, 0) + '%' : '–' }}</td>
              <td class="num">{{ row.low != null ? fmt(row.low, 0) + '%' : '–' }}</td>
              <td class="num">{{ row.insulin ? fmt(row.insulin) + ' E' : '–' }}</td>
              <td class="num">{{ row.doses || '–' }}</td>
              <td class="num">{{ row.carbs ? fmt(row.carbs, 0) + ' g' : '–' }}</td>
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

    <p class="muted small disclaimer">Saját nyilvántartás, nem orvostechnikai eszköz. Kezelési döntéshez a Guardian és az InPen app értékeit használd.</p>
  </main>
</template>
