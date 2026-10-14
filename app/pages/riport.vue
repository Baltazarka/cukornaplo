<script setup lang="ts">
// Nyomtatható riport (A4): összefoglaló mutatók, terápiás beállítások, glükózprofil (AGP),
// étkezések és bázisellenőrzés, becslések, majd napi bontásban a görbe és minden bejegyzés.
// PDF-be a böngésző nyomtatás → „Mentés PDF-ként” funkciójával menthető (iPhone-on is).
import type { Therapy } from '#shared/types/therapy'

const route = useRoute()
const router = useRouter()
const PERIODS = [7, 14, 30]
const days = computed(() => (PERIODS.includes(Number(route.query.days)) ? Number(route.query.days) : 14))
const end = computed(() => (typeof route.query.end === 'string' ? route.query.end : ''))
const q = computed(() => ({ end: end.value || undefined, days: days.value }))

const [{ data: agp }, { data: an }, { data: rep }, { data: th }, { data: hy }, { data: lab }] = await Promise.all([
  useFetch<any>('/api/agp', { query: q }),
  useFetch<any>('/api/analysis', { query: q }),
  useFetch<any>('/api/report', { query: q }),
  useFetch<{ therapy: Therapy | null }>('/api/therapy', { key: 'therapy' }),
  useFetch<any>('/api/hypo', { query: q }),
  useFetch<any>('/api/lab', { key: 'lab' }),
])
const { data: prof } = await useFetch<any>('/api/profile', { key: 'profile' })
const p = computed(() => prof.value?.profile ?? null)
const birthLabel = computed(() => {
  if (!p.value?.birthDate) return ''
  const age = ageOf(p.value.birthDate)
  return `${p.value.birthDate.replaceAll('-', '. ')}.${age != null ? ` (${age} éves)` : ''}`
})
const diabetesLabel = computed(() => {
  if (!p.value) return ''
  const type = diabetesTypeLabel(p.value.diabetesType)
  const since = p.value.diagnosisYear ? `${p.value.diagnosisYear} óta` : ''
  return [type ? `${type} cukorbetegség` : '', since].filter(Boolean).join(', ')
})
const lastLab = computed(() => lab.value?.results?.[0] ?? null)
const hypoDur = (min: number) => (min < 60 ? `${min} p` : `${Math.floor(min / 60)} ó ${min % 60} p`)
const t = computed(() => th.value?.therapy ?? null)

function setPeriod(d: number) {
  router.replace({ query: { ...route.query, days: String(d) } })
}
function setEnd(v: string) {
  router.replace({ query: { ...route.query, end: v } })
}
function print() {
  window.print()
}

// Nyomtatáshoz mindig világos téma; távozáskor visszaáll.
let prevTheme: string | null = null
onMounted(() => {
  prevTheme = document.documentElement.getAttribute('data-theme')
  document.documentElement.setAttribute('data-theme', 'light')
})
onBeforeUnmount(() => {
  if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme)
  else document.documentElement.removeAttribute('data-theme')
})

function fmt(v: number | null | undefined, dec = 1, sign = false): string {
  if (v == null || Number.isNaN(v)) return '–'
  const s = v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  return sign && v > 0 ? `+${s}` : s
}
const s = computed(() => agp.value?.stats)
const tar = computed(() => (s.value?.n ? s.value.pct.high + s.value.pct.veryHigh : null))
const tbr = computed(() => (s.value?.n ? s.value.pct.low + s.value.pct.veryLow : null))
const BANDS = [
  ['veryLow', 'Nagyon alacsony'], ['low', 'Alacsony'], ['inRange', 'Céltartomány'], ['high', 'Magas'], ['veryHigh', 'Nagyon magas'],
] as const
const generated = computed(() => (rep.value ? new Date(rep.value.generatedAt * 1000).toLocaleString('hu-HU') : ''))

// AGP a MiniBandChart-tal: 5–95% és 25–75% sáv, medián.
const agpChart = computed(() => {
  const a = agp.value?.agp
  if (!a) return null
  const max = Math.max(16, Math.ceil(Math.max(0, ...a.p95.filter((v: number | null) => v != null)) / 2) * 2)
  const yTicks: number[] = []
  for (let v = 2; v <= max; v += 2) yTicks.push(v)
  return {
    x: a.minutes,
    bands: [
      { lo: a.p5, hi: a.p95, color: 'color-mix(in srgb, var(--series-glucose) 14%, transparent)' },
      { lo: a.p25, hi: a.p75, color: 'color-mix(in srgb, var(--series-glucose) 34%, transparent)' },
    ],
    lines: [{ y: a.p50, color: 'var(--series-glucose)', label: 'medián' }],
    yTicks,
  }
})
const hh = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, '0')

const KIND_LABEL: Record<string, string> = {
  meal: 'Étkezési bólus', 'meal-nocarb': 'Étkezési bólus (CH nélkül)', correction: 'Korrekció', basal: 'Bázis',
}
/** Egy nap bejegyzései és jegyzetei időrendben. */
const rowsOf = (d: any) => [...d.events, ...d.notes.map((n: any) => ({ ...n, type: 'note' }))].sort((a, b) => a.minute - b.minute)
const preBolus = (v: number | null) => (v == null ? '–' : v < 0 ? `${-v} p előtte` : v > 0 ? `${v} p után` : 'evéskor')
const okPct = (r: any) => {
  const n = r.ok + r.spike + r.high + r.low
  return n ? Math.round((100 * r.ok) / n) : null
}
const basalState = (b: any) => (b.slope == null || b.hours < 1 ? 'kevés adat' : b.slope > 0.3 ? 'emelkedik' : b.slope < -0.3 ? 'csökken' : 'stabil')
</script>

<template>
  <main class="report">
    <div class="report-toolbar no-print">
      <div class="segmented" role="group" aria-label="Időszak">
        <button v-for="p in PERIODS" :key="p" type="button" :aria-pressed="days === p" @click="setPeriod(p)">{{ p }} nap</button>
      </div>
      <input type="date" :value="rep?.end" :max="rep?.today" aria-label="Az időszak utolsó napja" @change="setEnd(($event.target as HTMLInputElement).value)">
      <button type="button" class="ghost" @click="print">Nyomtatás / mentés PDF-be</button>
      <span class="muted small">A nyomtatási ablakban célként válaszd a „Mentés PDF-ként” lehetőséget. iPhone-on: Megosztás → Nyomtatás, ott fent a Megosztás ikon → Mentés a Fájlokba.</span>
    </div>

    <template v-if="agp && an && rep">
      <header class="report-head">
        <div>
          <h1>Cukornapló – glükózriport</h1>
          <div class="muted">{{ rep.start.replaceAll('-', '. ') }}. – {{ rep.end.replaceAll('-', '. ') }}. ({{ rep.days }} nap)</div>
        </div>
        <div class="report-meta muted small">
          <div>Készült: {{ generated }}</div>
          <div>Szenzoradat: {{ fmt(agp.coverage, 0) }}%</div>
        </div>
      </header>
      <dl class="report-patient">
        <div><dt>Név</dt><dd>{{ p?.name || '____________________' }}</dd></div>
        <div><dt>Születési dátum</dt><dd>{{ birthLabel || '______________' }}</dd></div>
        <div v-if="p?.taj"><dt>TAJ-szám</dt><dd>{{ formatTaj(p.taj) }}</dd></div>
        <div v-if="diabetesLabel"><dt>Diagnózis</dt><dd>{{ diabetesLabel }}</dd></div>
      </dl>

      <section class="report-section">
        <h2>Összefoglaló</h2>
        <div class="report-kpis">
          <div><span>Átlag glükóz</span><b>{{ fmt(s.avg) }} <small>mmol/L</small></b></div>
          <div><span>GMI (becsült HbA1c)</span><b>{{ fmt(s.gmi) }} <small>%</small></b></div>
          <div v-if="lastLab"><span>Labor HbA1c ({{ lastLab.date.replaceAll('-', '. ') }}.)</span><b>{{ fmt(lastLab.hba1c) }} <small>%</small></b></div>
          <div v-if="hy"><span>Hipóesemények</span><b>{{ hy.summary.n }} <small>ebből 2. szint: {{ hy.summary.level2 }}</small></b></div>
          <div><span>Szórás (SD)</span><b>{{ fmt(s.sd) }} <small>mmol/L</small></b></div>
          <div><span>Variációs koefficiens (CV)</span><b>{{ fmt(s.cv, 0) }} <small>%</small></b></div>
          <div><span>Céltartományban (TIR)</span><b>{{ fmt(s.n ? s.pct.inRange : null, 0) }} <small>%</small></b></div>
          <div><span>Magas (TAR)</span><b>{{ fmt(tar, 0) }} <small>%</small></b></div>
          <div><span>Alacsony (TBR)</span><b>{{ fmt(tbr, 0) }} <small>%</small></b></div>
          <div><span>Változásban (≥ 0,06/perc)</span><b>{{ fmt(rep.change?.any, 0) }} <small>%</small></b></div>
          <div><span>Inzulin naponta</span><b>{{ fmt(agp.totals.insulinPerDay) }} <small>E</small></b></div>
          <div><span>Bólus / korrekció / bázis{{ agp.totals.basalAssumedDays ? '*' : '' }}</span><b class="kpi-split">{{ fmt(agp.totals.mealPerDay) }} / {{ fmt(agp.totals.correctionPerDay) }} / {{ fmt(agp.totals.basalPerDay) }} <small>E</small></b></div>
          <div><span>Szénhidrát naponta</span><b>{{ fmt(agp.totals.carbsPerDay, 0) }} <small>g</small></b></div>
          <div><span>Napok InPen-adattal</span><b>{{ agp.totals.penDays }}</b></div>
        </div>
        <p v-if="agp.totals.basalAssumedDays" class="muted small">
          * {{ agp.totals.basalAssumedDays }} napon nem volt bázis a naplóban; ott a beállított bázisadaggal számoltunk (becsült).
        </p>
        <div v-if="s.n" class="report-tir">
          <div class="tir-hbar">
            <template v-for="[k] in BANDS" :key="k">
              <span v-if="s.pct[k] > 0" :class="'seg-' + k" :style="{ flexBasis: s.pct[k] + '%' }" />
            </template>
          </div>
          <div class="report-tir-legend small">
            <span v-for="[k, name] in BANDS" :key="k"><i :class="'seg-' + k" />{{ name }} {{ fmt(s.pct[k], 0) }}%</span>
          </div>
        </div>
      </section>

      <section v-if="t" class="report-section">
        <h2>Terápiás beállítások</h2>
        <p class="small">
          Bólusinzulin: <b>{{ insulinById(t.bolusInsulin)?.name ?? '–' }}</b> ·
          bázisinzulin: <b>{{ insulinById(t.basalInsulin)?.name ?? '–' }}</b> ·
          max. dózis: <b>{{ fmt(t.maxBolus, 1) }} E</b> ·
          inzulinhatás: <b>{{ actionLabel(t.actionMinutes) }}</b>
        </p>
        <table class="table report-table">
          <thead><tr><th>Napszak</th><th class="num">Cél (mmol/L)</th><th class="num">Érzékenység (mmol/L/E)</th><th class="num">CH-arány (g/E)</th><th class="num">Hatásidő</th></tr></thead>
          <tbody>
            <tr v-for="(sg, i) in (t.byTimeOfDay ? t.segments : t.segments.slice(0, 1))" :key="sg.start">
              <td>{{ t.byTimeOfDay ? `${sg.start}–${segmentEnd(t.segments, i)}` : 'Egész nap' }}</td>
              <td class="num">{{ fmt(sg.target) }}</td>
              <td class="num">{{ fmt(sg.isf) }}</td>
              <td class="num">{{ fmt(sg.icr) }}</td>
              <td class="num">{{ actionLabel(sg.actionMinutes ?? t.actionMinutes) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="agpChart" class="report-section">
        <h2>Glükózprofil (AGP)</h2>
        <p class="muted small">Az időszak minden napja egy közös 24 órás tengelyen (óra): medián, 25–75% és 5–95% sáv; szaggatott vonal a céltartomány; mmol/L.</p>
        <ClientOnly>
          <MiniBandChart
            :x="agpChart.x" :lines="agpChart.lines" :bands="agpChart.bands"
            :x-ticks="[0, 180, 360, 540, 720, 900, 1080, 1260, 1440]" :x-format="hh"
            :y-ticks="agpChart.yTicks" :y-format="(v: number) => String(v)" :ref-y="[rep.range.low, rep.range.high]" :height="210"
            caption=""
          >
            <template #legend>
              <span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 34%, transparent)" /> 25–75%</span>
              <span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 14%, transparent)" /> 5–95%</span>
            </template>
          </MiniBandChart>
        </ClientOnly>
      </section>

      <section v-if="hy" class="report-section">
        <h2>Hipók</h2>
        <p v-if="!hy.summary.n" class="small">Az időszakban nem volt hipóesemény (legalább 15 perc {{ fmt(hy.low) }} mmol/L alatt).</p>
        <template v-else>
          <p class="small">
            <b>{{ hy.summary.n }}</b> esemény (hetente {{ fmt(hy.summary.perWeek) }}), ebből <b>{{ hy.summary.level2 }}</b> 2. szintű (&lt; {{ fmt(hy.veryLow) }}),
            {{ hy.summary.night }} éjszakai (0–6 óra); átlagos hossz {{ hy.summary.avgMinutes }} perc, legalacsonyabb {{ fmt(hy.summary.lowest) }} mmol/L.
            Bólus utáni 4 órában: {{ hy.summary.afterBolus }}, túlkezelés (utána a céltartomány fölé): {{ hy.summary.overTreated }}.
          </p>
          <table class="table report-table">
            <thead><tr><th>Mikor</th><th class="num">Hossz</th><th class="num">Legalacsonyabb</th><th>Előtte</th><th>Kezelés</th><th class="num">Utána max.</th></tr></thead>
            <tbody>
              <tr v-for="e in hy.events" :key="e.start">
                <td>{{ e.date.slice(5).replace('-', '. ') }}. {{ e.time }}{{ e.night ? ' (éjjel)' : '' }}</td>
                <td class="num">{{ hypoDur(e.minutes) }}</td>
                <td class="num">{{ fmt(e.nadir) }}{{ e.level === 2 ? ' (2.)' : '' }}</td>
                <td>
                  {{ e.bolus ? `${fmt(e.bolus.v)} E, ${hypoDur(e.bolus.minutesBefore)} előtte` : '–' }}{{ e.iob != null && e.iob >= 0.1 ? ` · aktív ${fmt(e.iob)} E` : '' }}{{ e.notes.length ? ` · ${e.notes.map(noteTagLabel).join(', ')}` : '' }}
                </td>
                <td>{{ e.treatment ? `${fmt(e.treatment.carbs, 0)} g${e.treatment.fast ? ' (gyors)' : ''}` : '–' }}</td>
                <td class="num">{{ e.rebound ? fmt(e.rebound.v) : '–' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>

      <section class="report-section">
        <h2>Étkezések napszakonként</h2>
        <table class="table report-table">
          <thead>
            <tr>
              <th>Napszak</th><th class="num">Étkezés</th><th class="num">Emelkedés</th><th class="num">Csúcs</th>
              <th class="num">2 óra</th><th class="num">4 óra</th><th class="num">Előbólus</th><th class="num">Rendben</th><th class="num">Zsíros</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sg in an.segments" :key="sg.index">
              <td>{{ an.therapySet ? `${sg.start}–${sg.end}` : 'Egész nap' }}</td>
              <td class="num">{{ sg.counts.meals }}</td>
              <td class="num">{{ sg.meals ? fmt(sg.meals.rise, 1, true) : '–' }}</td>
              <td class="num">{{ sg.meals ? `${fmt(sg.meals.peakMin, 0)} p` : '–' }}</td>
              <td class="num">{{ sg.meals ? fmt(sg.meals.d2h, 1, true) : '–' }}</td>
              <td class="num">{{ sg.meals ? fmt(sg.meals.d4h, 1, true) : '–' }}</td>
              <td class="num">{{ sg.meals ? preBolus(sg.meals.preBolus) : '–' }}</td>
              <td class="num">{{ sg.meals ? `${okPct(sg.meals.ratings) ?? '–'}%` : '–' }}</td>
              <td class="num">{{ sg.fatty ? `${sg.fatty.n} (6 ó: ${fmt(sg.fatty.d6h, 1, true)})` : '–' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted small">Eltérés a kezdő értékhez képest, mmol/L, mediánok. Rendben: a csúcs a céltartomány alatt maradt, és 4 óra múlva ±2 mmol/L-en belül visszaállt.</p>
      </section>

      <section class="report-section">
        <h2>Bázisellenőrzés</h2>
        <table class="table report-table">
          <thead><tr><th>Időszak</th><th class="num">Változás (mmol/L/óra)</th><th class="num">Adat</th><th>Értékelés</th></tr></thead>
          <tbody>
            <tr v-for="bl in an.basal.blocks" :key="bl.label">
              <td>{{ bl.label }} ({{ String(bl.from).padStart(2, '0') }}–{{ String(bl.to % 24).padStart(2, '0') }})</td>
              <td class="num">{{ fmt(bl.hours >= 1 ? bl.slope : null, 2, true) }}</td>
              <td class="num">{{ fmt(bl.hours, 0) }} óra, {{ bl.days }} nap</td>
              <td>{{ basalState(bl) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted small">Étel, ható bólus és hipó nélküli időszakokban; stabil: ±0,3 mmol/L óránként.</p>
      </section>

      <section v-if="an.therapySet" class="report-section">
        <h2>Becslés a mért adatokból</h2>
        <table class="table report-table">
          <thead>
            <tr>
              <th>Napszak</th><th class="num">Tiszta korr. / étk.</th>
              <th class="num">ISF most → becsült</th><th class="num">CH-arány most → becsült</th><th class="num">Hatásidő most → becsült</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sg in an.segments" :key="sg.index">
              <td>{{ sg.start }}–{{ sg.end }}</td>
              <td class="num">{{ sg.counts.cleanCorrections }} / {{ sg.counts.cleanMeals }}</td>
              <td class="num">{{ fmt(sg.therapy?.isf) }} → {{ sg.estimate.isf ? fmt(sg.estimate.isf.value) : '?' }}<template v-if="sg.estimate.isf?.unreliable"> <small>(nem megbízható)</small></template></td>
              <td class="num">{{ fmt(sg.therapy?.icr) }} → {{ sg.estimate.icr ? fmt(sg.estimate.icr.value) : '?' }}<template v-if="sg.estimate.icr?.unreliable"> <small>(még emelkedik)</small></template></td>
              <td class="num">{{ sg.therapy ? actionLabel(sg.therapy.actionMinutes) : '–' }} → {{ sg.estimate.action ? actionLabel(sg.estimate.action.dia) : '?' }}<template v-if="sg.estimate.action?.unreliable"> <small>(nem megbízható)</small></template></td>
            </tr>
          </tbody>
        </table>
        <p class="muted small">Tájékoztató becslés (legalább 3 tiszta eseményből); a terápia módosítása a kezelőorvossal egyeztetendő.</p>
      </section>

      <section class="report-section report-days">
        <h2>Napi részletek</h2>
        <article v-for="d in rep.dayList" :key="d.date" class="report-day">
          <header>
            <b>{{ d.label }} {{ d.weekday }}</b>
            <span class="muted small">
              átlag {{ fmt(d.stats.n ? d.stats.avg : null) }} · TIR {{ fmt(d.stats.n ? d.stats.pct.inRange : null, 0) }}% ·
              TBR {{ fmt(d.stats.n ? d.stats.pct.low + d.stats.pct.veryLow : null, 0) }}% · CV {{ fmt(d.stats.n ? d.stats.cv : null, 0) }}% ·
              inzulin {{ fmt(d.totals.meal + d.totals.correction + d.totals.basal) }} E
              ({{ fmt(d.totals.meal) }} / {{ fmt(d.totals.correction) }} / {{ fmt(d.totals.basal) }}{{ d.totals.basalAssumed ? '*' : '' }}) ·
              CH {{ fmt(d.totals.carbs, 0) }} g · szenzor {{ d.coverage }}%
            </span>
          </header>
          <ReportDayChart :glucose="d.glucose" :events="d.events" :low="rep.range.low" :high="rep.range.high" />
          <table v-if="d.events.length || d.notes.length" class="table report-events">
            <tbody>
              <tr v-for="(e, i) in rowsOf(d)" :key="i" :class="{ 'report-note': e.type === 'note' }">
                <td class="num">{{ e.time }}</td>
                <td v-if="e.type === 'note'" colspan="3"><i class="dot dot-note" />Jegyzet: <b>{{ e.tags.map(noteTagLabel).join(', ') }}</b> {{ e.text }}</td>
                <template v-else>
                  <td>
                    <i class="dot" :class="e.type === 'carbs' ? 'dot-carbs' : e.kind === 'basal' ? 'dot-basal' : e.kind === 'correction' ? 'dot-correction' : 'dot-insulin'" />
                    {{ e.type === 'carbs' ? (e.fatty ? 'Szénhidrát (zsíros / fehérjedús)' : e.fast ? 'Szénhidrát (gyors)' : 'Szénhidrát') : KIND_LABEL[e.kind] }}
                  </td>
                  <td class="num">{{ e.type === 'carbs' ? `${fmt(e.v, 0)} g` : `${fmt(e.v)} E` }}</td>
                  <td class="num">{{ e.glucose != null ? `${fmt(e.glucose)} mmol/L` : '' }}</td>
                </template>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">Nincs bejegyzés.</p>
        </article>
      </section>

      <ReportMethods :low="rep.range.low" :high="rep.range.high" />

      <p class="muted small report-foot">
        Saját nyilvántartás (Cukornapló), nem orvostechnikai eszköz. Szenzoradat: Medtronic CareLink; inzulin és szénhidrát: kézi könyvelés és InPen (Apple Egészség).
        A becslések és értékelések tájékoztató jellegűek.
      </p>
    </template>
  </main>
</template>
