<script setup lang="ts">
// Terápia oldal: a szénhidrát felszívódása a tiszta étkezéseidből (étkezés + inzulin, korrekció és ráétkezés
// nélkül), kategóriánként. Az előrejelzés és az aktív CH ezt használja. Amíg egy kategóriához kevés az adat,
// az alapértelmezett érvényes: óránként felszívódó gramm (g/óra), ívelt alakkal; a nagyobb étkezés tovább tart.
const { data, refresh } = await useFetch<any>('/api/analysis', { query: { days: 60 }, key: 'analysis-60-absorption' })
const abs = computed(() => data.value?.absorption)

const { data: defs, refresh: refreshDefs } = await useFetch<any>('/api/absorption/defaults', { key: 'absorb-defaults' })
const BASE = [
  { key: 'normal', label: 'Normál étkezés', hint: 'sima szénhidrát' },
  { key: 'fatty', label: 'Zsíros / fehérjedús', hint: 'lassabb, később emel' },
  { key: 'fast', label: 'Gyors CH', hint: 'pl. hipó kezelése, üdítő' },
] as const
type Key = (typeof BASE)[number]['key']
const FALLBACK: Record<Key, number> = { normal: 20, fatty: 12, fast: 30 }
const CATS = computed(() => BASE.map((c) => ({ ...c, rate: defs.value?.values?.[c.key] ?? FALLBACK[c.key] })))
type Cat = { key: Key; label: string; hint: string; rate: number }

const form = reactive<Record<Key, number>>({ normal: 20, fatty: 12, fast: 30 })
watchEffect(() => { if (defs.value?.values) Object.assign(form, defs.value.values) })
const saving = ref(false)
const msg = ref('')
const errs = ref<string[]>([])
useToastFrom(msg, 'success')
useToastFrom(errs, 'error')
async function saveDefs(reset = false) {
  saving.value = true
  msg.value = ''
  errs.value = []
  try {
    await $fetch('/api/absorption/defaults', { method: 'POST', body: reset ? {} : { ...form } })
    await refreshDefs()
    await refreshNuxtData('analysis-60-absorption')
    msg.value = reset ? 'Visszaállítva a gyári értékekre.' : 'Mentve.'
  } catch (e: any) {
    errs.value = e?.data?.errors ?? ['A mentés nem sikerült.']
  } finally {
    saving.value = false
  }
}
const MIN = 3
const GOOD = 5
const pct = (n: number) => `${Math.min(100, (100 * n) / GOOD)}%`
const count = (n: number) => (n >= GOOD ? `${n} ✓` : `${n}/${GOOD}`)
const quality = (n: number) => (n >= GOOD ? 'megbízható' : n >= MIN ? 'előzetes' : `még ${MIN - n} kell a használathoz`)

// Szemléltető étkezésméret: a görbék és az óránkénti táblázat erre vonatkoznak.
const REF_GRAMS = 50
const MAX_MIN = 480 // a rajz és a táblázat időtartama
const dfltFrac = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x))
/** Az alapértelmezett teljes felszívódási idő a szemléltető étkezésre, perc (gramm ÷ g/óra, 45–480 perc). */
const totalMin = (c: Cat) => Math.min(480, Math.max(45, (REF_GRAMS / c.rate) * 60))
const learnedOf = (c: Cat) => {
  const a = abs.value?.[c.key]
  return a?.usable && a.profile && a.refGrams ? a : null
}
/** A tanult görbe nyújtása a szemléltető étkezésre (mint a szerveren: a tanuló étkezések méretéhez képest, ±2x). */
const scale = (ref: number) => Math.min(2, Math.max(0.5, REF_GRAMS / ref))
/** A felszívódott arány `m` perccel az étkezés után, a szemléltető étkezésre. */
const fraction = (c: Cat, m: number) => {
  const l = learnedOf(c)
  if (!l) return dfltFrac(m / totalMin(c))
  const x = m / scale(l.refGrams) / 15
  if (x >= l.profile.length - 1) return 1
  const i = Math.floor(x)
  return l.profile[i] + (l.profile[i + 1] - l.profile[i]) * (x - i)
}

const W = 240
const H = 64
const px = (m: number) => (m / MAX_MIN) * W
const py = (v: number) => H - v * H
const STEPS = Array.from({ length: MAX_MIN / 15 + 1 }, (_, i) => i * 15)
const curve = (c: Cat, learned: boolean) =>
  STEPS.map((m) => {
    const v = learned ? fraction(c, m) : dfltFrac(m / totalMin(c))
    return `${px(m).toFixed(1)},${py(v).toFixed(1)}`
  }).join(' ')

const HOURS = Array.from({ length: MAX_MIN / 60 }, (_, i) => i)
const perHour = (c: Cat, h: number) => Math.max(0, fraction(c, 60 * (h + 1)) - fraction(c, 60 * h))
const lastHour = computed(() => Math.max(...CATS.value.map((c) => HOURS.filter((h) => perHour(c, h) >= 0.005).pop() ?? 0)))
/** Az óra elején már (szinte) teljesen felszívódott: „–”; különben a gramm (a köztes kis érték 0 vagy <1 g is lehet). */
const done = (c: Cat, h: number) => fraction(c, 60 * h) >= 0.995
const cell = (c: Cat, h: number) => {
  if (done(c, h)) return '–'
  const g = perHour(c, h) * REF_GRAMS
  return g > 0 && g < 0.5 ? '<1 g' : `${Math.round(g)} g`
}
const cellPct = (c: Cat, h: number) => (done(c, h) || perHour(c, h) < 0.005 ? '' : `${Math.round(perHour(c, h) * 100)}%`)
const min = (v: number | null | undefined) => (v == null ? '–' : `${v} perc`)

/**
 * A tanult görbének megfelelő ütem (g/óra): az ívelt alapértelmezett alak a teljes idő felénél tart 50%-on és 77,6%-ánál
 * 90%-on; a tanult fél- és 90%-os időből így két becslés jön a teljes időre, ezek átlagából gramm ÷ idő.
 */
const learnedRate = (c: Cat): number | null => {
  const l = learnedOf(c)
  if (!l?.t50 || !l?.t90 || !l.refGrams) return null
  const total = (2 * l.t50 + l.t90 / 0.776) / 2
  const lo = defs.value?.limits?.min ?? 5
  const hi = defs.value?.limits?.max ?? 120
  return Math.min(hi, Math.max(lo, Math.round((l.refGrams * 60) / total)))
}
const anyLearned = computed(() => CATS.value.some((c) => learnedRate(c) != null))
/** A tanult ütemek beírása a mezőkbe (menteni külön kell). */
function takeLearned() {
  for (const c of CATS.value) {
    const r = learnedRate(c)
    if (r != null) form[c.key] = r
  }
  msg.value = ''
  msg.value = 'Beírtam az adataidból kijött ütemeket. Nézd át, és ha jó, mentsd.'
}
const hours = (m: number) => (m / 60).toLocaleString('hu-HU', { maximumFractionDigits: 1 })
</script>

<template>
  <section v-if="abs" class="card absorb-card">
    <h2>Szénhidrát-felszívódás az adataidból</h2>
    <RecomputeBar :at="data?.computedAt" kind="analysis" :days="60" @done="refresh()" />
    <p class="muted small">Kategóriánként legalább {{ MIN }} tiszta étkezés kell a használathoz, {{ GOOD }} a megbízhatóhoz; addig az alapértelmezett érvényes (utolsó 60 nap).</p>
    <details class="more">
      <summary>Hogyan számol?</summary>
      <p class="muted small">
      A tiszta étkezésekből (étkezés és inzulin, korrekció vagy ráétkezés nélkül) kiszámolja, milyen ütemben szívódik fel a szénhidrát nálad.
      Az inzulin hatását levonja a vércukor-változásból, és ami marad, az a szénhidrát hatása. Az előrejelzés és az aktív CH ezt használja.
      Tiszta az étkezés, ha szénhidrát és inzulin volt, és utána a felszívódás végéig (a várható felszívódási idő másfélszerese, de legalább
      1,5 óra gyorsnál, 2 óra normálnál, 4 óra zsírosnál) nem volt korrekció, ráétkezés vagy más bólus, sport / betegség / alkohol jegyzet,
      és a vércukor nem változott gyorsan az étkezés előtt. A gyors CH-hoz nem kell inzulin, és a hipó kezelésére bevitt (alacsony vércukorról induló) gyors CH is számít.
      </p>
    </details>
    <div class="chart-legend absorb-legend">
      <span class="k"><span class="sw-line learned" /> tanult</span>
      <span class="k"><span class="sw-line dflt" /> alapértelmezett</span>
    </div>
    <div class="absorb-grid">
      <div v-for="c in CATS" :key="c.key" class="absorb-item">
        <div class="absorb-head">
          <b>{{ c.label }}</b>
          <span class="muted small">{{ c.hint }}</span>
        </div>
        <svg :viewBox="`0 0 ${W} ${H}`" class="absorb-svg" role="img" :aria-label="`${c.label} felszívódási görbéje`">
          <line :x1="0" :x2="W" :y1="py(0.5)" :y2="py(0.5)" class="absorb-grid-line" />
          <polyline :points="curve(c, false)" class="absorb-default" />
          <polyline v-if="learnedOf(c)" :points="curve(c, true)" class="absorb-learned" />
        </svg>
        <div class="absorb-axis muted small"><span>0</span><span>4 óra</span><span>8 óra</span></div>
        <div class="gather" :title="`Tiszta étkezés: ${MIN} kell a használathoz, ${GOOD} a megbízható becsléshez`">
          <span class="gather-bar"><i :style="{ width: pct(abs[c.key].n) }" /></span>{{ count(abs[c.key].n) }}
          <span class="muted small">{{ quality(abs[c.key].n) }}</span>
        </div>
        <p v-if="learnedOf(c)" class="absorb-stats">
          <span><b>{{ min(abs[c.key].t50) }}</b> alatt a fele</span>
          <span><b>{{ min(abs[c.key].t90) }}</b> alatt 90%-a</span>
          <span class="muted small">{{ abs[c.key].n }} étkezésből, kb. {{ abs[c.key].refGrams }} g-os étkezésre</span>
        </p>
        <p v-else class="muted small">
          Addig az alapértelmezett érvényes: {{ c.rate }} g/óra, vagyis {{ REF_GRAMS }} g kb. {{ hours(totalMin(c)) }} óra alatt szívódik fel.
        </p>
      </div>
    </div>

    <h3 class="absorb-sub">Felszívódási ütem (g/óra)</h3>
    <p class="muted small">
      Ahol van tanult görbe, a program azt használja; ahol nincs, a beállított ütemet. A „Tanult” oszlop mutatja, mennyi jött ki
      az adataidból: ha a tanult görbe elég megbízható, ezt érdemes beállítani is.
    </p>
    <details class="more">
      <summary>Részletek</summary>
      <p class="muted small">
      Hány gramm szénhidrát szívódik fel óránként. A teljes idő = gramm ÷ g/óra, tehát a nagyobb étkezés tovább tart
      (pl. 20 g/óránál 40 g 2 óra, 60 g 3 óra alatt szívódik fel). Az alak ívelt: lassan indul, középen a leggyorsabb, majd lecseng.
      Amíg egy kategóriához nincs legalább {{ MIN }} tiszta étkezés, az előrejelzés és az aktív CH ezt használja; ha van tanult görbe, az az érvényes.
      </p>
    </details>
    <form class="absorb-rates" @submit.prevent="saveDefs()">
      <div class="absorb-rate-head" aria-hidden="true">
        <span>Kategória</span><span>Most ezzel számol</span><span>Tanult (adataidból)</span><span>Beállított ütem</span>
      </div>
      <div v-for="c in CATS" :key="c.key" class="absorb-rate-row">
        <b class="ar-name">{{ c.label }}</b>
        <span class="ar-cell" data-label="Most ezzel számol">
          <span class="ar-badge" :class="learnedOf(c) ? 'learned' : 'dflt'">{{ learnedOf(c) ? 'tanult görbe' : 'beállított ütem' }}</span>
        </span>
        <span class="ar-cell" data-label="Tanult (adataidból)">
          <template v-if="learnedRate(c) != null"><b>≈ {{ learnedRate(c) }} g/óra</b> <small class="muted">{{ quality(abs[c.key].n) }}</small></template>
          <small v-else class="muted">{{ quality(abs[c.key].n) }}</small>
        </span>
        <label class="ar-cell ar-input" data-label="Beállított ütem">
          <span class="absorb-input">
            <input v-model.number="form[c.key]" type="number" :min="defs?.limits?.min ?? 5" :max="defs?.limits?.max ?? 120" step="1" required :aria-label="`${c.label}: beállított ütem, g/óra`"> g/óra
          </span>
          <small class="muted">gyári {{ defs?.builtin?.[c.key] }}</small>
        </label>
      </div>
      <div class="btn-row">
        <button type="submit" :disabled="saving">Mentés</button>
        <button v-if="anyLearned" type="button" class="ghost" :disabled="saving" @click="takeLearned">Tanult értékek beírása</button>
        <button type="button" class="ghost" :disabled="saving" @click="saveDefs(true)">Gyári értékek</button>
      </div>
    </form>

    <h3 class="absorb-sub">Mennyi CH szívódik fel óránként?</h3>
    <p class="muted small">
      Szemléltetés egy {{ REF_GRAMS }} g-os étkezésre, azzal, amivel a program most számol (a százalék az étkezés összes CH-jának hányada).
      Ez nem beírandó érték: a fenti ütemet módosítva a „beállított ütem” oszlopok változnak.
    </p>
    <div class="absorb-table-wrap">
      <table class="absorb-table">
        <thead>
          <tr>
            <th>Óra</th>
            <th v-for="c in CATS" :key="c.key">{{ c.label }}<small>{{ learnedOf(c) ? 'tanult görbe' : `beállított ütem (${c.rate} g/óra)` }}</small></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in HOURS.filter((x) => x <= lastHour)" :key="h">
            <th>{{ h + 1 }}. óra</th>
            <td v-for="c in CATS" :key="c.key"><b>{{ cell(c, h) }}</b><span class="absorb-pct">{{ cellPct(c, h) }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.absorb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 12px 0; }
.absorb-item { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); min-width: 0; }
.absorb-item .gather { flex-wrap: wrap; white-space: normal; }
.absorb-legend { margin: 4px 0 0; }
.absorb-head { display: flex; flex-direction: column; }
.absorb-svg { width: 100%; height: auto; background: color-mix(in srgb, var(--text-primary) 4%, transparent); border-radius: 6px; }
.absorb-grid-line { stroke: var(--grid); stroke-width: 1; }
.absorb-default { fill: none; stroke: var(--text-muted); stroke-width: 1.5; stroke-dasharray: 4 3; }
.absorb-learned { fill: none; stroke: var(--series-carbs, var(--accent)); stroke-width: 2.5; stroke-linejoin: round; }
.absorb-rates { display: flex; flex-direction: column; margin: 4px 0; }
.absorb-rate-head, .absorb-rate-row {
  display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.3fr); gap: 8px 12px; align-items: center;
}
.absorb-rate-head { padding: 0 0 6px; font-size: 12px; color: var(--text-muted); border-bottom: 1px solid var(--grid); }
.absorb-rate-row { padding: 10px 0; border-bottom: 1px solid var(--grid); }
.ar-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; font-size: 14px; }
label.ar-input { flex-direction: row; color: var(--text-primary); }
.ar-badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
.ar-badge.learned { color: var(--series-carbs, var(--accent)); border-color: color-mix(in srgb, var(--series-carbs, var(--accent)) 50%, transparent); }
.ar-badge.dflt { color: var(--text-secondary); }
.absorb-input { display: inline-flex; align-items: center; gap: 6px; }
.absorb-input input { width: 76px; }
.absorb-rates .btn-row { margin-top: 12px; }
/* Mobilon kategóriánként kétoszlopos kártya, a cellák fölött a nevük. */
@media (max-width: 640px) {
  .absorb-rate-head { display: none; }
  .absorb-rate-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .ar-name { grid-column: 1 / -1; }
  .ar-cell { flex-direction: column; align-items: flex-start; gap: 2px; }
  label.ar-input { flex-direction: column; }
  .ar-cell::before { content: attr(data-label); font-size: 11px; color: var(--text-muted); }
}
.absorb-sub { margin: 8px 0 0; padding-top: 14px; border-top: 1px solid var(--grid); font-size: 14px; font-weight: 600; }
.absorb-table-wrap { overflow-x: auto; margin: 8px 0 12px; }
.absorb-table { border-collapse: collapse; font-size: 14px; width: 100%; font-variant-numeric: tabular-nums; }
.absorb-table th small { display: block; font-size: 11px; font-weight: 400; color: var(--text-muted); }
.absorb-table td { white-space: nowrap; }
.absorb-pct { display: inline-block; min-width: 3.2em; margin-left: 6px; text-align: right; font-size: 12px; color: var(--text-muted); }
.absorb-table th, .absorb-table td { padding: 6px 8px; border-top: 1px solid var(--border); text-align: right; }
.absorb-table thead th { border-top: 0; font-weight: 600; font-size: 13px; }
.absorb-table th:first-child { text-align: left; font-weight: 500; }
.absorb-axis { display: flex; justify-content: space-between; }
.absorb-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; }
.sw-line { display: inline-block; width: 22px; height: 0; border-top: 2.5px solid var(--series-carbs, var(--accent)); vertical-align: middle; }
.sw-line.dflt { border-top: 1.5px dashed var(--text-muted); }
</style>
