<script setup lang="ts">
// Három összehangolt grafikon közös időtengelyen: glükózgörbe (az időszakos AGP-grafikonnal
// azonos stílusban: céltartomány-vonalak, a görbe és a határok közti rész tartományonként
// kitöltve), inzulin (bólus/bázis) és szénhidrát oszlopok. A crosshair mindhárom panelt
// összeköti, a tooltip egyszerre mutatja az értékeket.
const props = defineProps<{ day: any }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

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

// --- Szenzorhiba (pl. ráfekvés) kijelölése: a gomb után a grafikonon a szakasz elejére, majd a végére kattintasz.
// A kizárt szakasz szenzorértékei semmibe nem számítanak (statisztika, hipó, elemzés), a grafikonon szürkén látszanak.
const pickMode = ref(false)
const pickStart = ref<number | null>(null)
const pickBusy = ref(false)
function startPick() {
  pickMode.value = true
  pickStart.value = null
  render()
}
function cancelPick() {
  pickMode.value = false
  pickStart.value = null
  render()
}
const roundMin = (ms: number) => Math.round(ms / 60000) * 60000
async function onChartClick(ms: number) {
  if (!pickMode.value || pickBusy.value) return
  const d = props.day
  const x = Math.min(Math.max(roundMin(ms), d.dayStartMs - 8 * 3600000), Math.min(Date.now(), d.dayEndMs + 8 * 3600000))
  if (pickStart.value == null) {
    pickStart.value = x
    render()
    return
  }
  const from = Math.min(pickStart.value, x)
  const to = Math.max(pickStart.value, x)
  const n = [...(d.glucose ?? []), ...(d.glucoseExt ?? [])].filter((p: [number, number]) => p[0] >= from && p[0] <= to).length
  pickBusy.value = true
  try {
    if (to - from < 5 * 60000) {
      useToast().error('Túl rövid szakasz: kattints a végére legalább 5 perccel később.')
      return
    }
    const ok = await askConfirm(
      `Kizárod a szenzorértékeket ${hm(from)} és ${hm(to)} között (${n} mérés)?\n\nPl. ráfekvés okozta hamis mélynél. Ezek az értékek nem számítanak a statisztikába, a hipóeseményekbe és az elemzésbe; a grafikonon szürkén látszanak. Később visszavonható.`,
      { confirmLabel: 'Kizárás' },
    )
    if (!ok) return
    await $fetch('/api/excluded', { method: 'POST', body: { from: Math.floor(from / 1000), to: Math.floor(to / 1000) } })
    pickMode.value = false
    pickStart.value = null
    useToast().success(`Kizárva: ${hm(from)}–${hm(to)}.`)
    emit('changed')
  } catch (e: any) {
    useToast().error(e?.data?.error ?? 'A kizárás nem sikerült.')
  } finally {
    pickBusy.value = false
    render()
  }
}
async function removeExcluded(x: { id: number; from: number; to: number }) {
  if (!(await askConfirm(`Visszavonod a kizárást (${hm(x.from)}–${hm(x.to)})? Az értékek újra beleszámítanak.`, { confirmLabel: 'Visszavonás' }))) return
  try {
    await $fetch('/api/excluded-delete', { method: 'POST', body: { id: x.id } })
    emit('changed')
  } catch (e: any) {
    useToast().error(e?.data?.error ?? 'A visszavonás nem sikerült.')
  }
}

// --- Nagyítás (csúszka nélkül): asztalin Ctrl + görgő (érintőpadon két ujjas csippentés), telefonon csippentés;
// nagyítva húzással mozgatható. A sima görgetés és a függőleges húzás a lapot görgeti. Saját kezelés: az ECharts
// beépített nagyítása a grafikon fölött minden görgetést elnyelne. A nagyítás az újrarajzolásokat túléli, másik napon
// visszaáll.
const zoomRange = ref<[number, number] | null>(null)
/** A teljes (nagyítatlan) tengely, a legutóbbi rajzolásból. */
let fullRange: [number, number] = [0, 0]
const MIN_SPAN = 30 * 60000
function viewRange(): [number, number] {
  return zoomRange.value ?? fullRange
}
function setView(a: number, span: number) {
  const [f0, f1] = fullRange
  if (span >= f1 - f0 - 60000) {
    zoomRange.value = null
  } else {
    span = Math.max(MIN_SPAN, span)
    a = Math.min(Math.max(a, f0), f1 - span)
    zoomRange.value = [a, a + span]
  }
  scheduleRender()
}
/** Nagyítás `center` (ms) körül: factor < 1 nagyít, > 1 kicsinyít; `base` a kiinduló nézet. */
function zoomAt(center: number, factor: number, base = viewRange()) {
  const [a, b] = base
  const span = Math.min(fullRange[1] - fullRange[0], Math.max(MIN_SPAN, (b - a) * factor))
  setView(center - (center - a) * (span / (b - a)), span)
}
function resetZoom() {
  zoomRange.value = null
  render()
}
/** Gyors nagyítás („Éjszaka” téma): az utolsó `hours` óra (ma a mostani időpontig, előtte a nap végéig). */
function zoomPreset(hours: number) {
  if (!hours) { resetZoom(); return }
  const span = hours * 3600000
  const end = Math.min(fullRange[1], Math.max(fullRange[0] + span, Math.min(Date.now() + 30 * 60000, props.day.dayEndMs)))
  setView(end - span, span)
}
const zoomHours = computed(() => {
  if (!zoomRange.value) return 0
  const h = Math.round((zoomRange.value[1] - zoomRange.value[0]) / 3600000)
  return [12, 6, 3].includes(h) ? h : -1
})
watch(() => props.day?.day, () => {
  zoomRange.value = null
  // Félbehagyott szenzorhiba-kijelölés nem nyúlhat át másik napra.
  if (pickMode.value) { pickMode.value = false; pickStart.value = null }
})
let rafId: ReturnType<typeof setTimeout> | 0 = 0
function scheduleRender() {
  if (rafId) return
  rafId = setTimeout(() => {
    rafId = 0
    render()
  }, 16)
}
/** Képernyő-x (a grafikon dobozához képest) → időpont, ms. */
function msAtX(x: number): number | null {
  const v = chart?.convertFromPixel({ xAxisIndex: 0 }, x)
  return Number.isFinite(v) ? v : null
}
const plotPx = () => Math.max(200, (chart?.getWidth?.() ?? el.value?.clientWidth ?? 800) - GRID_LEFT - GRID_RIGHT)
function onWheel(e: WheelEvent) {
  if (!e.ctrlKey || !chart || !el.value) return
  e.preventDefault()
  const c = msAtX(e.clientX - el.value.getBoundingClientRect().left)
  if (c != null) zoomAt(c, e.deltaY > 0 ? 1.25 : 0.8)
}
// Húzás (egér) nagyítva: mozgatás.
let drag: { x: number; view: [number, number]; moved: boolean } | null = null
function onMouseDown(e: MouseEvent) {
  if (!zoomRange.value || e.button !== 0) return
  drag = { x: e.clientX, view: zoomRange.value, moved: false }
}
function onMouseMove(e: MouseEvent) {
  if (!drag) return
  const dx = e.clientX - drag.x
  if (Math.abs(dx) > 3) drag.moved = true
  if (!drag.moved) return
  const span = drag.view[1] - drag.view[0]
  setView(drag.view[0] - (dx * span) / plotPx(), span)
}
function onMouseUp() { drag = null }
// Érintés: két ujjal csippentés (nagyítás), nagyítva egy ujjal vízszintes húzás (mozgatás); a függőleges húzás a lapot görgeti.
let touch: { d: number; cx: number; x: number; view: [number, number]; pinch: boolean } | null = null
function onTouchStart(e: TouchEvent) {
  if (!el.value) return
  const left = el.value.getBoundingClientRect().left
  if (e.touches.length === 2) {
    const [p, q] = [e.touches[0], e.touches[1]]
    const cx = msAtX((p.clientX + q.clientX) / 2 - left)
    touch = cx == null ? null : { d: Math.abs(p.clientX - q.clientX) || 1, cx, x: 0, view: viewRange(), pinch: true }
  } else if (e.touches.length === 1 && zoomRange.value) {
    touch = { d: 0, cx: 0, x: e.touches[0].clientX, view: zoomRange.value, pinch: false }
  }
}
function onTouchMove(e: TouchEvent) {
  if (!touch) return
  if (touch.pinch && e.touches.length === 2) {
    e.preventDefault()
    const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1
    zoomAt(touch.cx, touch.d / d, touch.view)
  } else if (!touch.pinch && e.touches.length === 1) {
    const span = touch.view[1] - touch.view[0]
    setView(touch.view[0] - ((e.touches[0].clientX - touch.x) * span) / plotPx(), span)
  }
}
function onTouchEnd(e: TouchEvent) {
  if (e.touches.length === 0) touch = null
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
  // Kizárt szenzorértékek (pl. ráfekvés): 15 percnél hosszabb szünetnél megszakadnak.
  const excludedG: [number, number | null][] = []
  ;((d.excludedGlucose ?? []) as [number, number][]).forEach((p, i, a) => {
    if (i > 0 && p[0] - a[i - 1][0] > 15 * 60000) excludedG.push([p[0] - 1, null])
    excludedG.push([p[0], p[1]])
  })
  const excludedAreas = ((d.excluded ?? []) as { from: number; to: number }[]).map((x) => [{ xAxis: x.from }, { xAxis: x.to }])
  // Kézzel felvitt vércukor (kézi mérés): rombusz jelölő, a görbétől külön.
  const manualG = ((d.manualGlucose ?? []) as [number, number][]).filter((p) => p[0] >= axisMin && p[0] <= axisMax)
  const gMax = [...d.glucose, ...manualG].reduce((m: number, p: [number, number]) => Math.max(m, p[1]), 0)

  // Kitöltés tartományonként, halmozott területként (alap + magasság):
  // a céltartomány fölött/benne a határtól a görbéig, alatta a görbétől az alsó határig.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const fills = rangeFills(r)
  // „Éjszaka” téma: kitöltés helyett halvány zónasávok a háttérben, és a vonal zónánként színezett.
  const night = document.documentElement.getAttribute('data-theme') === 'pastel-night'
  const zoneColors = { veryLow: cssToken('--status-critical'), low: '#f2a66b', inRange: cssToken('--status-good'), high: cssToken('--status-warning'), veryHigh: cssToken('--status-serious') }
  const fillSeries = night ? [] : (Object.entries(fills) as [string, { lo: number; hi: number; color: any }][]).flatMap(([key, b], bi) => {
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
  // Nagyítva a tengely a nagyított tartomány (a teljes tartományon belül).
  fullRange = [axisMin, axisMax]
  if (zoomRange.value && (zoomRange.value[0] < axisMin || zoomRange.value[1] > axisMax || zoomRange.value[1] - zoomRange.value[0] < MIN_SPAN)) zoomRange.value = null
  const [viewMin, viewMax] = zoomRange.value ?? [axisMin, axisMax]
  const viewSpan = viewMax - viewMin
  const msPerPx = viewSpan / plotWidth
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
  // A zsírosnak jelölt étkezés oszlopa halványabb, keretes; a zsíros és a gyors CH fölött ikon (🧀 / ⚡), mint a naplóban.
  const carryCarbs = ((d.absorption?.carbs ?? []) as [number, number, string | null][]).filter((x) => x[0] < d.dayStartMs)
  const tagIcon = (tag: string) => ({
    show: true, position: 'top', distance: 2, fontSize: 12,
    formatter: night ? (p: any) => `${CARB_TAG_ICON[tag as 'fatty' | 'fast']} ${num(p.value[1], 0)} g` : CARB_TAG_ICON[tag as 'fatty' | 'fast'],
    ...(night ? { fontSize: 10, fontWeight: 600, color: C.carbs } : {}),
  })
  const carbs = [...carryCarbs, ...d.carbs].map((p: any[]) => (p[2] === 'fatty'
    ? { value: [p[0], p[1]], itemStyle: { color: rgba(C.carbs, 0.35), borderColor: C.carbs, borderWidth: 1.5 }, label: tagIcon('fatty') }
    : p[2] === 'fast' ? { value: [p[0], p[1]], label: tagIcon('fast') }
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
                silent: true, symbol: 'none',
                // „Éjszaka” téma: a napszak célértéke felirattal.
                label: night ? { show: true, position: 'insideStartTop', fontSize: 10, color: C.muted, formatter: '{b}' } : { show: false },
                lineStyle: { color: C.muted, width: 1, type: [4, 4] },
                data: segs.map((x) => [{ coord: [x.from, x.target], name: `cél ${num(x.target, 1)}` }, { coord: [x.to, x.target] }]),
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
  // A skála az előző napról áthúzódó (még aktív) adagokat és CH-t is figyelembe veszi.
  const insMax = Math.ceil(Math.max(1, ...bolus.map((p: any[]) => p[1]), ...iobTotal.map((p) => p[1] ?? 0)) + 5)
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
  const carbMax = niceMax(Math.max(10, ...d.carbs.map((p: any[]) => p[1]), ...carryCarbs.map((p) => p[1])))
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
    // Az előző napról áthúzódó adag és CH is (a nap elején).
    const ins = [...carryDoses.map((p) => [p[0], p[1], p[3]]), ...d.insulin].filter((p: any[]) => Math.abs(p[0] - x) <= win)
    const ch = [...carryCarbs, ...d.carbs].filter((p: any[]) => Math.abs(p[0] - x) <= win)
    let html = `<div style="font-weight:600;margin-bottom:4px">${hm(x)}</div>`
    const sg = segmentAt(x)
    if (sg && !narrow) {
      html += `<div style="color:${C.muted};font-size:12px;margin-bottom:4px">${d.segments.byTimeOfDay ? `Napszak ${sg.start}–${sg.end}` : 'Egész nap'}: cél ${num(sg.target, 1)} · ISF ${num(sg.isf, 1)} · CH ${num(sg.icr, 1)} g/E</div>`
    }
    if (gNear !== null && gDiff <= 10 * 60000) {
      const col = gNear < r.low ? C.low : C.primary
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>Glükóz <b>${sgText(gNear)}</b> mmol/L</div>`
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
      html += `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C.carbs};margin-right:6px"></span>Szénhidrát <b>${num(p[1], 0)}</b> g${p[2] ? ` <span style="color:${C.muted}">· ${p[2] === 'fatty' ? `${CARB_TAG_ICON.fatty} zsíros / fehérjedús` : `${CARB_TAG_ICON.fast} gyors CH`}</span>` : ''}</div>`
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
    min: viewMin,
    max: viewMax,
    interval: viewSpan <= 3 * 3600000 ? 30 * 60000 : viewSpan <= 8 * 3600000 ? 3600000 : 2 * 3600000,
    axisLabel: { ...axisLabel, formatter: (v: number) => (viewSpan <= 3 * 3600000 ? hm(v) : hm(v).slice(0, 2)) },
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

  // „Éjszaka” téma: a mostani időpont után az aktív inzulin / CH lecsengése halványan, szaggatottan (várható),
  // az oszlopok fölött a mennyiség.
  const nowMs = Date.now()
  const nowLine = night && nowMs > viewMin && nowMs < viewMax ? nowMs : null
  const splitAtNow = (data: [number, number][]): [number, number][][] => {
    if (nowLine == null) return [data]
    const i = data.findIndex((p) => p[0] > nowLine)
    if (i <= 0) return i === 0 ? [[], data] : [data]
    const [a, b] = [data[i - 1], data[i]]
    const mid: [number, number] = [nowLine, a[1] + ((b[1] - a[1]) * (nowLine - a[0])) / (b[0] - a[0])]
    return [[...data.slice(0, i), mid], [mid, ...data.slice(i)]]
  }
  const withLabel = (s: any, color: string, unit: string) => (night
    ? { ...s, label: { show: true, position: 'top', distance: 2, fontSize: 10, fontWeight: 600, color, formatter: (p: any) => `${num(p.value[1], Number.isInteger(p.value[1]) ? 0 : 1)}${unit}` } }
    : s)
  // „Éjszaka” téma: az aktív inzulin és az aktív CH összesen, egy közös sávban (az oszlopok paneljein nincs görbe).
  const gridIdx = night ? [0, 1, 2, 3] : [0, 1, 2]
  const iobSum = iobTotal.filter((p): p is [number, number] => p[1] != null)
  const cobSum: [number, number][] = []
  if (night && ab) for (let x = axisMin; x <= axisMax; x += 5 * 60000) cobSum.push([x, Math.round(cobAtMs(x) * 10) / 10])
  const iobStripMax = niceMax(Math.max(1, ...iobSum.map((p) => p[1])))
  const cobStripMax = niceMax(Math.max(10, ...cobSum.map((p) => p[1])))
  const stripSeries = (name: string, yAxisIndex: number, data: [number, number][], color: string) =>
    splitAtNow(data).map((part, future) => ({
      name, type: 'line', xAxisIndex: 3, yAxisIndex, data: part, symbol: 'none', silent: true, z: 2,
      lineStyle: { width: IOB_LINE, color, ...(future ? { type: [4, 3], opacity: 0.7 } : {}) }, areaStyle: { color: rgba(color, future ? 0.08 : 0.3) },
    }))
  const stripTitle = {
    text: [
      '{a|Aktív inzulin és CH}',
      d.iobNow != null ? `{i|${num(d.iobNow, 1)} E}` : '',
      d.cobNow != null ? `{c|${num(d.cobNow, 0)} g}` : '',
    ].filter(Boolean).join('  '),
    left: GRID_LEFT - 2,
    top: 526,
    textStyle: { rich: {
      a: { color: C.primary, fontSize: 14, fontWeight: 600 },
      i: { color: C.insulin, fontSize: 12, fontWeight: 600 },
      c: { color: C.carbs, fontSize: 12, fontWeight: 600 },
    } },
  }

  const option: any = {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    title: [
      panelTitle('Glükóz', 'mmol/L', 4),
      panelTitle('Inzulin', 'E', 270),
      panelTitle('Szénhidrát', 'g', 398),
      ...(night ? [stripTitle] : []),
    ],
    grid: [
      { left: GRID_LEFT, right: GRID_RIGHT, top: 30, height: 208, outerBoundsMode: 'none' },
      { left: GRID_LEFT, right: GRID_RIGHT, top: 294, height: INS_HEIGHT, outerBoundsMode: 'none' },
      { left: GRID_LEFT, right: GRID_RIGHT, top: 422, height: 78, outerBoundsMode: 'none' },
      ...(night ? [{ left: GRID_LEFT, right: GRID_RIGHT, top: 552, height: 64, outerBoundsMode: 'none' }] : []),
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: C.axis } },
    tooltip: {
      trigger: 'axis', backgroundColor: C.tooltipBg, borderColor: C.border, borderWidth: 1,
      textStyle: { color: C.text, fontSize: narrow ? 11 : 13 }, padding: narrow ? [4, 7] : 10, formatter: fmtTooltip, axisPointer: { type: 'line' },
      confine: true,
      extraCssText: narrow ? 'max-width:58vw;white-space:normal;line-height:1.3;' : '',
    },
    xAxis: gridIdx.map(xAxisFor),
    yAxis: [
      { type: 'value', gridIndex: 0, min: 2, max: Math.max(16, Math.ceil(Math.max(gMax, ...forecast.value.map((p) => p[1])) + 1)), interval: 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 1, min: 0, max: insMax, interval: insMax / 2, axisLabel, splitLine, axisLine: { show: false } },
      { type: 'value', gridIndex: 2, min: 0, max: carbMax, interval: carbMax / 2, axisLabel, splitLine, axisLine: { show: false } },
      ...(night
        ? [
            { type: 'value', gridIndex: 3, min: 0, max: iobStripMax, interval: iobStripMax, axisLabel: { ...axisLabel, color: C.insulin, formatter: (v: number) => (v ? num(v, 0) + ' E' : '') }, splitLine, axisLine: { show: false } },
            { type: 'value', gridIndex: 3, min: 0, max: cobStripMax, interval: cobStripMax, axisLabel: { ...axisLabel, color: C.carbs, inside: true, verticalAlign: 'top', formatter: (v: number) => (v ? num(v, 0) + ' g' : '') }, splitLine: { show: false }, axisLine: { show: false }, position: 'left' },
          ]
        : []),
    ],
    series: [
      ...segmentSeries,
      ...(tailMs || headMs
        ? gridIdx.map((gi) => ({
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
      ...(night
        ? [{
            type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: [], silent: true, z: 1, tooltip: { show: false },
            markArea: {
              silent: true,
              data: ([[0, r.veryLow, zoneColors.veryLow, 0.16], [r.veryLow, r.low, zoneColors.low, 0.13], [r.low, r.high, zoneColors.inRange, 0.06], [r.high, r.veryHigh, zoneColors.high, 0.1], [r.veryHigh, 40, zoneColors.veryHigh, 0.12]] as [number, number, string, number][])
                .map(([a, b, color, op]) => [{ yAxis: a, itemStyle: { color: rgba(color, op) } }, { yAxis: b }]),
            },
          }]
        : []),
      {
        name: 'Glükóz', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: g, z: 4,
        ...(night ? { lineStyle: { width: 2.6 } } : { lineStyle: { width: 2, color: C.primary }, itemStyle: { color: C.primary } }),
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
      // Kizárt szenzorértékek (szürke, szaggatott) és a kizárt szakaszok sávja; kijelöléskor a választott kezdőpont.
      ...(excludedG.length
        ? [{
            name: 'Kizárt', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: excludedG, symbol: 'none', silent: true, z: 3,
            connectNulls: false, tooltip: { show: false }, lineStyle: { width: 1.5, type: [4, 3], color: rgba(C.muted, 0.8) },
          }]
        : []),
      ...(excludedAreas.length || pickStart.value != null
        ? [{
            type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: [], silent: true, z: 1, tooltip: { show: false },
            markArea: {
              silent: true,
              itemStyle: { color: rgba(C.muted, 0.14) },
              label: { show: true, position: 'insideTop', distance: 16, color: C.muted, fontSize: 10, formatter: 'kizárva' },
              data: excludedAreas,
            },
            ...(pickStart.value != null
              ? { markLine: { silent: true, symbol: 'none', label: { show: true, formatter: 'kezdet', color: C.low, fontSize: 10 }, lineStyle: { color: C.low, width: 1.5, type: [5, 4] }, data: [{ xAxis: pickStart.value }] } }
              : {}),
          }]
        : []),
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
      ...(night ? [] : curves).flatMap(({ kind, data }) => {
        const color = kind === 'correction' ? C.correction : C.insulin
        return splitAtNow(data).map((part, future) => ({
          name: 'Aktív inzulin', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: part, symbol: 'none', silent: true, z: 2,
          lineStyle: { width: IOB_LINE, color, ...(future ? { type: [4, 3], opacity: 0.7 } : {}) }, areaStyle: { color: rgba(color, future ? 0.05 : 0.12) },
        }))
      }),
      withLabel(bar('Bólus', 1, bolus.filter((p: any[]) => p[3] !== 'correction').map((p: any[]) => [p[0], p[1]]), C.insulin), C.insulin, ' E'),
      withLabel(bar('Korrekció', 1, bolus.filter((p: any[]) => p[3] === 'correction').map((p: any[]) => [p[0], p[1]]), C.correction), C.correction, ' E'),
      // A bázisnak nincs hatásgörbéje: csak egy pont az alapvonalon (a nagy adag nem húzza el a tengelyt).
      {
        name: 'Bázis', type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, data: basal.map((p: number[]) => [p[0], 0]), symbol: 'diamond', symbolSize: 12, z: 6, silent: true,
        itemStyle: { color: C.basal, borderColor: C.surface, borderWidth: 2 }, tooltip: { show: false }, clip: false,
      },
      ...(night ? [] : cobCurves).flatMap((data) => splitAtNow(data).map((part, future) => ({
        name: 'Aktív CH', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: part, symbol: 'none', silent: true, z: 2,
        lineStyle: { width: IOB_LINE, color: C.carbs, ...(future ? { type: [4, 3], opacity: 0.7 } : {}) }, areaStyle: { color: rgba(C.carbs, future ? 0.05 : 0.12) },
      }))),
      withLabel(bar('Szénhidrát', 2, carbs, C.carbs), C.carbs, ' g'),
      ...(night ? [...stripSeries('Aktív CH', 4, cobSum, C.carbs), ...stripSeries('Aktív inzulin', 3, iobSum, C.insulin)] : []),
      // „Most” vonal mindhárom panelen (csak az „Éjszaka” témában, ha a mostani idő a tengelyen van).
      ...(night && nowLine
        ? gridIdx.map((gi) => ({
            type: 'line', xAxisIndex: gi, yAxisIndex: gi, data: [], silent: true, z: 7, tooltip: { show: false },
            markLine: {
              silent: true, symbol: 'none', lineStyle: { color: rgba(C.primary, 0.35), width: 1, type: 'solid' },
              label: gi === 0 ? { show: true, position: 'end', formatter: 'most', color: C.text, fontSize: 10 } : { show: false },
              data: [{ xAxis: nowLine }],
            },
          }))
        : []),
    ],
  }
  if (night) {
    option.visualMap = {
      type: 'piecewise', show: false, dimension: 1, seriesIndex: option.series.findIndex((s: any) => s.name === 'Glükóz'),
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
  // A betöltés alatt a komponens eltűnhetett (pl. másik napra lapozás).
  if (!el.value) return
  if (!chart) {
    chart = echarts.init(el.value, null, { renderer: 'canvas', devicePixelRatio: Math.max(2, window.devicePixelRatio || 1) })
    // Szenzorhiba kijelölésekor a kattintás helye az időtengelyen.
    chart.getZr().on('click', (e: any) => {
      if (!pickMode.value || !chart) return
      const ms = chart.convertFromPixel({ xAxisIndex: 0 }, e.offsetX)
      if (Number.isFinite(ms)) onChartClick(ms)
    })
  }
  chart.setOption(buildOption(), true)
}

onMounted(async () => {
  try {
    const h = Number(localStorage.getItem('forecastHours') ?? 3)
    forecastHours.value = [0, 2, 3, 4].includes(h) ? h : 3
  } catch { /* nincs localStorage */ }
  await render()
  // A grafikonkönyvtár betöltése alatt a komponens eltűnhetett: ekkor már ne kössünk fel figyelőket.
  if (unmounted) return
  loadForecast()
  // Átméretezéskor újraszámoljuk az oszlopok eltolását is (pixelben értendő).
  ro = new ResizeObserver(() => {
    chart?.resize()
    render()
  })
  if (el.value) {
    ro.observe(el.value)
    el.value.addEventListener('wheel', onWheel, { passive: false })
    el.value.addEventListener('mousedown', onMouseDown)
    el.value.addEventListener('touchstart', onTouchStart, { passive: true })
    el.value.addEventListener('touchmove', onTouchMove, { passive: false })
    el.value.addEventListener('touchend', onTouchEnd)
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})
watch(() => props.day, loadForecast)
// Témaváltáskor újrarajzol (a színek a CSS-változókból jönnek).
watch(useState<number>('theme-tick', () => 0), () => { render() })
let unmounted = false
onBeforeUnmount(() => {
  unmounted = true
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  if (rafId) clearTimeout(rafId)
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
      <span class="lr-value">{{ sgText(last.v) }} <small>mmol/L</small></span>
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
    <div class="exclude-bar">
      <div class="segmented zoom-presets" role="group" aria-label="Nagyítás">
        <button v-for="h in [0, 12, 6, 3]" :key="h" type="button" :aria-pressed="zoomHours === h" @click="zoomPreset(h)">{{ h ? `${h} ó` : 'Teljes' }}</button>
      </div>
      <button v-if="zoomRange" type="button" class="ghost sm zoom-reset" @click="resetZoom">Teljes nap</button>
      <span v-else class="muted small zoom-hint">Nagyítás: Ctrl + görgő vagy csippentés</span>
    <template v-if="!readOnly">
      <template v-if="!pickMode">
        <button type="button" class="ghost sm" title="Pl. ráfekvés okozta hamis mély: a kijelölt szakasz szenzorértékei nem számítanak bele semmibe" @click="startPick">Szenzorhiba kijelölése</button>
      </template>
      <template v-else>
        <span class="small exclude-hint">{{ pickStart == null ? 'Kattints a grafikonon a hibás szakasz elejére…' : `Kezdet: ${hm(pickStart)}. Most kattints a végére…` }}</span>
        <button type="button" class="ghost sm" @click="cancelPick">Mégse</button>
      </template>
      <span v-for="x in day.excluded ?? []" :key="x.id" class="exclude-chip small">
        Kizárva {{ hm(x.from) }}–{{ hm(x.to) }}
        <button type="button" class="link-btn" :aria-label="`Kizárás visszavonása ${hm(x.from)}–${hm(x.to)}`" title="Visszavonás" @click="removeExcluded(x)">×</button>
      </span>
    </template>
    </div>
    <div ref="el" class="chart-box" :class="{ picking: pickMode, zoomed: !!zoomRange }" />
  </div>
</template>
