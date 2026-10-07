<script setup lang="ts">
// Három összehangolt grafikon közös időtengelyen: glükózgörbe (céltartomány-sávval,
// alacsonynál pirosan), inzulin (bólus/bázis) és szénhidrát oszlopok. Nincs zoom;
// a crosshair mindhárom panelt összeköti, a tooltip egyszerre mutatja az értékeket.
const props = defineProps<{ day: any }>()

const el = ref<HTMLElement | null>(null)
let chart: any = null
let echarts: any = null
let ro: ResizeObserver | null = null

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
function hm(ms: number): string {
  return new Date(ms).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
}
function num(v: number, dec: number): string {
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function buildOption() {
  const d = props.day
  const C = {
    text: token('--text-secondary'),
    muted: token('--text-muted'),
    grid: token('--grid'),
    axis: token('--axis'),
    glucose: token('--series-glucose'),
    insulin: token('--series-insulin'),
    basal: token('--series-basal'),
    carbs: token('--series-carbs'),
    band: token('--band'),
    low: token('--status-critical'),
    high: token('--status-warning'),
    tooltipBg: token('--tooltip-bg'),
    border: token('--border'),
    primary: token('--text-primary'),
  }

  // Glükóz: 15 percnél hosszabb szünetnél megszakad a vonal.
  const g: [number, number | null][] = []
  d.glucose.forEach((p: [number, number], i: number) => {
    if (i > 0 && p[0] - d.glucose[i - 1][0] > 15 * 60000) g.push([p[0] - 1, null])
    g.push([p[0], p[1]])
  })
  const gMax = d.glucose.reduce((m: number, p: [number, number]) => Math.max(m, p[1]), 0)
  const bolus = d.insulin.filter((p: any[]) => p[2] !== 'basal').map((p: any[]) => [p[0], p[1]])
  const basal = d.insulin.filter((p: any[]) => p[2] === 'basal').map((p: any[]) => [p[0], p[1]])
  const carbs = d.carbs.map((p: any[]) => [p[0], p[1]])

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
      const col = gNear < d.range.low ? C.low : C.glucose
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>Glükóz <b>${num(gNear, 1)}</b> mmol/L</div>`
    }
    for (const p of ins) {
      const b = p[2] === 'basal'
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${b ? C.basal : C.insulin};margin-right:6px"></span>${b ? 'Bázis' : 'Bólus'} <b>${num(p[1], 2)}</b> E</div>`
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
  const GRID_LEFT = 52
  const xAxisFor = (gridIndex: number) => ({
    type: 'time' as const,
    gridIndex,
    min: d.dayStartMs,
    max: d.dayEndMs,
    axisLabel: { ...axisLabel, formatter: { hour: '{HH}:{mm}' } as any },
    axisLine,
    axisTick: { show: true },
    splitLine: { show: false },
  })
  const panelTitle = (name: string, unit: string, top: number) => ({
    text: `{a|${name}}  {b|${unit}}`,
    left: GRID_LEFT - 2,
    top,
    textStyle: {
      rich: {
        a: { color: C.primary, fontSize: 14, fontWeight: 600 },
        b: { color: C.muted, fontSize: 12, fontWeight: 400 },
      },
    },
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
      { left: GRID_LEFT, right: 16, top: 30, height: 208 },
      { left: GRID_LEFT, right: 16, top: 294, height: 78 },
      { left: GRID_LEFT, right: 16, top: 422, height: 78 },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: C.axis } },
    tooltip: {
      trigger: 'axis',
      backgroundColor: C.tooltipBg,
      borderColor: C.border,
      borderWidth: 1,
      textStyle: { color: C.text },
      padding: 10,
      formatter: fmtTooltip,
      axisPointer: { type: 'line' },
    },
    xAxis: [xAxisFor(0), xAxisFor(1), xAxisFor(2)],
    yAxis: [
      {
        type: 'value', gridIndex: 0, min: 2, max: Math.max(16, Math.ceil(gMax + 1)), interval: 2,
        axisLabel, splitLine, axisLine: { show: false },
      },
      { type: 'value', gridIndex: 1, min: 0, splitNumber: 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 2, min: 0, splitNumber: 2, axisLabel, splitLine, axisLine: { show: false } },
    ],
    series: [
      {
        name: 'Glükóz', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: g, z: 3,
        lineStyle: { width: 2, color: C.glucose }, itemStyle: { color: C.glucose },
        connectNulls: false, smooth: 0.2,
        showSymbol: true,
        symbolSize: (_v: any, p: any) => {
          const i = p.dataIndex
          const prev = g[i - 1]
          const next = g[i + 1]
          const isolated = (!prev || prev[1] === null) && (!next || next[1] === null)
          return isolated && g[i][1] !== null ? 6 : 0
        },
        markArea: {
          silent: true, itemStyle: { color: C.band },
          data: [[{ yAxis: d.range.low }, { yAxis: d.range.high }]],
        },
      },
      {
        name: 'Alacsony', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, silent: true, z: 4,
        symbolSize: 6, itemStyle: { color: C.low },
        data: d.glucose.filter((pt: [number, number]) => pt[1] < d.range.low),
        tooltip: { show: false }, legendHoverLink: false,
      },
      {
        name: 'Magas', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, silent: true, z: 4,
        symbolSize: 6, itemStyle: { color: C.high },
        data: d.glucose.filter((pt: [number, number]) => pt[1] > d.range.high),
        tooltip: { show: false }, legendHoverLink: false,
      },
      { name: 'Bólus', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: bolus, barWidth: 6, barMinHeight: 2, itemStyle: { color: C.insulin, borderRadius: [3, 3, 0, 0] } },
      { name: 'Bázis', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: basal, barWidth: 6, barMinHeight: 2, itemStyle: { color: C.basal, borderRadius: [3, 3, 0, 0] } },
      { name: 'Szénhidrát', type: 'bar', xAxisIndex: 2, yAxisIndex: 2, data: carbs, barWidth: 6, barMinHeight: 2, itemStyle: { color: C.carbs, borderRadius: [3, 3, 0, 0] } },
    ],
  }
}

async function render() {
  if (!el.value) return
  if (!echarts) echarts = await import('echarts')
  if (!chart) chart = echarts.init(el.value, null, { renderer: 'canvas' })
  chart.setOption(buildOption(), true)
}

onMounted(async () => {
  await render()
  ro = new ResizeObserver(() => chart?.resize())
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
function lastNum(v: number): string {
  return v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
</script>

<template>
  <div>
    <div v-if="last" class="last-reading" :class="{ low: last.low, high: last.high }">
      <span class="lr-label">Utolsó aktív vércukor</span>
      <span class="lr-value">{{ lastNum(last.v) }} <small>mmol/L</small></span>
      <span class="lr-time">{{ lastHm(last.ms) }}</span>
    </div>
    <div class="chart-legend">
      <span class="k"><span class="sw band" style="background: var(--band)" /> céltartomány</span>
      <span class="k"><span class="sw line" style="background: var(--status-critical)" /> alatta</span>
      <span class="k"><span class="sw line" style="background: var(--status-warning)" /> felette</span>
      <span class="k"><span class="sw" style="background: var(--series-insulin)" /> bólus</span>
      <span class="k"><span class="sw" style="background: var(--series-basal)" /> bázis</span>
    </div>
    <div ref="el" class="chart-box" />
  </div>
</template>
