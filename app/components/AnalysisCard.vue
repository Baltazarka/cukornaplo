<script setup lang="ts">
// Terápia oldal: mennyi tiszta korrekció és étkezés gyűlt össze napszakonként (az utolsó 30 napban),
// és ha elég, becslés az érzékenységi tényezőre, a CH-arányra és a hatásidőre, a mért hatásgörbével.
// Az „Átvétel” csak a szerkesztő mezőit tölti ki; menteni a felhasználó ment.
const emit = defineEmits<{ (e: 'apply', values: { start: string; isf?: number; icr?: number; actionMinutes?: number }[]): void }>()

const { data } = await useFetch<any>('/api/analysis', { query: { days: 30 }, key: 'analysis-30' })
const a = computed(() => data.value)

const MIN = 3
const GOOD = 5
function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const pct = (n: number) => `${Math.min(100, (100 * n) / GOOD)}%`
const count = (n: number) => (n >= GOOD ? `${n} ✓` : `${n}/${GOOD}`)
const quality = (n: number) => (n >= GOOD ? 'megbízható' : n >= MIN ? 'előzetes' : `még ${MIN - n}`)

const hasEstimate = computed(() => a.value?.segments.some((s: any) => s.estimate.isf || s.estimate.icr || s.estimate.action))
function apply() {
  emit('apply', a.value.segments.map((s: any) => ({
    start: s.start,
    isf: s.estimate.isf?.value,
    icr: s.estimate.icr?.value,
    actionMinutes: s.estimate.action?.dia,
  })))
}

// Mért hatásgörbe: a tiszta korrekciók esése a teljes eséshez viszonyítva, a modellekkel.
const act = computed(() => a.value?.action)
const modelLine = (peak: number, dia: number) => {
  const m = insulinModel(peak, dia)
  return act.value.observed.minutes.map((t: number) => Math.round((1 - m.iob(t)) * 100) / 100)
}
const actLines = computed(() => {
  if (!act.value?.observed) return []
  const lines: any[] = [{ y: act.value.observed.p50, color: 'var(--series-glucose)', label: 'mért (medián)' }]
  if (act.value.fit) lines.push({ y: modelLine(act.value.fit.peak, act.value.fit.dia), color: 'var(--series-insulin)', label: `illesztett (${actionLabel(act.value.fit.dia)})` })
  if (act.value.current) lines.push({ y: modelLine(act.value.current.peak, act.value.current.dia), color: 'var(--text-muted)', label: `beállított (${actionLabel(act.value.current.dia)})`, dash: true })
  return lines
})
const pctFmt = (v: number) => `${Math.round(v * 100)}%`
</script>

<template>
  <section v-if="a" class="card analysis-card">
    <div class="card-head">
      <h2>Becslés az adataidból</h2>
      <span class="muted small">utolsó 30 nap · szenzoradat {{ fmt(a.coverage, 0) }}%</span>
    </div>
    <p class="muted small">
      <b>Tiszta korrekció:</b> magas vércukorra adott bólus, előtte 2 és utána 6 óráig étel és más bólus nélkül; ebből látszik az érzékenységi tényező és a valódi hatásidő.
      <b>Tiszta étkezés:</b> beírt CH-val és bólussal, utána 4 óráig más étel és bólus nélkül; ebből becsülhető a CH-arány.
      Napszakonként legalább {{ MIN }} kell a becsléshez, {{ GOOD }} a megbízhatóhoz.
    </p>
    <p v-if="!a.therapySet" class="alert small">Előbb add meg a terápiás beállításokat: a becslések a napszakokhoz és a jelenlegi értékekhez viszonyítanak.</p>

    <div class="table-wrap">
      <table class="table analysis-table">
        <thead>
          <tr>
            <th>Napszak</th>
            <th>Tiszta korrekció</th>
            <th>Tiszta étkezés</th>
            <th class="num">Érzékenység<small>mmol/L/E</small></th>
            <th class="num">CH-arány<small>g/E</small></th>
            <th class="num">Hatásidő</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in a.segments" :key="s.index">
            <td class="seg-time">{{ s.start }}<span class="muted">–{{ s.end }}</span></td>
            <td>
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(s.counts.cleanCorrections) }" /></span>{{ count(s.counts.cleanCorrections) }}</div>
            </td>
            <td>
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(s.counts.cleanMeals) }" /></span>{{ count(s.counts.cleanMeals) }}</div>
            </td>
            <td class="num">
              <span class="muted">{{ fmt(s.therapy?.isf) }} →</span>
              <b v-if="s.estimate.isf">{{ fmt(s.estimate.isf.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ quality(s.counts.cleanCorrections) }}</small>
            </td>
            <td class="num">
              <span class="muted">{{ fmt(s.therapy?.icr) }} →</span>
              <b v-if="s.estimate.icr">{{ fmt(s.estimate.icr.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ quality(s.counts.cleanMeals) }}</small>
            </td>
            <td class="num">
              <span class="muted">{{ s.therapy ? actionLabel(s.therapy.actionMinutes) : '–' }} →</span>
              <b v-if="s.estimate.action">{{ actionLabel(s.estimate.action.dia) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ quality(s.counts.cleanCorrections) }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="btn-row">
      <button type="button" class="ghost" :disabled="!hasEstimate" @click="apply">Becslések beírása a szerkesztőbe</button>
      <span class="muted small">Csak kitölti a mezőket, mentés előtt átnézheted. Ez a Cukornaplót állítja, az InPent nem; ott a változtatást a diabetológusoddal egyeztesd.</span>
    </div>

    <div class="analysis-action">
      <h3>Mért hatásgörbe</h3>
      <template v-if="act?.observed">
        <ClientOnly>
          <MiniBandChart
            :x="act.observed.minutes" :lines="actLines"
            :bands="[{ lo: act.observed.p25, hi: act.observed.p75, color: 'color-mix(in srgb, var(--series-glucose) 18%, transparent)' }]"
            :x-ticks="[0, 60, 120, 180, 240, 300, 360]" :x-format="(v: number) => (v ? actionLabel(v) : '0')"
            :y-ticks="[0, 0.25, 0.5, 0.75, 1]" :y-format="pctFmt" :ref-y="[1]" :height="170"
            :caption="`${act.n} tiszta korrekció: a vércukor esése a teljes esés arányában, a bólustól számítva`"
          >
            <template #legend><span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 18%, transparent)" /> 25–75%</span></template>
          </MiniBandChart>
        </ClientOnly>
        <p v-if="act.fit" class="muted small">
          Illesztett modell: csúcs {{ actionLabel(act.fit.peak) }}, hatásidő {{ actionLabel(act.fit.dia) }}, érzékenység {{ fmt(act.fit.isf) }} mmol/L/E.
          A szenzor kb. 10–15 percet késik, ezért a valódi csúcs valamivel korábban lehet.
        </p>
        <p v-else class="muted small">A görbe illesztéséhez legalább {{ MIN }} tiszta korrekció kell (most {{ act.n }}).</p>
      </template>
      <p v-else class="muted small">Még nincs tiszta korrekció. Akkor kerül ide, ha magas vércukorra étkezésen kívül adsz bólust, és utána pár óráig nem eszel.</p>
    </div>
  </section>
</template>
