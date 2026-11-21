<script setup lang="ts">
// Autopilot: külön modul. A naplóból (szenzor, inzulin, CH, terápiás beállítás) percenként kiszámolja, kell-e és mennyi
// inzulin, pumpa-szerű lépésekben (a teljes szükséglet töredéke, újraszámolással). NEM pumpa: nem ad be inzulint és nem
// ír a naplóba; a beadásról te döntesz. Saját beállítások, saját napló, saját push.
definePageMeta({ title: 'Autopilot' })

const { data, refresh } = await useFetch<any>('/api/autopilot')
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { if (!document.hidden) refresh() }, 60_000) })
onBeforeUnmount(() => clearInterval(timer))

const fmt = (v: number | null | undefined, dec = 1) => (v == null ? '–' : v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec }))
const dec = computed(() => data.value?.decision ?? null)
const STATE: Record<string, { label: string; cls: string }> = {
  suggest: { label: 'Javaslat', cls: 'ap-suggest' },
  wait: { label: 'Nincs javaslat', cls: 'ap-wait' },
  hold: { label: 'Várj', cls: 'ap-hold' },
  stale: { label: 'Nincs friss adat', cls: 'ap-stale' },
}
const state = computed(() => STATE[dec.value?.state ?? 'stale'])
const arrow = computed(() => {
  const r = dec.value?.rate
  if (r == null) return ''
  const a = Math.abs(r)
  const n = a >= 0.17 ? 3 : a >= 0.11 ? 2 : a >= 0.06 ? 1 : 0
  return n === 0 ? '→' : (r > 0 ? '↑' : '↓').repeat(n)
})

// Beállítások
const form = reactive({ enabled: false, push: true, fraction: 0.5, maxIob: 3, maxStep: 5, spacingMin: 60, doseStep: 1 })
watch(() => data.value?.settings, (s) => { if (s) Object.assign(form, s) }, { immediate: true })
const saveMsg = ref('')
const saveErr = ref('')
useToastFrom(saveMsg, 'success')
useToastFrom(saveErr, 'error')
const saving = ref(false)
async function save() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await $fetch('/api/autopilot/settings', { method: 'POST', body: { ...form } })
    saveMsg.value = 'Mentve.'
    await refresh()
  } catch (e: any) {
    saveErr.value = e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    saving.value = false
  }
}

// Várható görbe a MiniBandChart-tal: a mostani állapot és (javaslatnál) a javasolt adag beadásával.
const chart = computed(() => {
  const d = dec.value
  if (!d?.curve?.length) return null
  const all = [...d.curve, ...(d.curveAfter ?? [])].map((c: number[]) => c[1])
  const max = Math.max(12, Math.ceil(Math.max(...all) / 2) * 2)
  const min = Math.min(2, Math.floor(Math.min(...all) / 2) * 2)
  const yTicks: number[] = []
  for (let v = min; v <= max; v += 2) yTicks.push(v)
  const lines: any[] = [{ y: d.curve.map((c: number[]) => c[1]), color: 'var(--series-glucose)', label: 'ha nem történik más' }]
  if (d.curveAfter?.length) lines.push({ y: d.curveAfter.map((c: number[]) => c[1]), color: 'var(--status-warning)', label: 'a javasolt adaggal', dash: true })
  return { x: d.curve.map((c: number[]) => c[0]), lines, yTicks }
})
const range = computed(() => data.value?.range ?? { low: 3.9, high: 10, veryLow: 3, veryHigh: 13.9 })
/** A főoldali „Most” kártya zónaszíne (a vércukor a céltartományhoz képest). */
const zone = computed(() => {
  const v = dec.value?.bg
  if (v == null) return ''
  const r = range.value
  return v < r.veryLow ? 'z-very-low' : v < r.low ? 'z-low' : v > r.veryHigh ? 'z-very-high' : v > r.high ? 'z-high' : ''
})
const when = (ts: number) => new Date(ts * 1000).toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const outcomeOk = (r: any) => r.min4h != null && r.min4h >= range.value.low
</script>

<template>
  <main class="autopilot">
    <section class="card">
      <div class="card-head">
        <h1>Autopilot</h1>
        <span class="chip" :class="state.cls">{{ state.label }}</span>
      </div>
      <p class="muted small">
        Külön modul: a naplóból percenként kiszámolja, kell-e és mennyi inzulin, pumpa-szerű lépésekben (a teljes szükséglet
        fele, egy óra múlva újraszámol). <b>Nem pumpa</b>: nem ad be inzulint és nem ír a naplóba, a beadásról te döntesz.
        Tájékoztató javaslat, a terápiás beállítások és a határok a diabetológussal egyeztetendők.
      </p>
      <p v-if="data && !data.therapySet" class="muted">Előbb add meg a <NuxtLink to="/terapia">terápiás beállításokat</NuxtLink>.</p>
    </section>

    <section v-if="dec?.bg != null" class="card now-card" :class="zone">
      <div class="now-main">
        <span class="now-label">Most · szenzor</span>
        <span class="now-value">{{ fmt(dec.bg) }} <small>mmol/L</small></span>
        <span class="now-trend">{{ arrow }}</span>
        <span class="now-zone">{{ state.label }}</span>
      </div>
      <div class="now-facts">
        <div><span>Aktív inzulin</span><b class="now-ins">{{ fmt(dec.iob) }} E</b></div>
        <div><span>Aktív CH</span><b class="now-carbs">{{ fmt(dec.cob, 0) }} g</b></div>
        <div><span>Várható</span><b>≈ {{ fmt(dec.eventual) }}</b></div>
        <div><span>Legalacsonyabb</span><b>{{ fmt(dec.minPred) }}</b></div>
      </div>
    </section>

    <section v-if="dec" class="card">
      <h2 class="ap-h">Javaslat</h2>
      <p v-if="dec.state === 'suggest'" class="ap-advice">Kb. <b>{{ fmt(dec.units) }} E</b> javasolt <small class="muted">(a teljes szükséglet kb. {{ fmt(dec.full) }} E)</small></p>
      <ul class="ap-reasons">
        <li v-for="(r, i) in dec.reasons" :key="i">{{ r }}</li>
      </ul>
      <template v-if="chart">
        <h3 class="ap-h">Várható vércukor a következő 4 órában</h3>
        <ClientOnly>
          <MiniBandChart
            :x="chart.x" :lines="chart.lines" :x-ticks="[0, 60, 120, 180, 240]" :x-format="(v: number) => (v ? `+${v / 60} ó` : 'most')"
            :y-ticks="chart.yTicks" :y-format="(v: number) => String(v)" :ref-y="[range.low, range.high]" :height="190" caption=""
          />
        </ClientOnly>
      </template>
    </section>

    <section class="card">
      <h2 class="ap-h">Beállítások</h2>
      <form class="ap-form" @submit.prevent="save">
        <label class="check"><input v-model="form.enabled" type="checkbox"> Bekapcsolva (percenként számol)</label>
        <label class="check"><input v-model="form.push" type="checkbox"> Értesítést küld, ha javasol</label>
        <div class="ap-grid">
          <label>Lépés a teljes szükséglet
            <select v-model.number="form.fraction">
              <option :value="0.25">25%</option>
              <option :value="0.5">50% (ajánlott)</option>
              <option :value="0.75">75%</option>
              <option :value="1">100%</option>
            </select>
          </label>
          <label>Legfeljebb ennyi aktív inzulin (E)
            <input v-model.number="form.maxIob" type="number" min="0.5" max="30" step="0.5">
          </label>
          <label>Egy javaslat legfeljebb (E)
            <input v-model.number="form.maxStep" type="number" min="0.5" max="30" step="0.5">
          </label>
          <label>Adagolás lépésköze
            <select v-model.number="form.doseStep">
              <option :value="1">1 E (egész egységek)</option>
              <option :value="0.5">0,5 E</option>
            </select>
          </label>
          <label>Két javaslat között legalább (perc)
            <input v-model.number="form.spacingMin" type="number" min="30" max="240" step="15">
          </label>
        </div>
        <p class="muted small">
          A cél, az érzékenység és a CH-arány a Terápia oldalról jön. Az aktív inzulin határa: egy nagyobb étkezési bólus után órákig
          fölötte lehet az aktív inzulin, ilyenkor nem javasol (a határt a diabetológussal egyeztetve érdemes megadni). Nem javasol: hipó-veszélynél, eső vércukornál, friss adag után,
          és ha a javasolt adag mellett is túl közel kerülne a várható mélypont az alacsonyhoz.
        </p>
        <button type="submit" :disabled="saving">Mentés</button>
      </form>
    </section>

    <section class="card">
      <h2 class="ap-h">Korábbi javaslatok és mi lett</h2>
      <p v-if="!data?.rows?.length" class="muted">Még nem volt javaslat.</p>
      <template v-else>
        <p class="small">
          {{ data.summary.n }} javaslat; ebből {{ data.summary.followed }}-t követtél (30 percen belül beadtad legalább a felét),
          és ezek közül {{ data.summary.lowAfterFollowed }} után lett a vércukor 4 órán belül {{ fmt(range.low) }} alá.
        </p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Mikor</th><th class="num">Javasolt</th><th class="num">Volt</th><th class="num">Beadva</th><th class="num">2 óra</th><th class="num">4 óra</th><th class="num">4 órás min.</th></tr></thead>
            <tbody>
              <tr v-for="r in data.rows" :key="r.ts">
                <td>{{ when(r.ts) }}<span v-if="r.pushed" class="muted"> · push</span></td>
                <td class="num">{{ fmt(r.units) }} E</td>
                <td class="num">{{ fmt(r.bg) }}</td>
                <td class="num">{{ r.given ? `${fmt(r.given)} E` : '–' }}</td>
                <td class="num">{{ fmt(r.at2h) }}</td>
                <td class="num">{{ fmt(r.at4h) }}</td>
                <td class="num" :class="{ 'err-text': r.min4h != null && !outcomeOk(r) }">{{ fmt(r.min4h) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
  </main>
</template>
