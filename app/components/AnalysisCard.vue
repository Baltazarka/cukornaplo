<script setup lang="ts">
// Terápia oldal: mennyi tiszta korrekció és étkezés gyűlt össze napszakonként (a választott időszakban,
// alapból az utolsó 14 napban),
// és ha elég, becslés az érzékenységi tényezőre, a CH-arányra és a hatásidőre, a mért hatásgörbével.
// Az „Átvétel” csak a szerkesztő mezőit tölti ki; menteni a felhasználó ment.
const emit = defineEmits<{ (e: 'apply', values: { start: string; isf?: number; icr?: number; actionMinutes?: number }[]): void }>()

// Időszak: alapból 14 nap; a választás ebben a böngészőben megmarad.
const PERIODS = [7, 14, 30, 60, 90]
const DAYS_KEY = 'cukornaplo.analysisDays'
const days = ref(14)
onMounted(() => {
  try {
    const v = Number(localStorage.getItem(DAYS_KEY))
    if (PERIODS.includes(v)) days.value = v
  } catch { /* nincs tároló */ }
})
function setDays(d: number) {
  days.value = d
  try { localStorage.setItem(DAYS_KEY, String(d)) } catch { /* nincs tároló */ }
}
const { data, refresh } = await useFetch<any>('/api/analysis', {
  query: computed(() => ({ days: days.value })),
  key: computed(() => `analysis-${days.value}`),
})
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

// A felső határon akadt illesztés (a vércukor az inzulin leghosszabb hatásidején túl is esett) nem
// megbízható: az érzékenységet és a hatásidőt ilyenkor nem írjuk be a szerkesztőbe.
const reliableIsf = (s: any) => (s.estimate.isf && !s.estimate.isf.unreliable ? s.estimate.isf.value : undefined)
const reliableDia = (s: any) => (s.estimate.action && !s.estimate.action.atLimit ? s.estimate.action.dia : undefined)
const hasEstimate = computed(() => a.value?.segments.some((s: any) => reliableIsf(s) != null || s.estimate.icr || reliableDia(s) != null))
function apply() {
  emit('apply', a.value.segments.map((s: any) => ({
    start: s.start,
    isf: reliableIsf(s),
    icr: s.estimate.icr?.value,
    actionMinutes: reliableDia(s),
  })))
}

// Tiszta étkezések görbéje napszakonként: a vércukor változása a kezdő értékhez képest.
const cleanSegs = computed(() => (a.value?.segments ?? []).filter((s: any) => s.clean))
function cleanChart(s: any) {
  const c = s.clean.curve
  const vals = [...c.p25, ...c.p75, ...c.p50].filter((v: number | null) => v != null) as number[]
  const lo = Math.min(-2, Math.floor(Math.min(...vals) / 2) * 2)
  const hi = Math.max(4, Math.ceil(Math.max(...vals) / 2) * 2)
  const yTicks: number[] = []
  for (let v = lo; v <= hi; v += 2) yTicks.push(v)
  return {
    x: c.minutes,
    lines: [{ y: c.p50, color: 'var(--series-glucose)', label: 'medián' }],
    bands: [{ lo: c.p25, hi: c.p75, color: 'color-mix(in srgb, var(--series-glucose) 18%, transparent)' }],
    yTicks,
  }
}
const signed = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${fmt(v)}`)
const minLabel = (v: number) => (v === 0 ? '0' : v < 0 ? `${v} p` : actionLabel(v))
/** A medián görbe változása a legutolsó fél órában (mmol/L): pozitív, ha a görbe a végén még emelkedik. */
function endRise(clean: any): number {
  const mins: number[] = clean?.curve?.minutes ?? []
  const p50: (number | null)[] = clean?.curve?.p50 ?? []
  let last = p50.length - 1
  while (last >= 0 && p50[last] == null) last--
  if (last < 0) return 0
  const target = mins[last] - 30
  let i = last
  while (i > 0 && (mins[i] > target || p50[i] == null)) i--
  return p50[i] == null ? 0 : p50[last]! - p50[i]!
}
/** A 4 órás eltérés értelmezése a CH-arány szempontjából (±1 mmol/L-en belül rendben); kevés eseménynél és ha a görbe még emelkedik, óvatosan. */
function cleanVerdict(clean: any): string {
  const d4h = clean?.d4h
  if (d4h == null) return ''
  const rising = endRise(clean) > 0.6
  const few = clean.n < MIN ? ` (csak ${clean.n} étkezés alapján, tájékoztató)` : ''
  if (d4h > 1 && rising) return `a kezdő érték fölött van, és a végén még emelkedik: lassabban felszívódó étkezés (pl. zsíros / fehérjedús), vagy a szénhidrát tovább hat, mint az inzulin, ezért ebből nem dönthető el, hogy a CH-arány gyenge-e${few}`
  if (d4h > 1) return `a kezdő érték fölött marad, a CH-arány gyenge lehet (több inzulin kellene, kisebb g/E)${few}`
  if (d4h < -1) return `a kezdő érték alá megy, a CH-arány erős lehet (kevesebb inzulin kellene, nagyobb g/E)${few}`
  return `visszaér a kezdő érték közelébe, a CH-arány rendben lehet${few}`
}

// Egész nap (összevont) becslés: akkor mutatjuk, ha valamelyik napszakban még nincs saját becslés, de összesen már van.
const overall = computed(() => a.value?.overall)
const showOverall = computed(() => {
  const o = overall.value?.estimate
  if (!o || !a.value) return false
  const segs: any[] = a.value.segments
  const missing = segs.some((s) => !s.estimate.isf || !s.estimate.icr || !s.estimate.action)
  return missing && !!(o.isf || o.icr || o.action)
})

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
// A y-tengely a mért értékekhez igazodik (25%-os lépésekben), hogy a 100% fölé vagy 0 alá menő rész
// (pl. ha a vércukor a hatásidőn túl is esik) ne vágódjon le.
const actYTicks = computed(() => {
  const o = act.value?.observed
  if (!o) return [0, 0.25, 0.5, 0.75, 1]
  const vals = [...o.p25, ...o.p50, ...o.p75].filter((v: number | null) => v != null) as number[]
  const lo = Math.min(0, Math.floor(Math.min(...vals) * 4) / 4)
  const hi = Math.max(1, Math.ceil(Math.max(...vals) * 4) / 4)
  const ticks: number[] = []
  for (let v = lo; v <= hi + 1e-9; v += 0.25) ticks.push(Math.round(v * 100) / 100)
  return ticks
})
</script>

<template>
  <section v-if="a" class="card analysis-card">
    <div class="card-head">
      <h2>Becslés az adataidból <GuideLink section="becsles" /></h2>
      <div class="analysis-period">
        <div class="segmented" role="group" aria-label="Időszak">
          <button v-for="d in PERIODS" :key="d" type="button" :aria-pressed="days === d" @click="setDays(d)">{{ d }} nap</button>
        </div>
        <span class="muted small">szenzoradat {{ fmt(a.coverage, 0) }}%</span>
      </div>
    </div>
    <RecomputeBar :at="a.computedAt" kind="analysis" :days="days" @done="refresh()" />
    <p class="muted small">
      <b>Tiszta korrekció:</b> magas vércukorra adott bólus, előtte 1 óráig és utána a napszakra beállított inzulinhatás-időtartamig étel és más bólus nélkül; ebből látszik az érzékenységi tényező és a valódi hatásidő.
      <b>Tiszta étkezés:</b> beírt CH-val és bólussal; 1 órával előtte és utána a napszak hatásidejéig (legalább 4 óráig) más bólus,
      2 órával előtte és utána más étel nélkül, sport-, betegség- vagy alkohol-jegyzet nélkül, és nem gyorsan változó kezdő vércukorral.
      A korábbi bólusok még ható részét beszámítja; ebből becsülhető a CH-arány.
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
              <b v-if="s.estimate.isf" :class="{ 'est-bad': s.estimate.isf.unreliable }">{{ fmt(s.estimate.isf.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ s.estimate.isf?.unreliable ? 'nem megbízható' : quality(s.counts.cleanCorrections) }}</small>
            </td>
            <td class="num">
              <span class="muted">{{ fmt(s.therapy?.icr) }} →</span>
              <b v-if="s.estimate.icr">{{ fmt(s.estimate.icr.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ quality(s.counts.cleanMeals) }}</small>
            </td>
            <td class="num">
              <span class="muted">{{ s.therapy ? actionLabel(s.therapy.actionMinutes) : '–' }} →</span>
              <b v-if="s.estimate.action" :class="{ 'est-bad': s.estimate.action.atLimit }">{{ s.estimate.action.atLimit ? '≥ ' : '' }}{{ actionLabel(s.estimate.action.dia) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ s.estimate.action?.atLimit ? 'nem megbízható' : quality(s.counts.cleanCorrections) }}</small>
            </td>
          </tr>
          <tr v-if="showOverall" class="overall-row">
            <td class="seg-time">Egész nap<small class="muted">összevont</small></td>
            <td>
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(overall.counts.cleanCorrections) }" /></span>{{ count(overall.counts.cleanCorrections) }}</div>
            </td>
            <td>
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(overall.counts.cleanMeals) }" /></span>{{ count(overall.counts.cleanMeals) }}</div>
            </td>
            <td class="num">
              <b v-if="overall.estimate.isf" :class="{ 'est-bad': overall.estimate.isf.unreliable }">{{ fmt(overall.estimate.isf.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ overall.estimate.isf?.unreliable ? 'nem megbízható' : quality(overall.counts.cleanCorrections) }}</small>
            </td>
            <td class="num">
              <b v-if="overall.estimate.icr">{{ fmt(overall.estimate.icr.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ quality(overall.counts.cleanMeals) }}</small>
            </td>
            <td class="num">
              <b v-if="overall.estimate.action" :class="{ 'est-bad': overall.estimate.action.atLimit }">{{ overall.estimate.action.atLimit ? '≥ ' : '' }}{{ actionLabel(overall.estimate.action.dia) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ overall.estimate.action?.atLimit ? 'nem megbízható' : quality(overall.counts.cleanCorrections) }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="showOverall" class="muted small">
      Az „Egész nap” sor az összes napszak eseményét egybevonja, ezért akkor is ad becslést, ha napszakonként még kevés az adat.
      Csak tájékoztató: a napszakok eltérhetnek egymástól, a szerkesztőbe nem kerül be automatikusan.
    </p>

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
            :y-ticks="actYTicks" :y-format="pctFmt" :ref-y="[1]" :height="170"
            :caption="`${act.n} tiszta korrekció: a vércukor esése a teljes esés arányában, a bólustól számítva`"
          >
            <template #legend><span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 18%, transparent)" /> 25–75%</span></template>
          </MiniBandChart>
        </ClientOnly>
        <p v-if="act.fit?.atLimit" class="alert small">
          A vércukor a kiválasztott inzulin leghosszabb hatásidején ({{ actionLabel(act.fit.maxDia) }}) túl is tovább esett, ezt az
          inzulin már nem magyarázza: valószínűleg más is csökkentette (pl. a bázis abban a napszakban erős, vagy éjszaka a
          szenzoron feküdtél). Az illesztett hatásidő és érzékenység ezért nem megbízható, a szerkesztőbe nem írjuk be;
          érdemes a Bázisellenőrzést is megnézni.
        </p>
        <p v-else-if="act.fit" class="muted small">
          Illesztett modell: csúcs {{ actionLabel(act.fit.peak) }}, hatásidő {{ actionLabel(act.fit.dia) }}, érzékenység {{ fmt(act.fit.isf) }} mmol/L/E.
          A szenzor kb. 10–15 percet késik, ezért a valódi csúcs valamivel korábban lehet.
        </p>
        <p v-else class="muted small">A görbe illesztéséhez legalább {{ MIN }} tiszta korrekció kell (most {{ act.n }}).</p>
      </template>
      <p v-else class="muted small">Még nincs tiszta korrekció. Akkor kerül ide, ha magas vércukorra étkezésen kívül adsz bólust, és utána pár óráig nem eszel.</p>
    </div>

    <div class="analysis-action">
      <h3>Tiszta étkezések görbéje</h3>
      <p class="muted small">
        A CH-arány becsléséhez használt étkezések: a vércukor változása a kezdő értékhez képest, 30 perccel előtte kezdve 4 óráig.
        Ha 4 óra múlva a görbe a kezdő érték fölött marad, a CH-arány gyenge lehet; ha alatta, erős.
      </p>
      <div v-if="cleanSegs.length" class="clean-meals">
        <div v-for="s in cleanSegs" :key="s.index" class="clean-meal">
          <div class="tile-label">{{ s.start }}–{{ s.end }} <span class="muted">· {{ s.clean.n }} tiszta étkezés</span></div>
          <ClientOnly>
            <MiniBandChart
              :x="cleanChart(s).x" :lines="cleanChart(s).lines" :bands="s.clean.n >= 2 ? cleanChart(s).bands : []"
              :x-ticks="[0, 60, 120, 180, 240]" :x-format="minLabel"
              :y-ticks="cleanChart(s).yTicks" :y-format="(v: number) => signed(v)"
              :ref-y="[0]" :ref-x="[0]" :height="140"
              :caption="`Emelkedés ${signed(s.clean.rise)} mmol/L, csúcs ${fmt(s.clean.peakMin, 0)} perc után, 4 óra múlva ${signed(s.clean.d4h)}`"
            >
              <template v-if="s.clean.n >= 2" #legend><span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 18%, transparent)" /> 25–75%</span></template>
            </MiniBandChart>
          </ClientOnly>
          <p class="muted small">4 óra múlva {{ signed(s.clean.d4h) }} mmol/L: {{ cleanVerdict(s.clean) }}.</p>
        </div>
      </div>
      <p v-else class="muted small">Még nincs tiszta étkezés. Akkor kerül ide, ha beírt CH-val és bólussal eszel, és utána 4 óráig nem eszel és nem adsz más bólust.</p>
    </div>
  </section>
</template>
