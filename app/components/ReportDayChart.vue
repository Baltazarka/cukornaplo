<script setup lang="ts">
// Nyomtatható napi grafikon (SVG, vektoros): glükózgörbe a céltartománnyal, alatta az
// inzulinadagok (típus szerinti színnel) és a szénhidrátok felirattal, közös 0–24 órás tengelyen.
const props = defineProps<{
  glucose: [number, number][]
  events: { minute: number; type: string; kind: string | null; v: number; fatty: boolean; fast?: boolean }[]
  low: number
  high: number
}>()

const W = 720
const L = 30
const R = 8
const TOP = 6
const PLOT_H = 104
const INS_Y = 128
const CH_Y = 162
const H = 186
const sx = (m: number) => L + (m / 1440) * (W - L - R)
const yMax = computed(() => Math.max(16, Math.ceil(Math.max(0, ...props.glucose.map((g) => g[1])) / 2) * 2))
const Y_MIN = 2
const sy = (v: number) => TOP + (1 - (Math.min(yMax.value, Math.max(Y_MIN, v)) - Y_MIN) / (yMax.value - Y_MIN)) * PLOT_H
const yTicks = computed(() => {
  const out: number[] = []
  for (let v = 4; v <= yMax.value; v += yMax.value > 18 ? 4 : 2) out.push(v)
  return out
})

/** Glükózvonal; 15 percnél hosszabb kimaradásnál megszakad. */
const path = computed(() => {
  let d = ''
  let prev: number | null = null
  for (const [m, v] of props.glucose) {
    d += `${prev == null || m - prev > 15 ? 'M' : 'L'}${sx(m).toFixed(1)},${sy(v).toFixed(1)}`
    prev = m
  }
  return d
})

const KIND_COLOR: Record<string, string> = {
  meal: 'var(--series-insulin)', 'meal-nocarb': 'var(--series-insulin)',
  correction: 'var(--series-correction)', basal: 'var(--series-basal)',
}
const num = (v: number, dec: number) => v.toLocaleString('hu-HU', { maximumFractionDigits: dec })
/**
 * Jelölők és feliratok elhelyezése, hogy ne csússzanak össze: az egymást takaró jelölőket kicsit
 * széthúzza; a felirat a jelölő fölé kerül, ha ott van hely, különben alá, végső esetben jobbra tolva.
 */
const GAP = 22
/** A CH-feliratoknál nagyobb köz kell, mert a zsíros / gyors ikon (🧀 / ⚡) is a szám mellé kerül. */
const CARB_GAP = 30
function placed(list: typeof props.events, gap = GAP) {
  let lastMark = -Infinity
  let lastAbove = -Infinity
  let lastBelow = -Infinity
  return list.map((e) => {
    const x = Math.max(sx(e.minute), lastMark + 6)
    lastMark = x
    let lx = x
    let above = true
    if (x - lastAbove >= gap) lastAbove = x
    else if (x - lastBelow >= gap) { above = false; lastBelow = x }
    else { lx = lastAbove + gap; lastAbove = lx }
    return { ...e, x, lx, above }
  })
}
const insulin = computed(() => placed(props.events.filter((e) => e.type === 'insulin')))
const carbs = computed(() => placed(props.events.filter((e) => e.type === 'carbs'), CARB_GAP))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="report-day-chart" role="img" aria-label="Napi glükózgörbe az inzulin- és szénhidrát-bejegyzésekkel">
    <rect :x="L" :y="sy(high)" :width="W - L - R" :height="sy(low) - sy(high)" class="rd-band" />
    <g class="rd-grid">
      <line v-for="v in yTicks" :key="'y' + v" :x1="L" :x2="W - R" :y1="sy(v)" :y2="sy(v)" />
      <line v-for="h in [0, 3, 6, 9, 12, 15, 18, 21, 24]" :key="'x' + h" :x1="sx(h * 60)" :x2="sx(h * 60)" :y1="TOP" :y2="CH_Y + 4" />
    </g>
    <line :x1="L" :x2="W - R" :y1="sy(low)" :y2="sy(low)" class="rd-range" />
    <line :x1="L" :x2="W - R" :y1="sy(high)" :y2="sy(high)" class="rd-range" />
    <g class="rd-axis">
      <text v-for="v in yTicks" :key="'yl' + v" :x="L - 4" :y="sy(v) + 3" text-anchor="end">{{ v }}</text>
      <text v-for="h in [0, 3, 6, 9, 12, 15, 18, 21, 24]" :key="'xl' + h" :x="sx(h * 60)" :y="H - 2" text-anchor="middle">{{ String(h).padStart(2, '0') }}</text>
      <text :x="L - 4" :y="INS_Y + 3" text-anchor="end">E</text>
      <text :x="L - 4" :y="CH_Y + 3" text-anchor="end">g</text>
    </g>
    <path :d="path" class="rd-glucose" />
    <g v-for="(e, i) in insulin" :key="'i' + i">
      <rect :x="e.x - 2" :y="INS_Y - 6" width="4" height="10" rx="1" :style="{ fill: KIND_COLOR[e.kind ?? 'meal'] }" />
      <text :x="e.lx" :y="e.above ? INS_Y - 9 : INS_Y + 14" text-anchor="middle" class="rd-label">{{ num(e.v, 1) }}</text>
    </g>
    <g v-for="(e, i) in carbs" :key="'c' + i">
      <rect :x="e.x - 2" :y="CH_Y - 6" width="4" height="10" rx="1" class="rd-carb" :class="{ fatty: e.fatty }" />
      <text :x="e.lx" :y="e.above ? CH_Y - 9 : CH_Y + 14" text-anchor="middle" class="rd-label">{{ num(e.v, 0) }}{{ e.fatty ? ` ${CARB_TAG_ICON.fatty}` : e.fast ? ` ${CARB_TAG_ICON.fast}` : '' }}</text>
    </g>
  </svg>
</template>
