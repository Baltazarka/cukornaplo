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
      <div class="tile-sub">&lt; {{ fmt(range.low) }} mmol/L</div>
    </div>
    <div class="tile">
      <div class="tile-label">{{ perDay ? 'Inzulin naponta' : 'Összes inzulin' }}</div>
      <div class="tile-value">{{ fmt(insulin.total) }} <small>E</small></div>
      <div class="tile-sub tile-split">
        <span title="étkezési bólus"><i class="dot dot-insulin" />bólus {{ fmt(insulin.meal) }}</span>
        <span><i class="dot dot-correction" />korrekció {{ fmt(insulin.correction) }}</span>
        <span><i class="dot dot-basal" />bázis {{ fmt(insulin.basal) }}</span>
      </div>
    </div>
    <div class="tile">
      <div class="tile-label">{{ perDay ? 'Szénhidrát naponta' : 'Összes szénhidrát' }}</div>
      <div class="tile-value">{{ fmt(carbs, 0) }} <small>g</small></div>
    </div>
  </section>
</template>
