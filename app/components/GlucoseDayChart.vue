<script setup lang="ts">
// Három összehangolt grafikon közös időtengelyen: glükózgörbe (az időszakos AGP-grafikonnal
// azonos stílusban: céltartomány-vonalak, a görbe és a határok közti rész tartományonként
// kitöltve), inzulin (bólus/bázis) és szénhidrát oszlopok. A crosshair mindhárom panelt
// összeköti, a tooltip egyszerre mutatja az értékeket.
const props = defineProps<{ day: any }>()

// Előrejelzés a mai napon (szaggatott vonal): a felvett inzulinból, szénhidrátból és a trendből.
// Az időtáv (0 = ki) a böngészőben megmarad.
const readOnly = useReadOnly()
const forecastHours = ref(3)
const forecast = ref<[number, number][]>([])
const forecastAvailable = computed(() => !readOnly.value && props.day?.day === props.day?.today)
let forecastSeq = 0
async function loadForecast() {
  const seq = ++forecastSeq
  let pts: [number, number][] = []
  if (forecastAvailable.value && forecastHours.value > 0) {
    try {
      const r = await $fetch<any>('/api/predict', { query: { series: forecastHours.value } })
      pts = r.series ?? []
    } catch { /* nincs előrejelzés */ }
  }
  if (seq !== forecastSeq) return // közben újabb kérés indult
  forecast.value = pts
  await render()
}
function setForecastHours() {
  try { localStorage.setItem('forecastHours', String(forecastHours.value)) } catch { /* nincs localStorage */ }
  loadForecast()
}

const el = ref<HTMLElement | null>(null)
let chart: any = null
let echarts: any = null
let ro: ResizeObserver | null = null

// Keskeny kijelzőn (telefon) kisebb bal margó, hogy a grafikon szélesebb legyen.
let GRID_LEFT = 52
const GRID_RIGHT = 16
const narrowWidth = () => (el.value?.clientWidth ?? 800) < 520
const BAR_WIDTH = 6
const KIND = {
  meal: { label: 'Étkezési bólus', color: 'insulin' },
  correction: { label: 'Korrekció', color: 'correction' },
  basal: { label: 'Bázis', color: 'basal' },
} as const
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
  GRID_LEFT = narrowWidth() ? 34 : 52
  // Telefonon kisebb, tömörebb buborék (a teljes szélességet nem foglalja el).
  const narrow = narrowWidth()
  const d = props.day
  const r = d.range
  // Kifutás a következő napra: ha az inzulin vagy a szénhidrát hatása éjfél után is tart, a tengely meghosszabbodik
  // (legfeljebb 8 órával, 2 órás lépcsőkben), és a hatásgörbék kifutása látszik. A következő napon ugyanez a maradék indul.
  const tailEnds: number[] = []
  for (const [doseMs, , dia] of (d.activeInsulin?.doses ?? []) as [number, number, number, string][]) tailEnds.push(doseMs + dia * 60000)
  for (const [ts, , , prof] of (d.absorption?.carbs ?? []) as [number, number, string | null, number[]][]) {
    const i = prof.findIndex((v) => v >= 0.995)
    tailEnds.push(ts + (i < 0 ? prof.length - 1 : i) * 15 * 60000)
  }
  const overshoot = Math.max(0, ...tailEnds) - d.dayEndMs
  const tailMs = overshoot > 5 * 60000 ? Math.min(8 * 3600000, Math.ceil(overshoot / (2 * 3600000)) * 2 * 3600000) : 0
  const axisMax = d.dayEndMs + tailMs
  // Átlógás az előző napról: ha egy előző napi adag vagy étkezés hatása még tart, a tengely balra is meghosszabbodik
  // (legfeljebb 8 óra), és látszik az adag oszlopa meg a görbe eleje.
  let headStart = d.dayStartMs
  for (const [doseMs, , dia] of (d.activeInsulin?.doses ?? []) as [number, number, number, string][]) {
    if (doseMs < d.dayStartMs && doseMs + dia * 60000 > d.dayStartMs) headStart = Math.min(headStart, doseMs)
  }
  for (const [ts, , , prof] of (d.absorption?.carbs ?? []) as [number, number, string | null, number[]][]) {
    const i = prof.findIndex((v) => v >= 0.995)
    if (ts < d.dayStartMs && ts + (i < 0 ? prof.length - 1 : i) * 15 * 60000 > d.dayStartMs) headStart = Math.min(headStart, ts)
  }
  const headMs = d.dayStartMs - headStart > 5 * 60000 ? Math.min(8 * 3600000, Math.ceil((d.dayStartMs - headStart) / (2 * 3600000)) * 2 * 3600000) : 0
  const axisMin = d.dayStartMs - headMs
  const C = {
    text: cssToken('--text-secondary'),
    muted: cssToken('--text-muted'),
    grid: cssToken('--grid'),
    axis: cssToken('--axis'),
    primary: cssToken('--text-primary'),
    insulin: cssToken('--series-insulin'),
    basal: cssToken('--series-basal'),
    correction: cssToken('--series-correction'),
    carbs: cssToken('--series-carbs'),
    low: cssToken('--status-critical'),
    tooltipBg: cssToken('--tooltip-bg'),
    surface: cssToken('--surface-1'),
    border: cssToken('--border'),
  }

  // Glükóz: 15 percnél hosszabb szünetnél megszakad a görbe és a kitöltés is.
  // A kiválasztott nap mellett a meghosszabbított (előző / következő napi) szakaszok vércukra is látszik.
  const gRaw: [number, number][] = [
    ...((d.glucoseExt ?? []) as [number, number][]).filter((p) => p[0] >= axisMin && p[0] <= axisMax),
    ...d.glucose,
  ].sort((a, b) => a[0] - b[0])
  // Az átlógó szakaszokon a vércukorgörbe enyhén simított (1-2-1 súlyozású átlag), hogy ne legyen szúrós; a kiválasztott nap
  // görbéje és a buborék értékei nyers adatok.
  const inDay = (ms: number) => ms >= d.dayStartMs && ms < d.dayEndMs
  const gSrc: [number, number][] = gRaw.map((p, i) => {
    if (inDay(p[0])) return p
    const a = gRaw[i - 1]
    const b = gRaw[i + 1]
    if (!a || !b || p[0] - a[0] > 15 * 60000 || b[0] - p[0] > 15 * 60000) return p
    return [p[0], (a[1] + 2 * p[1] + b[1]) / 4]
  })
  const g: [number, number | null][] = []
  gSrc.forEach((p, i) => {
    if (i > 0 && p[0] - gSrc[i - 1][0] > 15 * 60000) g.push([p[0] - 1, null])
    g.push([p[0], p[1]])
  })
  // Kézzel felvitt vércukor (kézi mérés): rombusz jelölő, a görbétől külön.
  const manualG = ((d.manualGlucose ?? []) as [number, number][]).filter((p) => p[0] >= axisMin && p[0] <= axisMax)
  const gMax = [...d.glucose, ...manualG].reduce((m: number, p: [number, number]) => Math.max(m, p[1]), 0)

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
  const msPerPx = (axisMax - axisMin) / plotWidth
  const shiftMs = (BAR_WIDTH + 2) * msPerPx
  // [oszlop helye, adag, eredeti időpont, típus]; étkezési bólus és korrekció egy csoportban.
  const carryDoses = ((d.activeInsulin?.doses ?? []) as [number, number, number, string][])
    .filter((x) => x[0] < d.dayStartMs)
    .map((x) => [x[0], x[1], x[0], x[3]])
  const bolus = [...carryDoses, ...d.insulin.filter((p: any[]) => p[2] !== 'basal').map((p: any[]) => [p[0], p[1], p[0], p[2]])]
  const basal = d.insulin.filter((p: any[]) => p[2] === 'basal').map((p: any[]) => [p[0], p[1]])
  for (const b of basal) {
    const o = bolus.find((p: number[]) => Math.abs(p[0] - b[0]) <= 5 * 60000)
    if (!o) continue
    if (b[1] <= o[1]) b[0] = o[0] + shiftMs
    else o[0] = b[0] + shiftMs
  }
  // A zsírosnak jelölt étkezés oszlopa halványabb, keretes.
  const carryCarbs = ((d.absorption?.carbs ?? []) as [number, number, string | null][]).filter((x) => x[0] < d.dayStartMs)
  const carbs = [...carryCarbs, ...d.carbs].map((p: any[]) => (p[2] === 'fatty'
    ? { value: [p[0], p[1]], itemStyle: { color: rgba(C.carbs, 0.35), borderColor: C.carbs, borderWidth: 1.5 } }
    : [p[0], p[1]]))

  // Terápiás napszakok: halvány, váltakozó sávok mindhárom panelen, felül az értékekkel (ha elfér),
  // a glükózpanelen szaggatott vonallal a napszak célértéke.
  const segs: any[] = d.segments?.list ?? []
  const showBands = !!d.segments?.byTimeOfDay && new Set(segs.map((x) => x.index)).size > 1
  const bandColor = rgba(C.primary, 0.045)
  // A napszak felirata; ha a napszaknak saját hatásideje van, az is.
  const segLabel = (x: any) => {
    const own = x.actionMinutes !== d.activeInsulin?.durationMinutes ? ` · ${actionLabel(x.actionMinutes)}` : ''
    return (x.to - x.from) / msPerPx >= 96 + (own ? 30 : 0) ? `CH ${num(x.icr, 1)} · ISF ${num(x.isf, 1)}${own}` : ''
  }
  // Minden második napszak kap halvány hátteret; a glükózpanelen mindegyik feliratot is.
  const segAreas = (withLabel: boolean) => segs
    .filter((x) => withLabel || (showBands && x.index % 2 === 1))
    .map((x) => [
      {
        xAxis: x.from,
        itemStyle: { color: showBands && x.index % 2 === 1 ? bandColor : 'transparent' },
        label: withLabel ? { show: true, formatter: segLabel(x) } : { show: false },
      },
      { xAxis: x.to },
    ])
  const segmentSeries = segs.length
    ? [0, 1, 2].map((gi) => ({
        type: 'line', xAxisIndex: gi, yAxisIndex: gi, data: [], silent: true, z: 0, tooltip: { show: false },
        markArea: {
          silent: true,
          label: { position: 'insideTop', distance: 4, color: C.muted, fontSize: 10 },
          data: segAreas(gi === 0),
        },
        ...(gi === 0
          ? {
              markLine: {
                silent: true, symbol: 'none', label: { show: false },
                lineStyle: { color: C.muted, width: 1, type: [4, 4] },
                data: segs.map((x) => [{ coord: [x.from, x.target] }, { coord: [x.to, x.target] }]),
              },
            }
          : {}),
      }))
    : []
  const segmentAt = (x: number) => segs.find((q) => x >= q.from && x < q.to)

  // Jegyzetek: halvány függőleges vonal a glükózpanelen, felül a címkével.
  const notes: any[] = d.notes ?? []
  const noteLabel = (n: any) => [...n.tags.map(noteTagLabel), n.text].filter(Boolean).join(', ')
  const noteShort = (n: any) => (n.tags.length ? noteTagLabel(n.tags[0]) : n.text).slice(0, 14)
  // A bólusok még hatásban lévő inzulinja (a terápiás beállítások hatásidejével). Az oszlop helyén
  // megszakítjuk, és egy pixellel az oszlop alól indul: így nem lóg ki a teteje fölé, és nincs rés sem.
  // Minden bólus saját görbéje az oszlopa tetejéről indul, és mutatja, meddig hat még.
  // (Az összesített aktív inzulint a buborék írja ki.)
  const ai = d.activeInsulin
  const iobTotal: [number, number | null][] = ai?.points ?? []
  // A tengely a legnagyobb adagnál csak 5 E-vel magasabb (a bázis nem számít bele: az csak egy pont).
  const insMax = Math.ceil(Math.max(1, ...d.insulin.filter((p: any[]) => p[2] !== 'basal').map((p: any[]) => p[1]), ...iobTotal.map((p) => p[1] ?? 0)) + 5)
  const drop = (IOB_LINE / 2) * (insMax / INS_HEIGHT)
  const curves: { kind: string; data: [number, number][] }[] = []
  if (ai) {
    const edgeMs = (BAR_WIDTH / 2 - 1) * msPerPx
    // Minden adag a saját (a beadás napszakára érvényes) hatásidejével.
    const models = new Map<number, ReturnType<typeof insulinModel>>()
    for (const [doseMs, dose, dia, kind] of ai.doses as [number, number, number, string][]) {
      if (!models.has(dia)) models.set(dia, insulinModel(ai.peakMinutes, dia))
      const bar = bolus.find((p: any[]) => p[2] === doseMs)
      const startMs = bar ? bar[0] + edgeMs : doseMs
      curves.push({ kind, data: doseCurve(models.get(dia)!, dia, doseMs, dose, startMs, drop) })
    }
  }

  // Aktív szénhidrát: minden étkezés saját görbéje (a tanult felszívódással, zsíros / gyors külön), az oszlop
  // tetejéről indulva, mutatja, mennyi CH nem szívódott még fel.
  const ab = d.absorption
  const carbMax = niceMax(Math.max(10, ...d.carbs.map((p: any[]) => p[1])))
  const carbDrop = (IOB_LINE / 2) * (carbMax / INS_HEIGHT)
  const protoFrac = (prof: number[], m: number) => {
    if (m <= 0) return 0
    const x = m / 15
    if (x >= prof.length - 1) return 1
    const i = Math.floor(x)
    return prof[i] + (prof[i + 1] - prof[i]) * (x - i)
  }
  const cobCurves: [number, number][][] = []
  if (ab) {
    const edge = (BAR_WIDTH / 2 - 1) * msPerPx
    for (const [ts, grams, , prof] of ab.carbs as [number, number, string | null, number[]][]) {
      const pts: [number, number][] = [[ts + edge, Math.max(0, grams - carbDrop)]]
      for (let i = 1; i < prof.length; i++) {
        pts.push([ts + i * 15 * 60000, Math.max(0, grams * (1 - prof[i]) - carbDrop)])
        if (prof[i] >= 0.995) break
      }
      cobCurves.push(pts)
    }
  }
  const cobAtMs = (x: number) => {
    if (!ab) return 0
    let sum = 0
    for (const [ts, grams, , prof] of ab.carbs as [number, number, string | null, number[]][]) {
      const m = (x - ts) / 60000
      if (m < 0) continue
      sum += grams * (1 - protoFrac(prof, m))
    }
    return sum
  }

  const fmtTooltip = (params: any) => {
    const x = Array.isArray(params) ? params[0]?.axisValue : params.axisValue
    if (x == null) return ''
    let gNear: number | null = null
    let gDiff = Infinity
    for (const p of gRaw) {
      const diff = Math.abs(p[0] - x)
      if (diff < gDiff) { gDiff = diff; gNear = p[1] }
    }
    const win = 6 * 60000
    const ins = d.insulin.filter((p: any[]) => Math.abs(p[0] - x) <= win)
    const ch = d.carbs.filter((p: any[]) => Math.abs(p[0] - x) <= win)
    let html = `<div style="font-weight:600;margin-bottom:4px">${hm(x)}</div>`
    const sg = segmentAt(x)
    if (sg && !narrow) {
      html += `<div style="color:${C.muted};font-size:12px;margin-bottom:4px">${d.segments.byTimeOfDay ? `Napszak ${sg.start}–${sg.end}` : 'Egész nap'}: cél ${num(sg.target, 1)} · ISF ${num(sg.isf, 1)} · CH ${num(sg.icr, 1)} g/E</div>`
    }
    if (gNear !== null && gDiff <= 10 * 60000) {
      const col = gNear < r.low ? C.low : C.primary
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>Glükóz <b>${num(gNear, 1)}</b> mmol/L</div>`
    }
    const mNear = manualG.find((p) => Math.abs(p[0] - x) <= 6 * 60000)
    if (mNear) {
      html += `<div><span style="display:inline-block;width:7px;height:7px;background:${C.primary};transform:rotate(45deg);margin-right:7px"></span>Kézi mérés <b>${num(mNear[1], 1)}</b> mmol/L</div>`
    }
    if (forecast.value.length > 1 && x > forecast.value[0][0] + 60000) {
      const f = forecast.value.reduce((b, p) => (Math.abs(p[0] - x) < Math.abs(b[0] - x) ? p : b))
      if (Math.abs(f[0] - x) <= 6 * 60000) {
        html += `<div><span style="display:inline-block;width:10px;border-top:2px dashed ${C.primary};margin:0 6px 3px 0"></span>Előrejelzés <b>~${num(f[1], 1)}</b> mmol/L</div>`
      }
    }
    for (const p of ins) {
      const k = KIND[p[2] as keyof typeof KIND] ?? KIND.meal
      // A bólus hatásideje (a beadás napszakáé) és a napszak kezdete.
      const dose = (ai?.doses as any[] | undefined)?.find((x) => x[0] === p[0])
      const sg = segmentAt(p[0])
      const extra = dose && !narrow ? ` <span style="color:${C.muted}">· hatás ${actionLabel(dose[2])}${sg && d.segments?.byTimeOfDay ? `, ${sg.start} napszak` : ''}</span>` : ''
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C[k.color]};margin-right:6px"></span>${k.label} <b>${num(p[1], 2)}</b> E${extra}</div>`
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
    for (const n of notes.filter((q) => Math.abs(q.ts - x) <= 10 * 60000)) {
      html += `<div style="margin-top:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid ${C.muted};margin-right:6px"></span>Jegyzet ${n.time}: <b>${escapeHtml(noteLabel(n))}</b></div>`
    }
    for (const p of ch) {
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C.carbs};margin-right:6px"></span>Szénhidrát <b>${num(p[1], 0)}</b> g${p[2] ? ` <span style="color:${C.muted}">· ${p[2] === 'fatty' ? 'zsíros / fehérjedús' : 'gyors CH'}</span>` : ''}</div>`
    }
    const cob = cobAtMs(x)
    if (cob >= 0.5) html += `<div><span style="display:inline-block;width:8px;height:2px;background:${C.carbs};margin:0 6px 3px 0"></span>Aktív CH <b>${num(cob, 0)}</b> g</div>`
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
    min: axisMin,
    max: axisMax,
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
      textStyle: { color: C.text, fontSize: narrow ? 11 : 13 }, padding: narrow ? [4, 7] : 10, formatter: fmtTooltip, axisPointer: { type: 'line' },
      confine: true,
      extraCssText: narrow ? 'max-width:58vw;white-space:normal;line-height:1.3;' : '',
    },
    xAxis: [xAxisFor(0), xAxisFor(1), xAxisFor(2)],
    yAxis: [
      { type: 'value', gridIndex: 0, min: 2, max: Math.max(16, Math.ceil(Math.max(gMax, ...forecast.value.map((p) => p[1])) + 1)), interval: 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 1, min: 0, max: insMax, interval: insMax / 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 2, min: 0, max: carbMax, interval: carbMax / 2, axisLabel, splitLine, axisLine: { show: false } },
    ],
    series: [
      ...segmentSeries,
      ...(tailMs || headMs
        ? [0, 1, 2].map((gi) => ({
            // Az átlógó (előző / következő napi) szakasz fölé áttetsző réteg kerül: minden adata halványabb.
            type: 'line', xAxisIndex: gi, yAxisIndex: gi, data: [], silent: true, z: 10, tooltip: { show: false },
            markArea: {
              silent: true,
              z: 10,
              label: { position: 'insideTop', distance: 4, color: C.muted, fontSize: 10 },
              data: [
                ...(headMs ? [[{ xAxis: axisMin, itemStyle: { color: rgba(C.surface, 0.68) }, label: gi === 0 ? { show: true, formatter: 'előző nap' } : { show: false } }, { xAxis: d.dayStartMs }]] : []),
                ...(tailMs ? [[{ xAxis: d.dayEndMs, itemStyle: { color: rgba(C.surface, 0.68) }, label: gi === 0 ? { show: true, formatter: 'következő nap' } : { show: false } }, { xAxis: axisMax }]] : []),
              ],
            },
            markLine: {
              silent: true, symbol: 'none', label: { show: false },
              lineStyle: { color: C.muted, width: 1, type: [4, 3] },
              data: [...(headMs ? [{ xAxis: d.dayStartMs }] : []), ...(tailMs ? [{ xAxis: d.dayEndMs }] : [])],
            },
          }))
        : []),
      ...(notes.length
        ? [{
            type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: [], silent: true, z: 5, tooltip: { show: false },
            markLine: {
              silent: true, symbol: ['none', 'circle'], symbolSize: 6,
              lineStyle: { color: C.muted, width: 1, type: [2, 3] },
              label: { show: true, position: 'end', formatter: (p: any) => p.data.name, color: C.text, fontSize: 10 },
              data: notes.map((n) => ({ xAxis: n.ts, name: noteShort(n) })),
            },
          }]
        : []),
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
      ...(forecast.value.length > 1
        ? [{
            name: 'Előrejelzés', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: forecast.value, symbol: 'none', silent: true, z: 4,
            lineStyle: { width: 2, type: [5, 4], color: C.primary, opacity: 0.7 }, tooltip: { show: false },
          }]
        : []),
      ...(manualG.length
        ? [{
            name: 'Kézi mérés', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, data: manualG, symbol: 'diamond', symbolSize: 12, z: 6, silent: true,
            itemStyle: { color: C.primary, borderColor: C.surface, borderWidth: 2 }, tooltip: { show: false },
          }]
        : []),
      ...curves.map(({ kind, data }) => {
        const color = kind === 'correction' ? C.correction : C.insulin
        return {
          name: 'Aktív inzulin', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data, symbol: 'none', silent: true, z: 2,
          lineStyle: { width: IOB_LINE, color }, areaStyle: { color: rgba(color, 0.12) },
        }
      }),
      bar('Bólus', 1, bolus.filter((p: any[]) => p[3] !== 'correction').map((p: any[]) => [p[0], p[1]]), C.insulin),
      bar('Korrekció', 1, bolus.filter((p: any[]) => p[3] === 'correction').map((p: any[]) => [p[0], p[1]]), C.correction),
      // A bázisnak nincs hatásgörbéje: csak egy pont az alapvonalon (a nagy adag nem húzza el a tengelyt).
      {
        name: 'Bázis', type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, data: basal.map((p: number[]) => [p[0], 0]), symbol: 'circle', symbolSize: 9, z: 6, silent: true,
        itemStyle: { color: C.basal, borderColor: C.surface, borderWidth: 1.5 }, tooltip: { show: false }, clip: false,
      },
      ...cobCurves.map((data) => ({
        name: 'Aktív CH', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data, symbol: 'none', silent: true, z: 2,
        lineStyle: { width: IOB_LINE, color: C.carbs }, areaStyle: { color: rgba(C.carbs, 0.12) },
      })),
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
  try {
    const h = Number(localStorage.getItem('forecastHours') ?? 3)
    forecastHours.value = [0, 2, 3, 4].includes(h) ? h : 3
  } catch { /* nincs localStorage */ }
  await render()
  loadForecast()
  // Átméretezéskor újraszámoljuk az oszlopok eltolását is (pixelben értendő).
  ro = new ResizeObserver(() => {
    chart?.resize()
    render()
  })
  ro.observe(el.value!)
})
watch(() => props.day, loadForecast)
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
// Jelmagyarázat: a közös hatásidő, vagy ha a napszakok eltérnek, hogy napszakonként változik.
const actionText = computed(() => {
  const ai = props.day.activeInsulin
  const own = (props.day.segments?.list ?? []).some((x: any) => x.actionMinutes !== ai.durationMinutes)
  return own ? 'napszakonként eltérő' : actionLabel(ai.durationMinutes)
})
</script>

<template>
  <div>
    <div v-if="last" class="last-reading" :class="{ low: last.low, high: last.high }">
      <span class="lr-label">Utolsó aktív vércukor</span>
      <span class="lr-value">{{ f1(last.v) }} <small>mmol/L</small></span>
      <TrendArrows v-if="day.trend" :dir="day.trend.dir" :level="day.trend.level" class="lr-trend" />
      <span class="lr-time">{{ lastHm(last.ms) }}</span>
      <span v-if="day.iobNow != null" class="lr-iob" title="A még ható gyors hatású (bólus- és korrekciós) inzulin összesen, most">
        <span class="lr-label">Aktív inzulin</span>
        <span class="lr-iob-value">{{ f1(day.iobNow) }} <small>E</small></span>
      </span>
      <span v-if="day.cobNow != null" class="lr-iob lr-cob" title="A még fel nem szívódott szénhidrát összesen, most (a nálad mért felszívódási görbével)">
        <span class="lr-label">Aktív CH</span>
        <span class="lr-iob-value">{{ Math.round(day.cobNow) }} <small>g</small></span>
      </span>
    </div>
    <div class="chart-legend">
      <span class="k"><span class="sw line" style="background: var(--text-primary)" /> céltartomány / glükóz</span>
      <span class="k"><span class="sw" style="background: var(--status-critical)" /> &lt; {{ f1(rr.veryLow) }}</span>
      <span class="k"><span class="sw hatched crit" /> {{ f1(rr.veryLow) }}–{{ f1(rr.low) }}</span>
      <span class="k"><span class="sw inrange" /> {{ f1(rr.low) }}–{{ f1(rr.high) }}</span>
      <span class="k"><span class="sw hatched warn" /> {{ f1(rr.high) }}–{{ f1(rr.veryHigh) }}</span>
      <span class="k"><span class="sw" style="background: var(--status-serious)" /> &gt; {{ f1(rr.veryHigh) }}</span>
      <span v-if="day.segments" class="k"><span class="sw segment" /> {{ day.segments.byTimeOfDay ? 'napszak, célérték' : 'célérték' }}</span>
      <span class="k"><span class="sw" style="background: var(--series-insulin)" /> étkezési bólus</span>
      <span class="k"><span class="sw" style="background: var(--series-correction)" /> korrekció</span>
      <span class="k"><span class="sw" style="background: var(--series-basal)" /> bázis</span>
      <span v-if="day.manualGlucose?.length" class="k" title="Kézzel felvitt vércukor (nem szenzoradat)"><span class="sw diamond" /> kézi mérés</span>
      <span v-if="forecast.length > 1" class="k"><span class="sw line" style="background: repeating-linear-gradient(90deg, var(--text-primary) 0 5px, transparent 5px 9px)" /> előrejelzés</span>
      <span v-if="day.absorption" class="k" title="A szénhidrát még fel nem szívódott része: a tiszta étkezéseidből tanult felszívódási görbével (zsíros és gyors CH külön)">
        <span class="sw iob" style="border-color: var(--series-carbs); background: color-mix(in srgb, var(--series-carbs) 16%, transparent)" /> aktív CH
      </span>
      <span v-if="day.activeInsulin" class="k" :title="`${day.activeInsulin.insulin ?? 'Bólusinzulin'}, hatásidő ${actionLabel(day.activeInsulin.durationMinutes)}`">
        <span class="sw iob" /> bólus hatása ({{ actionText }})
      </span>
    </div>
    <div v-if="forecastAvailable" class="forecast-pick">
      <label>
        <span class="muted small">Előrejelzés:</span>
        <select v-model.number="forecastHours" aria-label="Előrejelzés időtávja" @change="setForecastHours">
          <option :value="0">ki</option>
          <option :value="2">2 óra</option>
          <option :value="3">3 óra</option>
          <option :value="4">4 óra</option>
        </select>
      </label>
      <span v-if="forecast.length > 1" class="muted small">A szaggatott vonal becslés a felvett inzulinból, CH-ból és a trendből; új étkezést vagy adagot nem ismer, nem helyettesíti a szenzor riasztását.</span>
    </div>
    <div ref="el" class="chart-box" />
  </div>
</template>
