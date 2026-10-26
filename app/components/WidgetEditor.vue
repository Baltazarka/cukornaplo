<script setup lang="ts">
// A telefonos widget kinézetének szerkesztője élő előnézettel. A beállítások a szerveren tárolódnak,
// a widget minden frissítéskor lekéri őket (a telefonon a szkriptet nem kell újra beilleszteni).
const { data, refresh } = await useFetch<any>('/api/widget-config', { key: 'widget-config' })

// Minden elem mindig látszik: csak a vonal hossza, a betűméret és a színek állíthatók.
const ALL = { showTrend: true, showCob: true, showIob: true, showLine: true, showRange: true, showAge: true }
const form = reactive<WidgetConfig>(sanitizeWidgetConfig(null))
watch(() => data.value?.config, (c) => { if (c) Object.assign(form, JSON.parse(JSON.stringify(c))) }, { immediate: true })

// Az előnézet adata: a valós mostani adat, vagy egy minta a színek kipróbálásához.
type SampleKind = 'real' | 'in' | 'low' | 'high'
const sample = ref<SampleKind>('real')
const SAMPLE_BUTTONS: [SampleKind, string][] = [['real', 'Valós adat'], ['in', 'Rendben'], ['low', 'Alacsony'], ['high', 'Magas']]
const LINE_OPTIONS = [1, 3, 6] as const
const COLOR_FIELDS: [keyof WidgetConfig['colors'], string][] = [
  ['inRange', 'Célban'], ['low', 'Alacsony'], ['high', 'Magas'], ['cob', 'Aktív CH'], ['iob', 'Aktív inzulin'], ['bg', 'Háttér'],
]
const SAMPLES = { in: [6.4, 0], low: [3.6, -1], high: [12.1, 1] } as const
// Mintajavaslat: alacsonynál szénhidrát, magasnál inzulin (a valós adatnál a szerver számolja).
const SAMPLE_SUGGEST = { in: { insulin: null, carbs: null }, low: { insulin: null, carbs: 15 }, high: { insulin: 2.5, carbs: null } } as const
function sampleData(kind: 'in' | 'low' | 'high') {
  const [v, dir] = SAMPLES[kind]
  const series: [number, number][] = []
  for (let m = 360; m >= 0; m -= 5) series.push([m, Math.round((v - dir * (m / 360) * 2.2 + Math.sin(m / 40) * 0.6) * 10) / 10])
  return {
    glucose: { v, ageMin: 2 }, trend: { dir, level: dir === 0 ? 0 : 2 }, iob: 1.8, cob: 14, suggest: SAMPLE_SUGGEST[kind],
    range: data.value?.data?.range ?? { low: 3.9, high: 10 }, series,
  }
}
const d = computed<any>(() => (sample.value === 'real' ? data.value?.data : sampleData(sample.value)))
// Friss valós érték nélkül (pl. szenzorcsere) az előnézet magától a „rendben” mintát mutatja.
watch(() => data.value?.data?.glucose, (g) => { if (!g && sample.value === 'real') sample.value = 'in' }, { immediate: true })
// Javaslat az előnézetben: ha van, ezt mutatjuk (a telefonon frissítésenként váltakozik az aktív értékekkel).
const sug = computed(() => {
  const s = d.value?.suggest
  return s && (s.insulin || s.carbs) ? s : null
})

// A mérés időpontja óra:perc alakban (a widget alján).
const measuredAt = computed(() => new Date(Date.now() - (d.value?.glucose?.ageMin ?? 0) * 60000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }))
const fmt = (v: number) => v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const glucoseColor = computed(() => {
  const g = d.value?.glucose?.v
  const c = form.colors
  return g == null ? c.inRange : g < d.value.range.low ? c.low : g > d.value.range.high ? c.high : c.inRange
})

/** Trendvonal SVG: a célsáv és a görbe a beállított órákra. */
function line(w: number, h: number, color: string) {
  const pts: [number, number][] = (d.value?.series ?? []).filter((p: [number, number]) => p[0] <= form.lineHours * 60)
  if (pts.length < 2) return null
  const perc = form.lineHours * 60
  const vals = pts.map((p) => p[1])
  const lo = Math.min(d.value.range.low - 0.5, ...vals)
  const hi = Math.max(d.value.range.high + 0.5, ...vals)
  const lw = Math.round(w / 45) // vonalvastagság a rajzfelülethez arányosan
  const kt = lw // kis tartalék a jobb szélen, hogy az utolsó pont ne csússzon ki
  const x = (m: number) => w - kt - (m / perc) * (w - kt)
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h
  const last = pts[pts.length - 1]
  return {
    path: pts.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)} ${y(v).toFixed(1)}`).join(' '),
    band: { y: y(d.value.range.high), h: Math.max(y(d.value.range.low) - y(d.value.range.high), 0) },
    dot: { x: x(last[0]), y: y(last[1]) },
    lw,
    color,
  }
}
const smallLine = computed(() => line(268, 88, glucoseColor.value))
const lockLine = computed(() => line(300, 52, '#ffffff'))

const msg = ref('')
const err = ref<string[]>([])
useToastFrom(msg, 'success')
useToastFrom(err, 'error')
const busy = ref(false)
async function save() {
  busy.value = true
  msg.value = ''
  err.value = []
  try {
    await $fetch('/api/widget-config', { method: 'POST', body: { config: JSON.parse(JSON.stringify(form)) } })
    await refresh()
    msg.value = 'Mentve. A widget a következő frissítéskor átveszi.'
  } catch (e: any) {
    err.value = [e?.data?.error ?? 'A mentés nem sikerült.']
  } finally {
    busy.value = false
  }
}
async function reset() {
  busy.value = true
  msg.value = ''
  err.value = []
  try {
    await $fetch('/api/widget-config', { method: 'POST', body: { reset: true } })
    await refresh()
    msg.value = 'Visszaállítva az alapértelmezettre.'
  } catch {
    err.value = ['A visszaállítás nem sikerült.']
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="wg-editor">
    <h3>Kinézet és előnézet</h3>
    <div class="wg-grid">
      <div class="wg-preview">
        <!-- Előnézet egy telefonos háttéren: kezdőképernyő (kicsi) és zárképernyő (téglalap) egymás mellett. -->
        <div class="wg-stage">
          <p v-if="!d?.glucose" class="wg-empty">Nincs friss érték. Válassz lent egy mintát.</p>
          <template v-else>
            <figure class="wg-fig">
              <div class="wg-small" :style="{ background: form.colors.bg }">
                <div class="wg-top">
                  <div class="wg-glu" :style="{ color: glucoseColor }">
                    <span :style="{ fontSize: form.fontSize + 'px' }">{{ sgText(d.glucose.v) }}</span><span v-if="ALL.showTrend" :style="{ fontSize: Math.round(form.fontSize * 0.6) + 'px' }">&nbsp;{{ widgetArrow(d.trend) }}</span>
                  </div>
                  <div v-if="sug" class="wg-side">
                    <span v-if="sug.carbs" :style="{ color: form.colors.cob }"><span class="wg-ico">🍗</span> {{ sug.carbs }} g</span>
                    <span v-if="sug.insulin" :style="{ color: form.colors.iob }"><svg class="wg-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.3 1.3l3.4 3.4-1 1-1-1-1.1 1.1 1 1-6.2 6.2H3.6l-1.9 1.9-.9-.9 1.9-1.9V9.3l6.2-6.2 1 1L11 3l-1-1 1.3-.7zM8.9 5.1L4.4 9.6l1.9 1.9 4.5-4.5-1.9-1.9z" /></svg> {{ widgetIob(sug.insulin) }} E</span>
                  </div>
                  <div v-else-if="ALL.showCob || ALL.showIob" class="wg-side">
                    <span v-if="ALL.showCob" :style="{ color: form.colors.cob }">CH {{ d.cob }} g</span>
                    <span v-if="ALL.showIob" :style="{ color: form.colors.iob }">B {{ widgetIob(d.iob) }} E</span>
                  </div>
                </div>
                <svg v-if="ALL.showLine && smallLine" class="wg-line" viewBox="0 0 268 88" aria-hidden="true">
                  <rect v-if="ALL.showRange" x="0" :y="smallLine.band.y" width="268" :height="smallLine.band.h" fill="#ffffff" fill-opacity="0.1" />
                  <path :d="smallLine.path" fill="none" :stroke="smallLine.color" :stroke-width="smallLine.lw" stroke-linejoin="round" />
                  <circle :cx="smallLine.dot.x" :cy="smallLine.dot.y" :r="smallLine.lw * 1.3" :fill="smallLine.color" />
                </svg>
                <div class="wg-age">mmol/L · {{ measuredAt }}</div>
              </div>
              <figcaption>Kezdőképernyő</figcaption>
            </figure>
            <figure class="wg-fig">
              <div class="wg-lock">
                <div class="wg-lock-row">
                  <span class="wg-lock-gw"><b class="wg-lock-g">{{ sgText(d.glucose.v) }}<template v-if="ALL.showTrend"> {{ widgetArrow(d.trend) }}</template></b><small>mmol/L</small></span>
                  <span v-if="sug" class="wg-lock-side">
                    <b v-if="sug.carbs">🍗 {{ sug.carbs }} g</b>
                    <b v-if="sug.insulin">💉 {{ widgetIob(sug.insulin) }} E</b>
                  </span>
                  <span v-else-if="ALL.showCob || ALL.showIob" class="wg-lock-side">
                    <b v-if="ALL.showCob">CH {{ d.cob }} g</b>
                    <b v-if="ALL.showIob">B {{ widgetIob(d.iob) }} E</b>
                  </span>
                </div>
                <svg v-if="ALL.showLine && lockLine" class="wg-line" viewBox="0 0 300 52" aria-hidden="true">
                  <rect v-if="ALL.showRange" x="0" :y="lockLine.band.y" width="300" :height="lockLine.band.h" fill="#ffffff" fill-opacity="0.18" />
                  <path :d="lockLine.path" fill="none" stroke="#ffffff" :stroke-width="lockLine.lw" stroke-linejoin="round" />
                  <circle :cx="lockLine.dot.x" :cy="lockLine.dot.y" :r="lockLine.lw * 1.3" fill="#ffffff" />
                </svg>
              </div>
              <figcaption>Zárképernyő (a színeket az iOS adja)</figcaption>
            </figure>
          </template>
        </div>
        <div class="wg-sample-row">
          <span class="wg-label">Előnézet</span>
          <div class="segmented" role="group" aria-label="Előnézet adata">
            <button v-for="o in SAMPLE_BUTTONS" :key="o[0]" type="button" :aria-pressed="sample === o[0]" @click="sample = o[0]">{{ o[1] }}</button>
          </div>
        </div>
        <p v-if="sug" class="muted small">
          Javaslat: {{ sug.insulin ? `${widgetIob(sug.insulin)} E inzulin (magas cukor)` : `${sug.carbs} g szénhidrát (hipó-veszély)` }}. Ha közben
          aktív inzulin vagy CH is van, a widget frissítésenként váltakozva mutatja azokat is.
        </p>
      </div>

      <form class="wg-form" @submit.prevent="save">
        <div class="wg-field">
          <span class="wg-label">Vonal hossza</span>
          <div class="segmented" role="group" aria-label="Vonal hossza">
            <button v-for="h in LINE_OPTIONS" :key="h" type="button" :aria-pressed="form.lineHours === h" @click="form.lineHours = h">{{ h }} óra</button>
          </div>
        </div>
        <label class="wg-field">
          <span class="wg-label">Vércukor betűmérete <b>{{ form.fontSize }}</b></span>
          <input v-model.number="form.fontSize" type="range" :min="WIDGET_FONT.min" :max="WIDGET_FONT.max" step="1">
        </label>
        <div class="wg-field">
          <span class="wg-label">Színek (kezdőképernyő)</span>
          <div class="wg-colors">
            <label v-for="[k, label] in COLOR_FIELDS" :key="k" class="wg-color">
              <input v-model="form.colors[k]" type="color" :aria-label="label">
              <span class="wg-color-name">{{ label }}</span>
              <code>{{ form.colors[k] }}</code>
            </label>
          </div>
        </div>
        <div class="btn-row">
          <button type="submit" :disabled="busy">Mentés</button>
          <button type="button" class="ghost" :disabled="busy" @click="reset">Alapértelmezett</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.wg-editor { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
.wg-editor h3 { margin: 0 0 12px; font-size: 15px; }
.wg-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; align-items: start; }
@media (max-width: 760px) { .wg-grid { grid-template-columns: minmax(0, 1fr); } }
.wg-preview { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

/* Telefonos háttér (a téma nem változtatja: a widget a telefonon is ilyen környezetben látszik). */
.wg-stage {
  display: flex; flex-wrap: wrap; gap: 18px; justify-content: center; align-items: flex-start;
  padding: 20px 16px; border-radius: 16px; min-height: 200px;
  background: linear-gradient(145deg, #4b5d86 0%, #2b3550 55%, #1a1f2e 100%);
}
.wg-empty { margin: auto; color: #dfe5f2; font-size: 13px; text-align: center; }
.wg-fig { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.wg-fig figcaption { font-size: 11px; color: #c9d2e6; }

.wg-small {
  width: 158px; height: 158px; border-radius: 22px; padding: 10px 12px; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: space-between; font-family: -apple-system, system-ui, sans-serif;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.wg-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; }
.wg-glu { font-weight: 700; line-height: 1; white-space: nowrap; }
.wg-side { display: flex; flex-direction: column; gap: 2px; font-weight: 700; font-size: 12px; text-align: right; white-space: nowrap; }
.wg-line { display: block; width: 100%; height: auto; }
.wg-age { font-size: 10px; color: #8a93a3; }
.wg-ico { display: inline-block; width: 12px; height: 12px; font-size: 11px; vertical-align: -1px; }
.wg-lock {
  width: 170px; padding: 8px 10px; border-radius: 16px; color: #fff; box-sizing: border-box;
  background: rgba(255, 255, 255, 0.16); backdrop-filter: blur(8px); font-family: -apple-system, system-ui, sans-serif;
}
.wg-lock-row { display: flex; justify-content: space-between; align-items: center; }
.wg-lock-gw { display: flex; flex-direction: column; }
.wg-lock-gw small { font-size: 9px; }
.wg-lock-g { font-size: 22px; white-space: nowrap; }
.wg-lock-side { display: flex; flex-direction: column; font-size: 12px; text-align: right; }

.wg-sample-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.wg-label { font-size: 13px; color: var(--text-secondary); }
.wg-label b { color: var(--text-primary); }

.wg-form { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.wg-field { display: flex; flex-direction: column; gap: 8px; }
.wg-field input[type='range'] { width: 100%; accent-color: var(--accent); }
.wg-colors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
@media (max-width: 420px) { .wg-colors { grid-template-columns: minmax(0, 1fr); } }
.wg-color {
  display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-2); cursor: pointer; min-width: 0;
}
.wg-color:hover { border-color: var(--axis); }
.wg-color-name { flex: 1; font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wg-color code { font-size: 11px; color: var(--text-muted); }
/* Kerek színminta a böngésző alapértelmezett, szögletes színválasztója helyett. */
.wg-color input[type='color'] {
  -webkit-appearance: none; appearance: none; flex: none; width: 26px; height: 26px; padding: 0; border: 1px solid var(--border);
  border-radius: 50%; background: none; cursor: pointer;
}
.wg-color input[type='color']::-webkit-color-swatch-wrapper { padding: 0; }
.wg-color input[type='color']::-webkit-color-swatch { border: 0; border-radius: 50%; }
.wg-color input[type='color']::-moz-color-swatch { border: 0; border-radius: 50%; }
</style>
