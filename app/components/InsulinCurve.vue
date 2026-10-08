<script setup lang="ts">
// Gyors hatású inzulin hatásgörbéje az exponenciális modellből: a hatás erőssége (a csúcshoz
// viszonyítva) és a még aktív inzulin (IOB) aránya az injekció óta eltelt idő függvényében.
const props = defineProps<{ peakMinutes: number; durationMinutes: number; height?: number }>()

const el = ref<HTMLElement | null>(null)
const width = ref(280)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(160, Math.round(e.contentRect.width))))
  ro.observe(el.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const H = computed(() => props.height ?? 120)
const PAD = { l: 34, r: 8, t: 8, b: 20 }
const model = computed(() => insulinModel(props.peakMinutes, props.durationMinutes))
const peakAct = computed(() => model.value.activity(model.value.peak))

const sx = (t: number) => PAD.l + (t / props.durationMinutes) * (width.value - PAD.l - PAD.r)
const sy = (f: number) => PAD.t + (1 - f) * (H.value - PAD.t - PAD.b)

const STEP = 5
const samples = computed(() => {
  const out: { t: number; act: number; iob: number }[] = []
  for (let t = 0; t <= props.durationMinutes; t += STEP) {
    out.push({ t, act: model.value.activity(t) / peakAct.value, iob: model.value.iob(t) })
  }
  if (out.at(-1)!.t !== props.durationMinutes) out.push({ t: props.durationMinutes, act: 0, iob: 0 })
  return out
})
const actPath = computed(() => samples.value.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.act).toFixed(1)}`).join(''))
const actArea = computed(() => `${actPath.value}L${sx(props.durationMinutes)},${sy(0)}L${sx(0)},${sy(0)}Z`)
const iobPath = computed(() => samples.value.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.iob).toFixed(1)}`).join(''))
const hourTicks = computed(() => Array.from({ length: Math.floor(props.durationMinutes / 60) + 1 }, (_, h) => h * 60))

// Rámutatáskor a legközelebbi 5 perces pont értékei.
const hover = ref<{ t: number; act: number; iob: number } | null>(null)
function onMove(ev: PointerEvent) {
  const box = (ev.currentTarget as SVGElement).getBoundingClientRect()
  const x = ev.clientX - box.left
  const t = ((x - PAD.l) / (width.value - PAD.l - PAD.r)) * props.durationMinutes
  if (t < 0 || t > props.durationMinutes) return (hover.value = null)
  const i = Math.round(t / STEP)
  hover.value = samples.value[Math.min(samples.value.length - 1, i)]
}
const pct = (f: number) => `${Math.round(f * 100)}%`
</script>

<template>
  <div ref="el" class="insulin-curve">
    <div class="ic-readout" aria-live="polite">
      <template v-if="hover"><b>{{ actionLabel(hover.t) || '0 p' }}</b> · hatás {{ pct(hover.act) }} · még aktív {{ pct(hover.iob) }}</template>
      <template v-else>Csúcs <b>{{ actionLabel(Math.round(model.peak)) }}</b> · teljes hatásidő <b>{{ actionLabel(durationMinutes) }}</b></template>
    </div>
    <svg
      :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" role="img"
      :aria-label="`Inzulinhatás-görbe: csúcs ${actionLabel(Math.round(model.peak))}, hatásidő ${actionLabel(durationMinutes)}`"
      @pointermove="onMove" @pointerleave="hover = null"
    >
      <g class="ic-grid">
        <line v-for="f in [0, 0.5, 1]" :key="f" :x1="PAD.l" :x2="width - PAD.r" :y1="sy(f)" :y2="sy(f)" />
      </g>
      <g class="ic-axis">
        <text v-for="f in [0, 0.5, 1]" :key="f" :x="PAD.l - 6" :y="sy(f) + 4" text-anchor="end">{{ pct(f) }}</text>
        <text v-for="m in hourTicks" :key="m" :x="sx(m)" :y="H - 4" text-anchor="middle">{{ m / 60 }} ó</text>
      </g>
      <path :d="actArea" class="ic-area" />
      <path :d="actPath" class="ic-line" />
      <path :d="iobPath" class="ic-iob" />
      <line :x1="sx(model.peak)" :x2="sx(model.peak)" :y1="sy(1)" :y2="sy(0)" class="ic-peak" />
      <template v-if="hover">
        <line :x1="sx(hover.t)" :x2="sx(hover.t)" :y1="sy(1)" :y2="sy(0)" class="ic-cursor" />
        <circle :cx="sx(hover.t)" :cy="sy(hover.act)" r="4" class="ic-dot" />
        <circle :cx="sx(hover.t)" :cy="sy(hover.iob)" r="4" class="ic-dot iob" />
      </template>
    </svg>
    <div class="chart-legend ic-legend">
      <span class="k"><span class="sw" style="background: var(--series-insulin)" /> hatás erőssége</span>
      <span class="k"><span class="sw dashed" style="border-top-color: var(--text-secondary)" /> még aktív inzulin</span>
    </div>
    <p v-if="model.clamped" class="muted small">A rövid hatásidő miatt a csúcsot {{ actionLabel(Math.round(model.peak)) }}-re vettem.</p>
  </div>
</template>
