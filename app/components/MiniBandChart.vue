<script setup lang="ts">
// Kis SVG-grafikon sávokkal és vonalakkal (étkezés utáni görbék, mért hatásgörbe).
// Rámutatáskor a vonalak értékeit írja ki a grafikon fölé.
interface Line { y: (number | null)[]; color: string; label: string; dash?: boolean; width?: number }
interface Band { lo: (number | null)[]; hi: (number | null)[]; color: string }
const props = defineProps<{
  x: number[]
  lines: Line[]
  bands?: Band[]
  xTicks: number[]
  xFormat: (v: number) => string
  yTicks: number[]
  yFormat: (v: number) => string
  /** Vízszintes (y) és függőleges (x) segédvonalak. */
  refY?: number[]
  refX?: number[]
  height?: number
  /** Alapfelirat, amikor nincs rámutatás. */
  caption?: string
}>()

const el = ref<HTMLElement | null>(null)
const width = ref(300)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(180, Math.round(e.contentRect.width))))
  ro.observe(el.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const H = computed(() => props.height ?? 150)
const PAD = { l: 36, r: 8, t: 6, b: 20 }
const xMin = computed(() => props.x[0])
const xMax = computed(() => props.x[props.x.length - 1])
const yMin = computed(() => props.yTicks[0])
const yMax = computed(() => props.yTicks[props.yTicks.length - 1])
const sx = (v: number) => PAD.l + ((v - xMin.value) / (xMax.value - xMin.value)) * (width.value - PAD.l - PAD.r)
const sy = (v: number) => PAD.t + (1 - (v - yMin.value) / (yMax.value - yMin.value)) * (H.value - PAD.t - PAD.b)
const clampY = (v: number) => Math.min(yMax.value, Math.max(yMin.value, v))

/** Vonal útvonala; a hiányzó pontoknál megszakad. */
function path(y: (number | null)[]): string {
  let d = ''
  let pen = false
  y.forEach((v, i) => {
    if (v == null) { pen = false; return }
    d += `${pen ? 'L' : 'M'}${sx(props.x[i]).toFixed(1)},${sy(clampY(v)).toFixed(1)}`
    pen = true
  })
  return d
}
/** Sáv útvonala (alsó és felső határ között), a hiányzó pontoknál megszakad. */
function bandPath(b: Band): string {
  const parts: string[] = []
  let seg: number[] = []
  const flush = () => {
    if (seg.length > 1) {
      const top = seg.map((i, k) => `${k ? 'L' : 'M'}${sx(props.x[i]).toFixed(1)},${sy(clampY(b.hi[i]!)).toFixed(1)}`).join('')
      const bot = [...seg].reverse().map((i) => `L${sx(props.x[i]).toFixed(1)},${sy(clampY(b.lo[i]!)).toFixed(1)}`).join('')
      parts.push(`${top}${bot}Z`)
    }
    seg = []
  }
  props.x.forEach((_, i) => (b.lo[i] != null && b.hi[i] != null ? seg.push(i) : flush()))
  flush()
  return parts.join('')
}

const hover = ref<number | null>(null)
function onMove(ev: PointerEvent) {
  const box = (ev.currentTarget as SVGElement).getBoundingClientRect()
  const v = xMin.value + ((ev.clientX - box.left - PAD.l) / (width.value - PAD.l - PAD.r)) * (xMax.value - xMin.value)
  if (v < xMin.value || v > xMax.value) return (hover.value = null)
  let best = 0
  props.x.forEach((xv, i) => { if (Math.abs(xv - v) < Math.abs(props.x[best] - v)) best = i })
  hover.value = best
}
</script>

<template>
  <div ref="el" class="mini-chart">
    <div class="ic-readout" aria-live="polite">
      <template v-if="hover != null">
        <b>{{ xFormat(x[hover]) }}</b>
        <template v-for="l in lines" :key="l.label">
          <span v-if="l.y[hover] != null"> · {{ l.label }} <b>{{ yFormat(l.y[hover]!) }}</b></span>
        </template>
      </template>
      <template v-else>{{ caption }}</template>
    </div>
    <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" role="img" :aria-label="caption" @pointermove="onMove" @pointerleave="hover = null">
      <g class="ic-grid">
        <line v-for="v in yTicks" :key="'y' + v" :x1="PAD.l" :x2="width - PAD.r" :y1="sy(v)" :y2="sy(v)" />
      </g>
      <g class="ic-axis">
        <text v-for="v in yTicks" :key="'yl' + v" :x="PAD.l - 6" :y="sy(v) + 4" text-anchor="end">{{ yFormat(v) }}</text>
        <text v-for="v in xTicks" :key="'xl' + v" :x="sx(v)" :y="H - 4" text-anchor="middle">{{ xFormat(v) }}</text>
      </g>
      <line v-for="v in refY ?? []" :key="'ry' + v" :x1="PAD.l" :x2="width - PAD.r" :y1="sy(v)" :y2="sy(v)" class="mc-ref" />
      <line v-for="v in refX ?? []" :key="'rx' + v" :x1="sx(v)" :x2="sx(v)" :y1="sy(yMax)" :y2="sy(yMin)" class="mc-ref" />
      <path v-for="(b, i) in bands ?? []" :key="'b' + i" :d="bandPath(b)" :style="{ fill: b.color }" />
      <path
        v-for="l in lines" :key="l.label" :d="path(l.y)" fill="none"
        :style="{ stroke: l.color, strokeWidth: l.width ?? 2, strokeDasharray: l.dash ? '5 4' : undefined }"
        stroke-linejoin="round" stroke-linecap="round"
      />
      <template v-if="hover != null">
        <line :x1="sx(x[hover])" :x2="sx(x[hover])" :y1="sy(yMax)" :y2="sy(yMin)" class="ic-cursor" />
        <template v-for="l in lines" :key="'d' + l.label">
          <circle v-if="l.y[hover] != null" :cx="sx(x[hover])" :cy="sy(clampY(l.y[hover]!))" r="3.5" :style="{ fill: l.color }" class="mc-dot" />
        </template>
      </template>
    </svg>
    <div class="chart-legend ic-legend">
      <span v-for="l in lines" :key="'k' + l.label" class="k">
        <span v-if="l.dash" class="sw dashed" :style="{ borderTopColor: l.color }" />
        <span v-else class="sw line" :style="{ background: l.color }" />
        {{ l.label }}
      </span>
      <slot name="legend" />
    </div>
  </div>
</template>
