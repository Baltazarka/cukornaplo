<script setup lang="ts">
// Ambuláns glükózprofil (AGP) egy időszakra: a nap időpontja szerint medián (szaggatott),
// 25–75% sáv tartományonként színezve, 5–95% pontozott sáv, céltartomány-vonalak.
// Alatta óránkénti átlagos inzulin (bólus/bázis) és szénhidrát, közös időtengelyen.
const props = defineProps<{ data: any }>()

const el = ref<HTMLElement | null>(null)
let chart: any = null
let echarts: any = null
let ro: ResizeObserver | null = null

const token = cssToken
function num(v: number, dec: number): string {
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function hm(min: number): string {
  const m = Math.round(min) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function buildOption() {
  // Telefonon kisebb, tömörebb buborék.
  const tipNarrow = (el.value?.clientWidth ?? 800) < 520
  const d = props.data
  const a = d.agp
  const r = d.range
  const C = {
    text: token('--text-secondary'),
    muted: token('--text-muted'),
    grid: token('--grid'),
    axis: token('--axis'),
    primary: token('--text-primary'),
    tooltipBg: token('--tooltip-bg'),
    border: token('--border'),
    insulin: token('--series-insulin'),
    basal: token('--series-basal'),
    correction: token('--series-correction'),
    carbs: token('--series-carbs'),
    glucose: token('--series-glucose'),
  }
  // „Éjszaka” téma: feliratozott határvonalak, zónánként színezett folytonos medián, a 25–75% sáv egyszínű halvány
  // terület (csíkozás nélkül), az 5–95% sáv zónánként színezett pontokkal.
  const night = document.documentElement.getAttribute('data-theme') === 'pastel-night'
  const zoneColors = nightZoneColors()

  const x = a.minutes as number[]
  const pts = (arr: (number | null)[]) => arr.map((v, i) => [x[i], v])
  const diff = (hi: (number | null)[], lo: (number | null)[]) =>
    hi.map((v, i) => (v == null || lo[i] == null ? [x[i], null] : [x[i], Math.max(0, v - (lo[i] as number))]))

  // A 25–75% sáv tartományonkénti szeletei: minden szeletnél [alap, magasság] halmozott terület.
  const bands: [number, number, any][] = Object.values(rangeFills(r)).map((b) => [b.lo, b.hi, b.color])
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const iqrSeries = night
    ? [
        { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: 'iqr', data: pts(a.p25), symbol: 'none', silent: true,
          lineStyle: { width: 0 }, connectNulls: false, smooth: 0.3, z: 2, tooltip: { show: false } },
        { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: 'iqr', data: diff(a.p75, a.p25), symbol: 'none', silent: true,
          lineStyle: { width: 0 }, areaStyle: { color: rgba(C.glucose, 0.3), opacity: 1 }, connectNulls: false, smooth: 0.3, z: 2, tooltip: { show: false } },
      ]
    : bands.flatMap(([lo, hi, color], bi) => {
    const base = a.p25.map((v: number | null, i: number) => (v == null || a.p75[i] == null ? null : clamp(v, lo, hi)))
    const top = a.p75.map((v: number | null, i: number) => (v == null || a.p25[i] == null ? null : clamp(v, lo, hi)))
    return [
      { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: `iqr${bi}`, data: pts(base), symbol: 'none', silent: true,
        lineStyle: { width: 0 }, connectNulls: false, smooth: 0.3, z: 2, tooltip: { show: false } },
      { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: `iqr${bi}`, data: diff(top, base), symbol: 'none', silent: true,
        lineStyle: { width: 0 }, areaStyle: { color, opacity: 1 }, connectNulls: false, smooth: 0.3, z: 2, tooltip: { show: false } },
    ]
  })

  const zoneList: [number, number, string][] = [[0, r.veryLow, zoneColors.veryLow], [r.veryLow, r.low, zoneColors.low], [r.low, r.high, zoneColors.inRange], [r.high, r.veryHigh, zoneColors.high], [r.veryHigh, 40, zoneColors.veryHigh]]
  const outerNight = night
    ? zoneList.flatMap(([lo, hi, color], bi) => {
        const base = a.p5.map((v: number | null, i: number) => (v == null || a.p95[i] == null ? null : clamp(v, lo, hi)))
        const top = a.p95.map((v: number | null, i: number) => (v == null || a.p5[i] == null ? null : clamp(v, lo, hi)))
        return [
          { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: `outer${bi}`, data: pts(base), symbol: 'none', silent: true,
            lineStyle: { width: 0 }, connectNulls: false, smooth: 0.3, z: 1, tooltip: { show: false } },
          { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: `outer${bi}`, data: diff(top, base), symbol: 'none', silent: true,
            lineStyle: { width: 0 }, areaStyle: { color: dotPattern(rgba(color, 0.8)), opacity: 1 }, connectNulls: false, smooth: 0.3, z: 1, tooltip: { show: false } },
        ]
      })
    : []
  const maxP95 = Math.max(0, ...a.p95.filter((v: number | null) => v != null))
  const hourX = Array.from({ length: 24 }, (_, h) => h * 60 + 30)
  const hourBars = (vals: number[]) => vals.map((v, h) => [hourX[h], v || null])

  const fmtTooltip = (params: any) => {
    const p = Array.isArray(params) ? params[0] : params
    const minute = p?.axisValue
    if (minute == null) return ''
    const i = Math.min(a.minutes.length - 1, Math.max(0, Math.floor(minute / 15)))
    const h = Math.min(23, Math.max(0, Math.floor(minute / 60)))
    const row = (label: string, val: string) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${label}</span><b>${val}</b></div>`
    let html = `<div style="font-weight:600;margin-bottom:4px">${hm(a.minutes[i] - 7.5)}–${hm(a.minutes[i] + 7.5)}</div>`
    if (a.p50[i] != null) {
      html += row('Medián', `${num(a.p50[i], 1)} mmol/L`)
      html += row('25–75%', `${num(a.p25[i], 1)}–${num(a.p75[i], 1)}`)
      html += row('5–95%', `${num(a.p5[i], 1)}–${num(a.p95[i], 1)}`)
    } else {
      html += '<div>Kevés adat ebben az időszakban</div>'
    }
    const hb = d.hourly
    if (hb.meal[h] || hb.correction[h] || hb.basal[h] || hb.carbs[h]) {
      html += `<div style="margin-top:6px;color:${C.muted}">${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00, napi átlag</div>`
      if (hb.meal[h]) html += row('Étkezési bólus', `${num(hb.meal[h], 1)} E`)
      if (hb.correction[h]) html += row('Korrekció', `${num(hb.correction[h], 1)} E`)
      if (hb.basal[h]) html += row('Bázis', `${num(hb.basal[h], 1)} E`)
      if (hb.carbs[h]) html += row('Szénhidrát', `${num(hb.carbs[h], 0)} g`)
    }
    return html
  }

  const axisLabel = { color: C.muted, hideOverlap: true }
  const splitLine = { lineStyle: { color: C.grid } }
  const axisLine = { lineStyle: { color: C.axis } }
  // Keskeny kijelzőn (telefon) kisebb bal margó, hogy a grafikon szélesebb legyen.
  const GRID_LEFT = (el.value?.clientWidth ?? 800) < 520 ? 34 : 52
  const xAxisFor = (gridIndex: number) => ({
    type: 'value' as const,
    gridIndex,
    containShape: false, // ECharts 6: különben az oszlopok miatt kitágítaná a tengelyt, és a panelek elcsúsznának
    min: 0,
    max: 1440,
    interval: 120,
    axisLabel: { ...axisLabel, formatter: (v: number) => String(Math.floor(v / 60) % 24).padStart(2, '0') },
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
  const bar = (name: string, idx: number, data: any[], color: string, stack?: string) => ({
    name, type: 'bar', xAxisIndex: idx, yAxisIndex: idx, data, stack, barWidth: 6, silent: true,
    itemStyle: { color, borderRadius: stack ? 0 : [2, 2, 0, 0] },
  })

  const option: any = {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    title: [
      panelTitle('Glükózprofil', 'mmol/L', 4),
      panelTitle('Inzulin', 'E / óra, napi átlag', 270),
      panelTitle('Szénhidrát', 'g / óra, napi átlag', 398),
    ],
    grid: [
      { left: GRID_LEFT, right: 16, top: 30, height: 208, outerBoundsMode: 'none' },
      { left: GRID_LEFT, right: 16, top: 294, height: 78, outerBoundsMode: 'none' },
      { left: GRID_LEFT, right: 16, top: 422, height: 78, outerBoundsMode: 'none' },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: C.axis } },
    tooltip: {
      trigger: 'axis', backgroundColor: C.tooltipBg, borderColor: C.border, borderWidth: 1,
      textStyle: { color: C.text, fontSize: tipNarrow ? 11 : 13 }, padding: tipNarrow ? [4, 7] : 10, formatter: fmtTooltip, axisPointer: { type: 'line' },
      confine: true,
      extraCssText: tipNarrow ? 'max-width:58vw;white-space:normal;line-height:1.3;' : '',
    },
    xAxis: [xAxisFor(0), xAxisFor(1), xAxisFor(2)],
    yAxis: [
      { type: 'value', gridIndex: 0, min: 2, max: Math.max(16, Math.ceil(maxP95 + 1)), interval: 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 1, min: 0, splitNumber: 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 2, min: 0, splitNumber: 2, axisLabel, splitLine, axisLine: { show: false } },
    ],
    series: [
      // 5–95%: halmozott terület (alap + magasság), pontozott mintával („Éjszaka” témában zónánként színes pontok)
      ...outerNight,
      ...(night ? [] : [{ type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: 'outer', data: pts(a.p5), symbol: 'none', silent: true,
        lineStyle: { width: 0 }, connectNulls: false, smooth: 0.3, z: 1, tooltip: { show: false } },
      { type: 'line', xAxisIndex: 0, yAxisIndex: 0, stack: 'outer', data: diff(a.p95, a.p5), symbol: 'none', silent: true,
        lineStyle: { width: 0 }, areaStyle: { color: dotPattern(C.muted), opacity: 1 }, connectNulls: false, smooth: 0.3, z: 1, tooltip: { show: false } }]),
      ...iqrSeries,
      {
        name: 'Medián', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: pts(a.p50), symbol: 'none', z: 4,
        lineStyle: night ? { width: 2.6 } : { width: 2, type: 'dashed', color: C.primary }, connectNulls: false, smooth: 0.3,
        markLine: night
          ? {
              silent: true, symbol: 'none',
              label: { show: true, position: 'insideEndTop', fontSize: 10, fontWeight: 600, formatter: (p: any) => num(p.value, Number.isInteger(p.value) ? 0 : 1) },
              data: ([[r.veryLow, zoneColors.veryLow], [r.low, zoneColors.low], [r.high, zoneColors.high], [r.veryHigh, zoneColors.veryHigh]] as [number, string][])
                .map(([v, color]) => ({ yAxis: v, lineStyle: { color: rgba(color, 0.6), width: 1, type: [4, 4] }, label: { color, ...(v === r.veryLow ? { position: 'insideEndBottom' } : {}) } })),
            }
          : {
          silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: C.primary, width: 1.5, type: 'solid' },
          data: [{ yAxis: r.low }, { yAxis: r.high }],
            },
      },
      bar('Étkezési bólus', 1, hourBars(d.hourly.meal), C.insulin, 'ins'),
      bar('Korrekció', 1, hourBars(d.hourly.correction), C.correction, 'ins'),
      bar('Bázis', 1, hourBars(d.hourly.basal), C.basal, 'ins'),
      bar('Szénhidrát', 2, hourBars(d.hourly.carbs), C.carbs),
    ],
  }
  if (night) {
    option.visualMap = {
      type: 'piecewise', show: false, dimension: 1, seriesIndex: option.series.findIndex((x: any) => x.name === 'Medián'),
      pieces: [
        { lt: r.veryLow, color: zoneColors.veryLow },
        { gte: r.veryLow, lt: r.low, color: zoneColors.low },
        { gte: r.low, lte: r.high, color: zoneColors.inRange },
        { gt: r.high, lte: r.veryHigh, color: zoneColors.high },
        { gt: r.veryHigh, color: zoneColors.veryHigh },
      ],
    }
  }
  return option
}

async function render() {
  if (!el.value) return
  if (!echarts) echarts = await import('echarts')
  if (!chart) chart = echarts.init(el.value, null, { renderer: 'canvas', devicePixelRatio: Math.max(2, window.devicePixelRatio || 1) })
  chart.setOption(buildOption(), true)
}

onMounted(async () => {
  await render()
  // A bal margó a szélességtől függ: a határ átlépésekor újraépítjük.
  let narrow = (el.value?.clientWidth ?? 800) < 520
  ro = new ResizeObserver(() => {
    chart?.resize()
    const n = (el.value?.clientWidth ?? 800) < 520
    if (n !== narrow) { narrow = n; render() }
  })
  ro.observe(el.value!)
})
watch(() => props.data, render)
// Témaváltáskor újrarajzol (a színek a CSS-változókból jönnek).
watch(useState<number>('theme-tick', () => 0), render)
onBeforeUnmount(() => {
  ro?.disconnect()
  chart?.dispose()
  chart = null
})

const r = computed(() => props.data.range)
function f1(v: number): string {
  return v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
</script>

<template>
  <div>
    <div class="chart-legend agp-legend agp-legend-classic">
      <span class="k"><span class="sw line" style="background: var(--text-primary)" /> céltartomány</span>
      <span class="k"><span class="sw dashed" /> medián</span>
      <span class="k"><span class="sw dotted" /> 5–95%</span>
      <span class="k muted">25–75%:</span>
      <span class="k"><span class="sw" style="background: var(--status-critical)" /> &lt; {{ f1(r.veryLow) }}</span>
      <span class="k"><span class="sw hatched crit" /> {{ f1(r.veryLow) }}–{{ f1(r.low) }}</span>
      <span class="k"><span class="sw inrange" /> {{ f1(r.low) }}–{{ f1(r.high) }}</span>
      <span class="k"><span class="sw hatched warn" /> {{ f1(r.high) }}–{{ f1(r.veryHigh) }}</span>
      <span class="k"><span class="sw" style="background: var(--status-serious)" /> &gt; {{ f1(r.veryHigh) }}</span>
      <span class="k"><span class="sw" style="background: var(--series-insulin)" /> étkezési bólus</span>
      <span class="k"><span class="sw" style="background: var(--series-correction)" /> korrekció</span>
      <span class="k"><span class="sw" style="background: var(--series-basal)" /> bázis</span>
    </div>
    <div class="chart-legend agp-legend agp-legend-night">
      <span class="k"><span class="sw line" style="background: var(--status-good)" /> medián (zónánként színezve)</span>
      <span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 30%, transparent)" /> 25–75%</span>
      <span class="k"><span class="sw dotted" /> 5–95% (zónánként színes pontok)</span>
      <span class="k"><span class="sw" style="background: var(--series-insulin)" /> étkezési bólus</span>
      <span class="k"><span class="sw" style="background: var(--series-correction)" /> korrekció</span>
      <span class="k"><span class="sw" style="background: var(--series-basal)" /> bázis</span>
      <span class="k"><span class="sw" style="background: var(--series-carbs)" /> szénhidrát</span>
    </div>
    <div ref="el" class="chart-box agp-chart" />
  </div>
</template>
