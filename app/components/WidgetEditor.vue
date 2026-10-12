<script setup lang="ts">
// A telefonos widget kinézetének szerkesztője élő előnézettel. A beállítások a szerveren tárolódnak,
// a widget minden frissítéskor lekéri őket (a telefonon a szkriptet nem kell újra beilleszteni).
const { data, refresh } = await useFetch<any>('/api/widget-config', { key: 'widget-config' })

const form = reactive<WidgetConfig>(sanitizeWidgetConfig(null))
watch(() => data.value?.config, (c) => { if (c) Object.assign(form, JSON.parse(JSON.stringify(c))) }, { immediate: true })

// Az előnézet adata: a valós mostani adat, vagy egy minta a színek kipróbálásához.
type SampleKind = 'real' | 'in' | 'low' | 'high'
const sample = ref<SampleKind>('real')
const SAMPLE_BUTTONS: [SampleKind, string][] = [['real', 'Valós adat'], ['in', 'Minta: rendben'], ['low', 'Minta: alacsony'], ['high', 'Minta: magas']]
const SAMPLES = { in: [6.4, 0], low: [3.6, -1], high: [12.1, 1] } as const
function sampleData(kind: 'in' | 'low' | 'high') {
  const [v, dir] = SAMPLES[kind]
  const series: [number, number][] = []
  for (let m = 360; m >= 0; m -= 5) series.push([m, Math.round((v - dir * (m / 360) * 2.2 + Math.sin(m / 40) * 0.6) * 10) / 10])
  return {
    glucose: { v, ageMin: 2 }, trend: { dir, level: dir === 0 ? 0 : 2 }, iob: 1.8, cob: 14,
    range: data.value?.data?.range ?? { low: 3.9, high: 10 }, series,
  }
}
const d = computed<any>(() => (sample.value === 'real' ? data.value?.data : sampleData(sample.value)))

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
  const kt = 5 // kis tartalék a jobb szélen, hogy az utolsó pont ne csússzon ki
  const x = (m: number) => w - kt - (m / perc) * (w - kt)
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h
  const last = pts[pts.length - 1]
  return {
    path: pts.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)} ${y(v).toFixed(1)}`).join(' '),
    band: { y: y(d.value.range.high), h: Math.max(y(d.value.range.low) - y(d.value.range.high), 0) },
    dot: { x: x(last[0]), y: y(last[1]) },
    color,
  }
}
const smallLine = computed(() => line(128, 44, glucoseColor.value))
const lockLine = computed(() => line(140, 22, '#ffffff'))

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
        <div class="btn-row wg-samples" role="group" aria-label="Előnézet adata">
          <button v-for="o in SAMPLE_BUTTONS" :key="o[0]" type="button" class="sm" :class="{ ghost: sample !== o[0] }" @click="sample = o[0]">{{ o[1] }}</button>
        </div>
        <p v-if="!d?.glucose" class="muted small">Nincs friss érték, válassz mintát.</p>
        <template v-else>
          <div class="muted small">Kezdőképernyő (kicsi)</div>
          <div class="wg-small" :style="{ background: form.colors.bg }">
            <div class="wg-top">
              <div class="wg-glu" :style="{ color: glucoseColor }">
                <span :style="{ fontSize: form.fontSize + 'px' }">{{ fmt(d.glucose.v) }}</span><span v-if="form.showTrend" :style="{ fontSize: Math.round(form.fontSize * 0.74) + 'px' }">&nbsp;{{ widgetArrow(d.trend) }}</span>
              </div>
              <div v-if="form.showCob || form.showIob" class="wg-side">
                <span v-if="form.showCob" :style="{ color: form.colors.cob }">CH {{ d.cob }} g</span>
                <span v-if="form.showIob" :style="{ color: form.colors.iob }">B {{ widgetIob(d.iob) }} E</span>
              </div>
            </div>
            <svg v-if="form.showLine && smallLine" class="wg-line" width="128" height="44" viewBox="0 0 128 44" aria-hidden="true">
              <rect v-if="form.showRange" x="0" :y="smallLine.band.y" width="128" :height="smallLine.band.h" fill="#ffffff" fill-opacity="0.1" />
              <path :d="smallLine.path" fill="none" :stroke="smallLine.color" stroke-width="2" stroke-linejoin="round" />
              <circle :cx="smallLine.dot.x" :cy="smallLine.dot.y" r="3" :fill="smallLine.color" />
            </svg>
            <div class="wg-age" :style="{ color: form.showAge && d.glucose.ageMin > 15 ? form.colors.high : '#8a93a3' }">mmol/L<template v-if="form.showAge"> · {{ d.glucose.ageMin }} perce</template></div>
          </div>
          <div class="muted small">Zárképernyő (téglalap; a színeket az iOS adja)</div>
          <div class="wg-lock">
            <div class="wg-lock-row">
              <span class="wg-lock-gw"><b class="wg-lock-g">{{ fmt(d.glucose.v) }}<template v-if="form.showTrend"> {{ widgetArrow(d.trend) }}</template></b><small>mmol/L</small></span>
              <span v-if="form.showCob || form.showIob" class="wg-lock-side">
                <b v-if="form.showCob">CH {{ d.cob }} g</b>
                <b v-if="form.showIob">B {{ widgetIob(d.iob) }} E</b>
              </span>
            </div>
            <svg v-if="form.showLine && lockLine" width="140" height="22" viewBox="0 0 140 22" aria-hidden="true">
              <rect v-if="form.showRange" x="0" :y="lockLine.band.y" width="140" :height="lockLine.band.h" fill="#ffffff" fill-opacity="0.18" />
              <path :d="lockLine.path" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
              <circle :cx="lockLine.dot.x" :cy="lockLine.dot.y" r="2.5" fill="#ffffff" />
            </svg>
          </div>
        </template>
      </div>

      <form class="wg-form" @submit.prevent="save">
        <fieldset>
          <legend>Elemek</legend>
          <label class="check"><input v-model="form.showTrend" type="checkbox"> Trendnyíl</label>
          <label class="check"><input v-model="form.showCob" type="checkbox"> Aktív szénhidrát (CH)</label>
          <label class="check"><input v-model="form.showIob" type="checkbox"> Aktív inzulin (B)</label>
          <label class="check"><input v-model="form.showLine" type="checkbox"> Trendvonal</label>
          <label class="check"><input v-model="form.showRange" type="checkbox" :disabled="!form.showLine"> Célsáv a vonalon</label>
          <label class="check"><input v-model="form.showAge" type="checkbox"> „x perce” felirat</label>
        </fieldset>
        <fieldset>
          <legend>Méret és koppintás</legend>
          <label>Vonal hossza
            <select v-model.number="form.lineHours">
              <option :value="1">1 óra</option>
              <option :value="3">3 óra</option>
              <option :value="6">6 óra</option>
            </select>
          </label>
          <label>Vércukor betűmérete: {{ form.fontSize }}
            <input v-model.number="form.fontSize" type="range" :min="WIDGET_FONT.min" :max="WIDGET_FONT.max" step="1">
          </label>
          <label>Koppintásra megnyílik
            <select v-model="form.tap">
              <option v-for="(label, k) in WIDGET_TAP_LABELS" :key="k" :value="k">{{ label }}</option>
            </select>
          </label>
        </fieldset>
        <fieldset class="wg-colors">
          <legend>Színek (kezdőképernyő)</legend>
          <label>Cél <input v-model="form.colors.inRange" type="color"></label>
          <label>Alacsony <input v-model="form.colors.low" type="color"></label>
          <label>Magas <input v-model="form.colors.high" type="color"></label>
          <label>CH <input v-model="form.colors.cob" type="color"></label>
          <label>B <input v-model="form.colors.iob" type="color"></label>
          <label>Háttér <input v-model="form.colors.bg" type="color"></label>
        </fieldset>
        <div class="btn-row">
          <button type="submit" :disabled="busy">Mentés</button>
          <button type="button" class="ghost" :disabled="busy" @click="reset">Alapértelmezett</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.wg-editor { margin-top: 16px; }
.wg-grid { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 700px) { .wg-grid { grid-template-columns: minmax(0, 1fr); } }
.wg-preview { display: flex; flex-direction: column; gap: 8px; }
.wg-samples { flex-wrap: wrap; gap: 6px; }
.wg-small {
  width: 158px; height: 158px; border-radius: 22px; padding: 10px 12px; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: space-between; font-family: -apple-system, system-ui, sans-serif;
}
.wg-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; }
.wg-glu { font-weight: 700; line-height: 1; white-space: nowrap; }
.wg-side { display: flex; flex-direction: column; gap: 2px; font-weight: 700; font-size: 15px; text-align: right; white-space: nowrap; }
.wg-line { display: block; }
.wg-age { font-size: 10px; }
.wg-lock {
  width: 170px; padding: 8px 10px; border-radius: 14px; background: #2a2d34; color: #fff; box-sizing: border-box;
  font-family: -apple-system, system-ui, sans-serif;
}
.wg-lock-row { display: flex; justify-content: space-between; align-items: center; }
.wg-lock-gw { display: flex; flex-direction: column; }
.wg-lock-gw small { font-size: 9px; }
.wg-lock-g { font-size: 22px; white-space: nowrap; }
.wg-lock-side { display: flex; flex-direction: column; font-size: 12px; text-align: right; }
.wg-form { display: flex; flex-direction: column; gap: 12px; }
.wg-form fieldset { border: 1px solid var(--border); border-radius: 8px; margin: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; }
.wg-form fieldset.wg-colors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
.wg-colors legend { grid-column: 1 / -1; }
.wg-form label.check, .wg-colors label { flex-direction: row; align-items: center; gap: 8px; }
.wg-form input[type='checkbox'] { width: auto; flex: none; }
.wg-colors input[type='color'] { width: 40px; height: 28px; padding: 0; }
</style>
