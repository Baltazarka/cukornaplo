<script setup lang="ts">
// Három összehangolt grafikon közös időtengelyen: glükózgörbe (az időszakos AGP-grafikonnal
// azonos stílusban: céltartomány-vonalak, a görbe és a határok közti rész tartományonként
// kitöltve), inzulin (bólus/bázis) és szénhidrát oszlopok. A crosshair mindhárom panelt
// összeköti, a tooltip egyszerre mutatja az értékeket.
const props = defineProps<{ day: any }>()

const el = ref<HTMLElement | null>(null)
let chart: any = null
let echarts: any = null
let ro: ResizeObserver | null = null

const GRID_LEFT = 52
const GRID_RIGHT = 16
const BAR_WIDTH = 6
const INS_HEIGHT = 78
const IOB_LINE = 1.5

/** Kerek tengelymaximum két egyenlő osztással (pl. 6,5 → 10, 16 → 20, 23 → 30). */
function niceMax(v: number): number {
  const half = v / 2
  const pow = 10 ** Math.floor(Math.log10(half))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((x) => x >= half)!
  return step * 2
}

function hm(ms: number): string {
  return new Date(ms).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
}
function num(v: number, dec: number): string {
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/**
 * Egy bólus saját hatásgörbéje: a még aktív része E-ben, 5 percenként, az oszlop jobb szélétől
 * (`startMs`) a hatásidő végéig. `drop`: a vonal félvastagsága E-ben, hogy a vonal teteje pontosan
 * az oszlop tetejével essen egy magasságba.
 */
function doseCurve(model: ReturnType<typeof insulinModel>, dia: number, doseMs: number, dose: number, startMs: number, drop: number) {
  const pts: [number, number][] = []
  const endMs = doseMs + dia * 60000
  for (let t = startMs; t < endMs; t = t + 5 * 60000 - ((t - doseMs) % (5 * 60000))) {
    pts.push([t, Math.max(0, dose * model.iob((t - doseMs) / 60000) - drop)])
  }
  pts.push([endMs, 0])
  return pts
}

function buildOption() {
  const d = props.day
  const r = d.range
  const C = {
    text: cssToken('--text-secondary'),
    muted: cssToken('--text-muted'),
    grid: cssToken('--grid'),
    axis: cssToken('--axis'),
    primary: cssToken('--text-primary'),
    insulin: cssToken('--series-insulin'),
    basal: cssToken('--series-basal'),
    carbs: cssToken('--series-carbs'),
    low: cssToken('--status-critical'),
    tooltipBg: cssToken('--tooltip-bg'),
    border: cssToken('--border'),
  }

  // Glükóz: 15 percnél hosszabb szünetnél megszakad a görbe és a kitöltés is.
  const g: [number, number | null][] = []
  d.glucose.forEach((p: [number, number], i: number) => {
    if (i > 0 && p[0] - d.glucose[i - 1][0] > 15 * 60000) g.push([p[0] - 1, null])
    g.push([p[0], p[1]])
  })
  const gMax = d.glucose.reduce((m: number, p: [number, number]) => Math.max(m, p[1]), 0)

  // Kitöltés tartományonként, halmozott területként (alap + magasság):
  // a céltartomány fölött/benne a határtól a görbéig, alatta a görbétől az alsó határig.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const fills = rangeFills(r)
  const fillSeries = (Object.entries(fills) as [string, { lo: number; hi: number; color: any }][]).flatMap(([key, b], bi) => {
    const below = key === 'low' || key === 'veryLow'
    const base = g.map(([t, v]) => [t, v == null ? null : below ? clamp(v, b.lo, b.hi) : b.lo])
    const height = g.map(([t, v]) => [t, v == null ? null : below ? b.hi - clamp(v, b.lo, b.hi) : clamp(v, b.lo, b.hi) - b.lo])
    const common = { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: `fill${bi}`, symbol: 'none', silent: true,
      lineStyle: { width: 0 }, connectNulls: false, z: 2, tooltip: { show: false } }
    return [
      { ...common, data: base },
      { ...common, data: height, areaStyle: { color: b.color, opacity: 1 } },
    ]
  })

  // Oszlopok: ha egy bólus és egy bázis 5 percen belül esik, a kisebbiket egy oszlopnyival eltoljuk.
  const plotWidth = Math.max(200, (chart?.getWidth?.() ?? el.value?.clientWidth ?? 800) - GRID_LEFT - GRID_RIGHT)
  const msPerPx = (d.dayEndMs - d.dayStartMs) / plotWidth
  const shiftMs = (BAR_WIDTH + 2) * msPerPx
  // [oszlop helye, adag, eredeti időpont]: az eltolás csak a rajzot érinti.
  const bolus = d.insulin.filter((p: any[]) => p[2] !== 'basal').map((p: any[]) => [p[0], p[1], p[0]])
  const basal = d.insulin.filter((p: any[]) => p[2] === 'basal').map((p: any[]) => [p[0], p[1]])
  for (const b of basal) {
    const o = bolus.find((p: number[]) => Math.abs(p[0] - b[0]) <= 5 * 60000)
    if (!o) continue
    if (b[1] <= o[1]) b[0] = o[0] + shiftMs
    else o[0] = b[0] + shiftMs
  }
  const carbs = d.carbs.map((p: any[]) => [p[0], p[1]])
  // A bólusok még hatásban lévő inzulinja (a terápiás beállítások hatásidejével). Az oszlop helyén
  // megszakítjuk, és egy pixellel az oszlop alól indul: így nem lóg ki a teteje fölé, és nincs rés sem.
  // Minden bólus saját görbéje az oszlopa tetejéről indul, és mutatja, meddig hat még.
  // (Az összesített aktív inzulint a buborék írja ki.)
  const ai = d.activeInsulin
  const iobTotal: [number, number | null][] = ai?.points ?? []
  const insMax = niceMax(Math.max(1, ...d.insulin.map((p: any[]) => p[1]), ...iobTotal.map((p) => p[1] ?? 0)))
  const drop = (IOB_LINE / 2) * (insMax / INS_HEIGHT)
  const curves: [number, number][][] = []
  if (ai) {
    const model = insulinModel(ai.peakMinutes, ai.durationMinutes)
    const edgeMs = (BAR_WIDTH / 2 - 1) * msPerPx
    for (const [doseMs, dose] of ai.doses as [number, number][]) {
      const bar = bolus.find((p: number[]) => p[2] === doseMs)
      const startMs = bar ? bar[0] + edgeMs : doseMs
      curves.push(doseCurve(model, ai.durationMinutes, doseMs, dose, startMs, drop))
    }
  }

  const fmtTooltip = (params: any) => {
    const x = Array.isArray(params) ? params[0]?.axisValue : params.axisValue
    if (x == null) return ''
    let gNear: number | null = null
    let gDiff = Infinity
    for (const p of d.glucose) {
      const diff = Math.abs(p[0] - x)
      if (diff < gDiff) { gDiff = diff; gNear = p[1] }
    }
    const win = 6 * 60000
    const ins = d.insulin.filter((p: any[]) => Math.abs(p[0] - x) <= win)
    const ch = d.carbs.filter((p: any[]) => Math.abs(p[0] - x) <= win)
    let html = `<div style="font-weight:600;margin-bottom:4px">${hm(x)}</div>`
    if (gNear !== null && gDiff <= 10 * 60000) {
      const col = gNear < r.low ? C.low : C.primary
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>Glükóz <b>${num(gNear, 1)}</b> mmol/L</div>`
    }
    for (const p of ins) {
      const b = p[2] === 'basal'
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${b ? C.basal : C.insulin};margin-right:6px"></span>${b ? 'Bázis' : 'Bólus'} <b>${num(p[1], 2)}</b> E</div>`
    }
    if (iobTotal.length) {
      let best: number | null = null
      let bd = Infinity
      for (const p of iobTotal) {
        const diff = Math.abs(p[0] - x)
        if (diff < bd) { bd = diff; best = p[1] }
      }
      if (best) html += `<div><span style="display:inline-block;width:8px;height:2px;background:${C.insulin};margin:0 6px 3px 0"></span>Aktív inzulin <b>${num(best, 1)}</b> E</div>`
    }
    for (const p of ch) {
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C.carbs};margin-right:6px"></span>Szénhidrát <b>${num(p[1], 0)}</b> g</div>`
    }
    return html
  }

  const axisLabel = { color: C.muted, hideOverlap: true }
  const splitLine = { lineStyle: { color: C.grid } }
  const axisLine = { lineStyle: { color: C.axis } }
  // Mindhárom panel azonos bal margóval és időtengellyel → az időpontok pontosan egymás alá esnek.
  // (A rácsokon outerBoundsMode: 'none': az ECharts 6 különben panelenként eltérően szűkítene.)
  const xAxisFor = (gridIndex: number) => ({
    type: 'value' as const,
    gridIndex,
    containShape: false, // ECharts 6: különben az oszlopok miatt kitágítaná a tengelyt, és a panelek elcsúsznának
    min: d.dayStartMs,
    max: d.dayEndMs,
    interval: 2 * 3600000,
    axisLabel: { ...axisLabel, formatter: (v: number) => hm(v).slice(0, 2) },
    axisLine,
    axisTick: { show: true },
    splitLine: { show: true, lineStyle: { color: C.grid } },
  })
  const panelTitle = (name: string, unit: string, top: number) => ({
    text: `{a|${name}}  {b|${unit}}`,
    left: GRID_LEFT - 2,
    top,
    textStyle: { rich: { a: { color: C.primary, fontSize: 14, fontWeight: 600 }, b: { color: C.muted, fontSize: 12, fontWeight: 400 } } },
  })
  const bar = (name: string, idx: number, data: any[], color: string) => ({
    name, type: 'bar', xAxisIndex: idx, yAxisIndex: idx, data, barWidth: BAR_WIDTH, barGap: '-100%', silent: true, z: 3,
    itemStyle: { color, borderRadius: [1, 1, 0, 0] },
  })

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    title: [
      panelTitle('Glükóz', 'mmol/L', 4),
      panelTitle('Inzulin', 'E', 270),
      panelTitle('Szénhidrát', 'g', 398),
    ],
    grid: [
      { left: GRID_LEFT, right: GRID_RIGHT, top: 30, height: 208, outerBoundsMode: 'none' },
      { left: GRID_LEFT, right: GRID_RIGHT, top: 294, height: INS_HEIGHT, outerBoundsMode: 'none' },
      { left: GRID_LEFT, right: GRID_RIGHT, top: 422, height: 78, outerBoundsMode: 'none' },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: C.axis } },
    tooltip: {
      trigger: 'axis', backgroundColor: C.tooltipBg, borderColor: C.border, borderWidth: 1,
      textStyle: { color: C.text }, padding: 10, formatter: fmtTooltip, axisPointer: { type: 'line' },
    },
    xAxis: [xAxisFor(0), xAxisFor(1), xAxisFor(2)],
    yAxis: [
      { type: 'value', gridIndex: 0, min: 2, max: Math.max(16, Math.ceil(gMax + 1)), interval: 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 1, min: 0, max: insMax, interval: insMax / 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 2, min: 0, splitNumber: 2, axisLabel, splitLine, axisLine: { show: false } },
    ],
    series: [
      ...fillSeries,
      {
        name: 'Glükóz', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: g, z: 4,
        lineStyle: { width: 2, color: C.primary }, itemStyle: { color: C.primary },
        connectNulls: false,
        showSymbol: true,
        // Magányos (pl. bólus kalkulátoros) mérés pontként látszik.
        symbolSize: (_v: any, p: any) => {
          const i = p.dataIndex
          const prev = g[i - 1]
          const next = g[i + 1]
          const isolated = (!prev || prev[1] === null) && (!next || next[1] === null)
          return isolated && g[i][1] !== null ? 6 : 0
        },
        markLine: {
          silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: C.primary, width: 1.5, type: 'solid' },
          data: [{ yAxis: r.low }, { yAxis: r.high }],
        },
      },
      ...curves.map((data) => ({
        name: 'Aktív inzulin', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data, symbol: 'none', silent: true, z: 2,
        lineStyle: { width: IOB_LINE, color: C.insulin }, areaStyle: { color: rgba(C.insulin, 0.12) },
      })),
      bar('Bólus', 1, bolus.map((p: number[]) => [p[0], p[1]]), C.insulin),
      bar('Bázis', 1, basal, C.basal),
      bar('Szénhidrát', 2, carbs, C.carbs),
    ],
  }
}

async function render() {
  if (!el.value) return
  if (!echarts) echarts = await import('echarts')
  if (!chart) chart = echarts.init(el.value, null, { renderer: 'canvas', devicePixelRatio: Math.max(2, window.devicePixelRatio || 1) })
  chart.setOption(buildOption(), true)
}

onMounted(async () => {
  await render()
  // Átméretezéskor újraszámoljuk az oszlopok eltolását is (pixelben értendő).
  ro = new ResizeObserver(() => {
    chart?.resize()
    render()
  })
  ro.observe(el.value!)
})
watch(() => props.day, render)
onBeforeUnmount(() => {
  ro?.disconnect()
  chart?.dispose()
  chart = null
})

// Utolsó aktív vércukor (a nap legkésőbbi glükózértéke) – bal oldalon kiírva.
const last = computed(() => {
  const gl = props.day?.glucose
  if (!gl?.length) return null
  const p = gl[gl.length - 1]
  return { v: p[1], ms: p[0], low: p[1] < props.day.range.low, high: p[1] > props.day.range.high }
})
function lastHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
}
function f1(v: number): string {
  return v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
const rr = computed(() => props.day.range)
</script>

<template>
  <div>
    <div v-if="last" class="last-reading" :class="{ low: last.low, high: last.high }">
      <span class="lr-label">Utolsó aktív vércukor</span>
      <span class="lr-value">{{ f1(last.v) }} <small>mmol/L</small></span>
      <span class="lr-time">{{ lastHm(last.ms) }}</span>
    </div>
    <div class="chart-legend">
      <span class="k"><span class="sw line" style="background: var(--text-primary)" /> céltartomány / glükóz</span>
      <span class="k"><span class="sw" style="background: var(--status-critical)" /> &lt; {{ f1(rr.veryLow) }}</span>
      <span class="k"><span class="sw hatched crit" /> {{ f1(rr.veryLow) }}–{{ f1(rr.low) }}</span>
      <span class="k"><span class="sw inrange" /> {{ f1(rr.low) }}–{{ f1(rr.high) }}</span>
      <span class="k"><span class="sw hatched warn" /> {{ f1(rr.high) }}–{{ f1(rr.veryHigh) }}</span>
      <span class="k"><span class="sw" style="background: var(--status-serious)" /> &gt; {{ f1(rr.veryHigh) }}</span>
      <span class="k"><span class="sw" style="background: var(--series-insulin)" /> bólus</span>
      <span class="k"><span class="sw" style="background: var(--series-basal)" /> bázis</span>
      <span v-if="day.activeInsulin" class="k" :title="`${day.activeInsulin.insulin ?? 'Bólusinzulin'}, hatásidő ${actionLabel(day.activeInsulin.durationMinutes)}`">
        <span class="sw iob" /> bólus hatása ({{ actionLabel(day.activeInsulin.durationMinutes) }})
      </span>
    </div>
    <div ref="el" class="chart-box" />
  </div>
</template>
