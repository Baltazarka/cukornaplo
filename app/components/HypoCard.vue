<script setup lang="ts">
// Hipók az időszakban: események száma, súlyossága, napszakos eloszlása, és eseményenként, hogy mi
// előzte meg (bólus, aktív inzulin, sport / alkohol), mivel kezelted, és mennyire ugrott fel utána.
const props = defineProps<{ end: string; days: number }>()
const { data } = await useFetch<any>('/api/hypo', {
  query: computed(() => ({ end: props.end, days: props.days })),
  key: computed(() => `hypo-${props.end}-${props.days}`),
})
const s = computed(() => data.value?.summary)

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const dur = (min: number) => (min < 60 ? `${min} perc` : `${Math.floor(min / 60)} ó ${min % 60} p`)
const KIND: Record<string, string> = { meal: 'étkezési bólus', correction: 'korrekció' }

// Napszakos eloszlás: 24 oszlop az esemény kezdete szerint.
const H = 60
const maxN = computed(() => Math.max(1, ...(s.value?.byHour ?? [0])))
const hover = ref<number | null>(null)

// Rövid megfigyelések az összesítésből (csak ha legalább 2 esemény van).
const insights = computed(() => {
  const v = s.value
  if (!v || v.n < 2) return []
  const out: string[] = []
  const pct = (k: number) => Math.round((100 * k) / v.n)
  if (v.afterBolus / v.n >= 0.5) out.push(`A hipók ${pct(v.afterBolus)}%-a bólus utáni 4 órában kezdődött.`)
  if (v.night / v.n >= 0.3) out.push(`${v.night} éjszakai (0–6 óra) esemény: ezt érdemes a bázis szempontjából is átnézni.`)
  if (v.withSport) out.push(`${v.withSport} esemény előtt 6 órán belül sport-jegyzet volt.`)
  if (v.withAlcohol) out.push(`${v.withAlcohol} esemény előtt alkohol-jegyzet volt.`)
  if (v.overTreated / v.n >= 0.3) out.push(`${v.overTreated} esetben a vércukor utána a céltartomány fölé ugrott: lehet, hogy több CH-t ettél a kelleténél.`)
  const peak = v.byHour.indexOf(Math.max(...v.byHour))
  if (v.byHour[peak] >= 2 && v.byHour[peak] / v.n >= 0.3) out.push(`A leggyakoribb kezdés ${String(peak).padStart(2, '0')}–${String(peak + 1).padStart(2, '0')} óra között.`)
  return out
})
</script>

<template>
  <section v-if="data" class="card hypo-card">
    <div class="card-head">
      <h2>Hipók</h2>
      <span class="muted small">legalább 15 percig {{ fmt(data.low) }} mmol/L alatt · 2. szint: {{ fmt(data.veryLow) }} alatt</span>
    </div>

    <p v-if="!s.n" class="muted">Ebben az időszakban nem volt hipó.</p>
    <template v-else>
      <div class="hypo-facts">
        <div class="tile"><div class="tile-label">Események</div><div class="tile-value">{{ s.n }}</div><div class="tile-sub">hetente {{ fmt(s.perWeek) }}</div></div>
        <div class="tile"><div class="tile-label">2. szint<sub>&lt; {{ fmt(data.veryLow) }}</sub></div><div class="tile-value">{{ s.level2 }}</div><div class="tile-sub">legalacsonyabb {{ fmt(s.lowest) }} mmol/L</div></div>
        <div class="tile"><div class="tile-label">Éjszakai<sub>0–6 óra</sub></div><div class="tile-value">{{ s.night }}</div></div>
        <div class="tile"><div class="tile-label">Átlagos hossz</div><div class="tile-value">{{ s.avgMinutes }} <small>perc</small></div><div class="tile-sub">összesen {{ dur(s.totalMinutes) }}</div></div>
      </div>

      <div class="basal-bars">
        <div class="ic-readout" aria-live="polite">
          <template v-if="hover != null">
            <b>{{ String(hover).padStart(2, '0') }}:00–{{ String(hover + 1).padStart(2, '0') }}:00</b> · {{ s.byHour[hover] }} esemény kezdődött
          </template>
          <template v-else>Mikor kezdődtek: óránként az események száma.</template>
        </div>
        <svg :viewBox="`0 0 240 ${H}`" preserveAspectRatio="none" class="hypo-svg" role="img" aria-label="A hipók kezdete a nap órái szerint">
          <line x1="0" x2="240" :y1="H" :y2="H" class="basal-zero" />
          <g v-for="(n, h) in s.byHour" :key="h" @pointerenter="hover = h" @pointerleave="hover = null">
            <rect :x="h * 10" y="0" width="10" :height="H" fill="transparent" />
            <rect v-if="n" :x="h * 10 + 2" width="6" :y="H - (H - 4) * (n / maxN)" :height="(H - 4) * (n / maxN)" rx="1" class="hypo-bar" />
          </g>
        </svg>
        <div class="basal-axis"><span v-for="h in [0, 4, 8, 12, 16, 20, 24]" :key="h" :style="{ left: `${(h / 24) * 100}%` }">{{ String(h).padStart(2, '0') }}</span></div>
      </div>

      <ul v-if="insights.length" class="hypo-insights">
        <li v-for="i in insights" :key="i">{{ i }}</li>
      </ul>

      <div class="table-wrap">
        <table class="table hypo-table">
          <thead>
            <tr>
              <th>Mikor</th><th class="num">Hossz</th><th class="num">Legalacsonyabb</th><th>Előtte</th><th>Kezelés</th><th>Utána</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in data.events" :key="e.start">
              <td>
                {{ e.date.slice(5).replace('-', '. ') }}. <span class="muted">{{ e.weekday.slice(0, 3) }}</span> {{ e.time }}
                <span v-if="e.night" class="note-chip">éjjel</span>
                <span v-if="e.ongoing" class="note-chip">most tart</span>
              </td>
              <td class="num">{{ dur(e.minutes) }}</td>
              <td class="num"><span :class="{ 'hypo-l2': e.level === 2 }">{{ fmt(e.nadir) }}</span><span v-if="e.level === 2" class="hypo-l2-tag">2. szint</span></td>
              <td class="small">
                <template v-if="e.bolus">{{ fmt(e.bolus.v) }} E {{ KIND[e.bolus.kind] ?? 'bólus' }}, {{ dur(e.bolus.minutesBefore) }} előtte</template>
                <template v-else><span class="muted">nem volt bólus 4 órán belül</span></template>
                <template v-if="e.iob != null && e.iob >= 0.1"> · aktív {{ fmt(e.iob) }} E</template>
                <div v-if="e.notes.length || e.noteText" class="muted">
                  <span v-for="tg in e.notes" :key="tg" class="note-chip">{{ noteTagLabel(tg) }}</span>{{ e.noteText }}
                </div>
              </td>
              <td class="small">
                <template v-if="e.treatment">{{ fmt(e.treatment.carbs, 0) }} g CH<template v-if="e.treatment.fast"> (gyors)</template></template>
                <span v-else class="muted">nincs CH a naplóban</span>
              </td>
              <td class="small">
                <template v-if="e.rebound">
                  max. <span :class="{ 'hypo-over': e.rebound.over }">{{ fmt(e.rebound.v) }}</span>, {{ dur(e.rebound.minutesAfter) }} múlva
                </template>
                <span v-else class="muted">–</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <p class="muted small">
      Előzmény: a hipó előtti 4 órában beadott utolsó gyors hatású adag és a kezdetkor még aktív inzulin; a jegyzetek 6 órán belülről.
      Kezelés: a kezdet előtt / a vége után 15 percen belül beírt szénhidrát. Utána: a legmagasabb érték a következő 2 órában
      (kiemelve, ha a céltartomány fölé ment).
    </p>
  </section>
</template>
