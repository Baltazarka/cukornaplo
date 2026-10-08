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
const { data, refresh } = await useFetch('/api/day', { query: { date } })
const { data: agp } = await useAsyncData(
  'agp',
  () => (period.value > 1 ? $fetch<any>('/api/agp', { query: { end: date.value || undefined, days: period.value } }) : Promise.resolve(null)),
  { watch: [period, date] },
)

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
async function setSub(e: any, v: string) {
  await $fetch('/api/entry-subtype', { method: 'POST', body: { id: e.id, subtype: v } })
  await refresh()
}

// Egy inzulin- vagy CH-sor törlése (megerősítéssel). A telefon később sem tölti vissza.
const deletingId = ref<number | null>(null)
async function deleteEvent(e: any) {
  const amount = e.type === 'carbs' ? `${fmt(e.v, 0)} g` : `${fmt(e.v)} E`
  if (!confirm(`Biztos törlöd ezt a bejegyzést?\n\n${e.time}  ${eventLabel(e)}  ${amount}`)) return
  deletingId.value = e.id
  try {
    await $fetch('/api/entry-delete', { method: 'POST', body: { id: e.id } })
    await refresh()
  } catch (err: any) {
    alert(err?.data?.error ?? 'A törlés nem sikerült.')
  } finally {
    deletingId.value = null
  }
}

const lowPct = (s: any) => (s?.n ? s.pct.low + s.pct.veryLow : null)

const eventLabel = (e: any) =>
  e.type === 'carbs' ? 'Szénhidrát' : e.sub === 'basal' ? 'Bázisinzulin' : 'Inzulin'
const eventDot = (e: any) =>
  e.type === 'insulin' && e.sub === 'basal' ? 'basal' : e.type
</script>

<template>
  <main v-if="data" class="home">
    <div class="home-main">
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
    </div>

    <PeriodView v-if="period > 1 && agp" :data="agp" @day="openDay" />

    <template v-if="period === 1">
    <section v-if="!data.stats.day.n && !data.events.length" class="card">
      <p>Erre a napra nincs adat.</p>
      <p class="muted">Ha még nem állítottad be, a <NuxtLink to="/telefon">Telefon beállítása</NuxtLink> varázsló végigvezet a telefonos küldésen, a szenzorgörbéhez pedig az <NuxtLink to="/adatok">Adatok és import</NuxtLink> oldalon kötheted be a CareLinket.</p>
    </section>

    <section class="tiles">
      <div class="tile"><div class="tile-label">Átlag glükóz</div><div class="tile-value">{{ fmt(data.stats.day.avg) }} <small>mmol/L</small></div></div>
      <div class="tile"><div class="tile-label">Céltartományban</div><div class="tile-value">{{ fmt(data.stats.day.n ? data.stats.day.pct.inRange : null, 0) }} <small>%</small></div></div>
      <div class="tile"><div class="tile-label">Alacsony (&lt; 3,9)</div><div class="tile-value">{{ fmt(lowPct(data.stats.day), 0) }} <small>%</small></div></div>
      <div class="tile"><div class="tile-label">Összes inzulin</div><div class="tile-value">{{ fmt(data.totals.insulin) }} <small>E</small></div></div>
      <div class="tile"><div class="tile-label">Összes szénhidrát</div><div class="tile-value">{{ fmt(data.totals.carbs, 0) }} <small>g</small></div></div>
      <div class="tile"><div class="tile-label">Szenzoradat</div><div class="tile-value">{{ fmt(data.coverage, 0) }} <small>%</small></div></div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Napi görbe</h2>
        <form class="range-edit" @submit.prevent="saveRange">
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
        <h2>Napló</h2>
        <form class="range-edit" @submit.prevent="saveBasal">
          <span class="muted">Bázisadagom:</span>
          <input v-model.number="basalDose" type="number" step="0.5" min="0" max="100" placeholder="pl. 52" aria-label="Bázisadag (E)">
          <span class="muted">E</span>
          <button type="submit" class="ghost sm">Mentés</button>
        </form>
        <p class="muted small">Minden adag bólus, kivéve a pontosan ekkora újonnan érkezőt (üresen hagyva kikapcsolva). Egy sor típusát a legördülővel javíthatod, a × gombbal törölheted (a telefon sem tölti vissza).</p>
        <div v-if="data.events.length" class="table-wrap">
          <table class="table">
            <thead><tr><th>Idő</th><th>Esemény</th><th class="num">Mennyiség</th><th class="num">Glükóz</th><th><span class="sr-only">Törlés</span></th></tr></thead>
            <tbody>
              <tr v-for="e in data.events" :key="e.id">
                <td class="num">{{ e.time }}</td>
                <td>
                  <span class="dot" :class="'dot-' + eventDot(e)" />
                  <select v-if="e.type === 'insulin'" :value="e.sub ?? ''" class="sub-select" aria-label="Típus" @change="setSub(e, ($event.target as HTMLSelectElement).value)">
                    <option value="">Inzulin</option>
                    <option value="bolus">Bólus</option>
                    <option value="basal">Bázis</option>
                  </select>
                  <template v-else>{{ eventLabel(e) }}</template>
                </td>
                <td class="num">{{ e.type === 'carbs' ? fmt(e.v, 0) + ' g' : fmt(e.v) + ' E' }}</td>
                <td class="num">{{ e.glucose != null ? fmt(e.glucose) : '–' }}</td>
                <td class="act">
                  <button
                    type="button" class="row-del" :disabled="deletingId === e.id"
                    :aria-label="`${e.time} ${eventLabel(e)} törlése`" :title="'Törlés'"
                    @click="deleteEvent(e)"
                  >×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted">Erre a napra nincs inzulin- vagy CH-bejegyzés.</p>
      </section>

      <section class="card">
        <h2>Idő a tartományokban</h2>
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
      <TherapyCard />
    </aside>

    <p class="muted small disclaimer">Saját nyilvántartás, nem orvostechnikai eszköz. Kezelési döntéshez a Guardian és az InPen app értékeit használd.</p>
  </main>
</template>
