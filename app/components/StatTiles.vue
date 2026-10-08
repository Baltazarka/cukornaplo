<script setup lang="ts">
// Összesítő csempék a napi és az időszakos nézethez: glükóz-mutatók (átlag, SD, CV, TIR / TAR / TBR,
// változásban töltött idő), inzulin bólus–bázis bontásban, szénhidrát, szenzorlefedettség.
const props = defineProps<{
  stats: any
  change: { slow: number; moderate: number; rapid: number; any: number } | null
  range: { low: number; high: number }
  insulin: { total: number; meal: number; correction: number; basal: number }
  carbs: number
  coverage: number
  /** Hipóesemények (≥ 15 perc a céltartomány alatt) száma, ebből 2. szint. */
  hypos?: { n: number; level2: number } | null
  /** Időszakos nézetben „naponta” értendő az inzulin és a CH. */
  perDay?: boolean
}>()

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const s = computed(() => props.stats)
const tar = computed(() => (s.value.n ? s.value.pct.high + s.value.pct.veryHigh : null))
const tbr = computed(() => (s.value.n ? s.value.pct.low + s.value.pct.veryLow : null))
// Nemzetközi konszenzus (Battelino 2019): CV ≤ 36% stabil glükózszint.
const CV_LIMIT = 36

// Inzulin-megoszlás (TDD): kis fánkdiagram a csempe jobb felső sarkában. A kör kerülete 100, így a
// dasharray közvetlenül százalék; a szeletek között 2 egységnyi rés.
const INSULIN_PARTS = [
  { key: 'meal', label: 'bólus', cls: 'insulin' },
  { key: 'correction', label: 'korrekció', cls: 'correction' },
  { key: 'basal', label: 'bázis', cls: 'basal' },
] as const
const insulinPct = computed(() =>
  INSULIN_PARTS.map((p) => ({ ...p, v: props.insulin[p.key], pct: props.insulin.total > 0 ? (props.insulin[p.key] / props.insulin.total) * 100 : 0 })),
)
const donut = computed(() => {
  const parts = insulinPct.value.filter((p) => p.pct > 0)
  const gap = parts.length > 1 ? 2 : 0
  let at = 0
  return parts.map((p) => {
    const seg = { ...p, dash: `${Math.max(p.pct - gap, 0.5)} ${100 - Math.max(p.pct - gap, 0.5)}`, offset: 25 - at }
    at += p.pct
    return seg
  })
})
</script>

<template>
  <section class="tiles">
    <div class="tile"><div class="tile-label">Átlag glükóz</div><div class="tile-value">{{ fmt(s.avg) }} <small>mmol/L</small></div></div>
    <div class="tile">
      <div class="tile-label">Szórás<sub>SD</sub></div>
      <div class="tile-value">{{ fmt(s.n ? s.sd : null) }} <small>mmol/L</small></div>
    </div>
    <div class="tile">
      <div class="tile-label">Variációs koefficiens<sub>CV</sub></div>
      <div class="tile-value">{{ fmt(s.n ? s.cv : null, 0) }} <small>%</small></div>
      <div v-if="s.n" class="tile-sub">{{ s.cv <= CV_LIMIT ? 'stabil' : 'ingadozó' }} (cél ≤ {{ CV_LIMIT }}%)</div>
    </div>
    <div class="tile">
      <div class="tile-label">Változásban<sub>≥ 0,06/p</sub></div>
      <div class="tile-value">{{ fmt(change?.any, 0) }} <small>% az időnek</small></div>
      <div v-if="change" class="tile-sub tile-arrows">
        <span title="lassú változás, ≥ 0,06 mmol/L/perc"><TrendArrows :dir="1" :level="1" />{{ fmt(change.slow, 0) }}%</span>
        <span title="közepes változás, ≥ 0,11 mmol/L/perc"><TrendArrows :dir="1" :level="2" />{{ fmt(change.moderate, 0) }}%</span>
        <span title="gyors változás, ≥ 0,17 mmol/L/perc"><TrendArrows :dir="1" :level="3" />{{ fmt(change.rapid, 0) }}%</span>
      </div>
    </div>
    <div class="tile"><div class="tile-label">Szenzoradat</div><div class="tile-value">{{ fmt(coverage, 0) }} <small>%</small></div></div>
    <div class="tile">
      <div class="tile-label">Céltartományban<sub>TIR</sub></div>
      <div class="tile-value">{{ fmt(s.n ? s.pct.inRange : null, 0) }} <small>%</small></div>
      <div class="tile-sub">{{ fmt(range.low) }}–{{ fmt(range.high) }} mmol/L</div>
    </div>
    <div class="tile">
      <div class="tile-label">Magas<sub>TAR</sub></div>
      <div class="tile-value">{{ fmt(tar, 0) }} <small>%</small></div>
      <div class="tile-sub">&gt; {{ fmt(range.high) }} mmol/L</div>
    </div>
    <div class="tile">
      <div class="tile-label">Alacsony<sub>TBR</sub></div>
      <div class="tile-value">{{ fmt(tbr, 0) }} <small>%</small></div>
      <div class="tile-sub">&lt; {{ fmt(range.low) }} mmol/L<template v-if="hypos?.n"> · <b class="err-text">{{ hypos.n }} hipó</b><template v-if="hypos.level2">, {{ hypos.level2 }}× 3,0 alatt</template></template></div>
    </div>
    <div class="tile tile-insulin">
      <div class="tile-label">{{ perDay ? 'Inzulin naponta' : 'Összes inzulin' }}<sub title="Total Daily Dose: napi teljes inzulinmennyiség">TDD</sub></div>
      <div class="tile-value">{{ fmt(insulin.total) }} <small>E</small></div>
      <svg v-if="donut.length" class="tile-donut" viewBox="0 0 42 42" role="img" :aria-label="insulinPct.map((p) => `${p.label} ${fmt(p.pct, 0)}%`).join(', ')">
        <circle
          v-for="p in donut" :key="p.key" :class="`donut-${p.cls}`" cx="21" cy="21" r="15.9155" fill="none" stroke-width="7"
          :stroke-dasharray="p.dash" :stroke-dashoffset="p.offset"
        ><title>{{ p.label }}: {{ fmt(p.pct, 0) }}% ({{ fmt(p.v) }} E)</title></circle>
      </svg>
      <div class="tile-sub tile-split">
        <span v-for="p in insulinPct" :key="p.key" :title="`${p.label}: ${fmt(p.v)} E`"><i class="dot" :class="`dot-${p.cls}`" />{{ p.label }} {{ fmt(p.pct, 0) }}%</span>
      </div>
    </div>
    <div class="tile">
      <div class="tile-label">{{ perDay ? 'Szénhidrát naponta' : 'Összes szénhidrát' }}</div>
      <div class="tile-value">{{ fmt(carbs, 0) }} <small>g</small></div>
    </div>
  </section>
</template>
