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
// Csak megbízható (legalább GOOD eseményből készült) becslés kerül a szerkesztőbe, és egy lépésben legfeljebb ±20%-kal
// tér el a beállítottól (mint az autotune korlátja); a nagyobb eltérés több lépésben, újabb adatokkal közelít.
const MAX_STEP = 0.2
function capped(v: number, cur: number | null | undefined, step: number): number {
  const lim = cur ? Math.min(cur * (1 + MAX_STEP), Math.max(cur * (1 - MAX_STEP), v)) : v
  return Number((Math.round(lim / step) * step).toFixed(2))
}
const reliableIsf = (s: any) => {
  const e = s.estimate.isf
  if (!e || e.unreliable || (e.n ?? s.counts.cleanCorrections) < GOOD) return undefined
  return capped(e.value, s.therapy?.isf, 0.05)
}
const reliableDia = (s: any) => {
  const e = s.estimate.action
  if (!e || e.unreliable || (e.n ?? s.counts.cleanCorrections) < GOOD) return undefined
  return Math.min(480, Math.max(120, capped(e.dia, s.therapy?.actionMinutes, 15)))
}
// A CH-arány csak akkor átvehető, ha nem emelkedik még a végpontban, és az ISF-et sem írjuk át egyszerre (az ICR a régi
// ISF-fel készült; napszakonként egyszerre egy értéket változtatunk).
const reliableIcr = (s: any) => {
  if (!s.estimate.icr || s.estimate.icr.unreliable || s.counts.cleanMeals < GOOD) return undefined
  const newIsf = reliableIsf(s)
  const cur = s.therapy?.isf
  if (newIsf != null && cur && Math.abs(newIsf - cur) / cur > 0.01) return undefined
  return capped(s.estimate.icr.value, s.therapy?.icr, 0.05)
}
const hasEstimate = computed(() => a.value?.segments.some((s: any) => reliableIsf(s) != null || reliableIcr(s) != null || reliableDia(s) != null))
function apply() {
  emit('apply', a.value.segments.map((s: any) => ({
    start: s.start,
    isf: reliableIsf(s),
    icr: reliableIcr(s),
    actionMinutes: reliableDia(s),
  })))
}

// Tiszta étkezések görbéje napszakonként: a vércukor változása a kezdő értékhez képest (minden napszak látszik,
// a még üresek is).
const segList = computed<any[]>(() => a.value?.segments ?? [])
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

// Mért hatásgörbe: a tiszta korrekciók esése a teljes eséshez viszonyítva, a modellekkel; összevonva és napszakonként.
// Napszakonként kevés eseménynél is kirajzoljuk (tájékoztatásul); esemény nélkül csak egy rövid szöveg.
const act = computed(() => a.value?.action)
const ACT_MINUTES = Array.from({ length: 73 }, (_, i) => i * 5) // 0–6 óra
const pctFmt = (v: number) => `${Math.round(v * 100)}%`
function actChart(x: any) {
  const minutes: number[] = x?.observed?.minutes ?? ACT_MINUTES
  const model = (peak: number, dia: number) => {
    const m = insulinModel(peak, dia)
    return minutes.map((t) => Math.round((1 - m.iob(t)) * 100) / 100)
  }
  const lines: any[] = []
  if (x?.observed) lines.push({ y: x.observed.p50, color: 'var(--series-glucose)', label: 'mért (medián)' })
  if (x?.fit) lines.push({ y: model(x.fit.peak, x.fit.dia), color: 'var(--series-insulin)', label: `illesztett (${actionLabel(x.fit.dia)})` })
  if (x?.current) lines.push({ y: model(x.current.peak, x.current.dia), color: 'var(--text-muted)', label: `beállított (${actionLabel(x.current.dia)})`, dash: true })
  // A y-tengely a mért értékekhez igazodik (50%-os lépésekben), hogy a 100% fölé vagy 0 alá menő rész ne vágódjon le.
  const o = x?.observed
  const vals = o ? ([...o.p25, ...o.p50, ...o.p75].filter((v: number | null) => v != null) as number[]) : []
  const lo = Math.min(0, Math.floor(Math.min(0, ...vals) * 2) / 2)
  const hi = Math.max(1, Math.ceil(Math.max(1, ...vals) * 2) / 2)
  const yTicks: number[] = []
  for (let v = lo; v <= hi + 1e-9; v += 0.5) yTicks.push(Math.round(v * 100) / 100)
  const bands = o && x.n >= 3 ? [{ lo: o.p25, hi: o.p75, color: 'color-mix(in srgb, var(--series-glucose) 18%, transparent)' }] : []
  return { minutes, lines, yTicks, bands }
}
/** Rövid összegzés egy napszak (vagy az összevont) hatásgörbéje alá. */
function actNote(x: any): string {
  if (!x?.n) return `Még nincs tiszta korrekció (legalább ${MIN} kell).`
  if (x.fit?.atLimit) return `${x.n} korrekció: a leghosszabb hatásidőn túl is esett, nem megbízható.`
  if (x.fit) return `Illesztett: csúcs ${actionLabel(x.fit.peak)}, hatásidő ${actionLabel(x.fit.dia)}, érzékenység ${fmt(x.fit.isf)} mmol/L/E.`
  return `${x.n} korrekció: az illesztéshez még ${MIN - x.n} kell (tájékoztató).`
}

// Minta-grafikon, amíg nincs saját adat: korrekciónál a beállított hatásidőből számolt görbe,
// étkezésnél egy jó CH-arányú étkezés (kb. +3 mmol/L csúcs 70 perc körül, 4 óra múlva vissza a kezdőre).
function sampleAct(s: any) {
  const cur = s.action?.current ?? { peak: 75, dia: s.therapy?.actionMinutes ?? 240 }
  const m = insulinModel(cur.peak, cur.dia)
  return {
    minutes: ACT_MINUTES,
    lines: [{ y: ACT_MINUTES.map((t) => Math.round((1 - m.iob(t)) * 100) / 100), color: 'var(--text-muted)', label: `beállított hatásidő (${actionLabel(cur.dia)})`, dash: true }],
    yTicks: [0, 0.5, 1],
  }
}
const SAMPLE_MEAL_X = Array.from({ length: 49 }, (_, i) => i * 5)
const sampleRise = (t: number) => 3 * (t / 70) * Math.exp(1 - t / 70)
const SAMPLE_MEAL_Y = SAMPLE_MEAL_X.map((t) => Math.round((sampleRise(t) - (t / 240) * sampleRise(240)) * 10) / 10)
</script>

<template>
  <section v-if="a" class="card analysis-card">
    <div class="card-head">
      <h2>Érzékenység, CH-arány, hatásidő <GuideLink section="becsles" /></h2>
      <div class="analysis-period">
        <div class="segmented" role="group" aria-label="Időszak">
          <button v-for="d in PERIODS" :key="d" type="button" :aria-pressed="days === d" @click="setDays(d)">{{ d }} nap</button>
        </div>
        <span class="muted small">szenzoradat az időszak {{ fmt(a.coverage, 0) }}%-ában</span>
      </div>
    </div>
    <RecomputeBar :at="a.computedAt" kind="analysis" :days="days" @done="refresh()" />
    <p class="tp-what">Becsüli: <b>ISF, CH-arány, hatásidő</b> napszakonként · Miből: tiszta korrekciók és étkezések · <span class="muted">beállított →</span> <span class="calc">becsült</span></p>
    <details class="more">
      <summary>Mi számít tisztának?</summary>
      <p class="muted small">
      <b>Tiszta korrekció:</b> magas vércukorra adott bólus, előtte 1 óráig és utána a napszakra beállított inzulinhatás-időtartamig étel és más bólus nélkül,
      és egy korábbi étkezés CH-ja már felszívódott; ebből látszik az érzékenységi tényező és a valódi hatásidő.
      <b>Tiszta étkezés:</b> beírt CH-val és bólussal; 1 órával előtte és utána a napszak hatásidejéig (legalább 4 óráig) más bólus nélkül,
      utána más étel nélkül, egy korábbi étkezés CH-ja már felszívódott, sport-, betegség- vagy alkohol-jegyzet nélkül, nem hipóból indul, és nem gyorsan változó kezdő vércukorral.
      Csak a szenzor méréseiből számol (a kézi mérés nem keveredik bele).
      A korábbi bólusok még ható részét beszámítja; ebből becsülhető a CH-arány.
      </p>
    </details>
    <p v-if="!a.therapySet" class="alert small">Előbb add meg a terápiás beállításokat: a becslések a napszakokhoz és a jelenlegi értékekhez viszonyítanak.</p>

    <!-- Napszakonként egy blokk: fent a beállított → becsült értékek, alatta a két görbe, amiből számol. -->
    <div class="seg-secs">
      <section v-for="s in a.segments" :key="s.index" class="seg-sec">
        <header class="seg-sec-head">
          <h3>{{ s.start }}–{{ s.end }}</h3>
          <small
            v-if="s.estimate.drifting" class="est-drift"
            title="A böjti időszakokban (étel és ható bólus nélkül) a vércukor ebben a napszakban átlagosan ennyit változik óránként: a bázis nem fedi az alapigényt, ezért a korrekciók esése és az étkezések végpontja torzul, a becslések nem megbízhatók."
          >bázis-sodródás {{ s.estimate.drift > 0 ? '+' : '' }}{{ fmt(s.estimate.drift) }} mmol/L/óra, a becslés nem megbízható</small>
        </header>
        <div class="seg-est">
          <div class="est-tile">
            <span class="est-k">Érzékenység <small>mmol/L/E</small></span>
            <span class="est-v"><span class="muted">{{ fmt(s.therapy?.isf) }} →</span> <b v-if="s.estimate.isf" class="calc" :class="{ 'est-bad': s.estimate.isf.unreliable }">{{ fmt(s.estimate.isf.value) }}</b><span v-else class="muted">?</span></span>
            <small class="est-q">{{ s.estimate.isf?.unreliable ? 'nem megbízható' : quality(s.estimate.isf?.n ?? s.counts.cleanCorrections) }}</small>
          </div>
          <div class="est-tile">
            <span class="est-k">CH-arány <small>g/E</small></span>
            <span class="est-v"><span class="muted">{{ fmt(s.therapy?.icr) }} →</span> <b v-if="s.estimate.icr" class="calc" :class="{ 'est-bad': s.estimate.icr.unreliable }">{{ fmt(s.estimate.icr.value) }}</b><span v-else class="muted">?</span></span>
            <small v-if="s.estimate.icr?.unreliable && s.estimate.drifting" class="est-q">nem megbízható</small>
            <small v-else-if="s.estimate.icr?.unreliable" class="est-q" title="A tiszta étkezések többségénél a vércukor a végpontban még emelkedik: a CH nem szívódott fel teljesen, ezért a CH-arány túl nagy lehet.">még emelkedik</small>
            <small v-else class="est-q">{{ quality(s.counts.cleanMeals) }}</small>
          </div>
          <div class="est-tile">
            <span class="est-k">Hatásidő</span>
            <span class="est-v"><span class="muted">{{ s.therapy ? actionLabel(s.therapy.actionMinutes) : '–' }} →</span> <b v-if="s.estimate.action" class="calc" :class="{ 'est-bad': s.estimate.action.unreliable }">{{ s.estimate.action.atLimit ? '≥ ' : '' }}{{ actionLabel(s.estimate.action.dia) }}</b><span v-else class="muted">?</span></span>
            <small class="est-q">{{ s.estimate.action?.unreliable ? 'nem megbízható' : quality(s.estimate.action?.n ?? s.counts.cleanCorrections) }}</small>
          </div>
        </div>
        <div class="seg-charts">
          <div class="seg-chart">
            <div class="seg-chart-head">
              <b>Korrekció után</b>
              <span class="gather"><span class="gather-bar"><i :style="{ width: pct(s.counts.cleanCorrections) }" /></span>{{ count(s.counts.cleanCorrections) }} tiszta</span>
            </div>
            <p class="muted small">Mennyi ment le a teljes esésből (100% = a teljes hatás) → <b>érzékenység, hatásidő</b></p>
            <ClientOnly v-if="s.action?.n">
              <MiniBandChart
                :x="actChart(s.action).minutes" :lines="actChart(s.action).lines" :bands="actChart(s.action).bands"
                :x-ticks="[0, 120, 240, 360]" :x-format="(v: number) => (v ? actionLabel(v) : '0')"
                :y-ticks="actChart(s.action).yTicks" :y-format="pctFmt" :ref-y="[1]" :height="140" caption=""
              />
            </ClientOnly>
            <div v-else class="chart-sample">
              <ClientOnly>
                <MiniBandChart
                  :x="sampleAct(s).minutes" :lines="sampleAct(s).lines"
                  :x-ticks="[0, 120, 240, 360]" :x-format="(v: number) => (v ? actionLabel(v) : '0')"
                  :y-ticks="sampleAct(s).yTicks" :y-format="pctFmt" :ref-y="[1]" :height="140" caption=""
                />
              </ClientOnly>
              <span class="sample-badge">Minta · még nincs saját adat</span>
            </div>
            <p class="small seg-verdict">{{ actNote(s.action) }}</p>
          </div>
          <div class="seg-chart">
            <div class="seg-chart-head">
              <b>Étkezés után</b>
              <span class="gather"><span class="gather-bar"><i :style="{ width: pct(s.counts.cleanMeals) }" /></span>{{ count(s.counts.cleanMeals) }} tiszta</span>
            </div>
            <p class="muted small">A vércukor a kezdőhöz képest; 4 óra múlva 0 körül = jó → <b>CH-arány</b></p>
            <ClientOnly v-if="s.clean">
              <MiniBandChart
                :x="cleanChart(s).x" :lines="cleanChart(s).lines" :bands="s.clean.n >= 2 ? cleanChart(s).bands : []"
                :x-ticks="[0, 60, 120, 180, 240]" :x-format="minLabel"
                :y-ticks="cleanChart(s).yTicks" :y-format="(v: number) => signed(v)"
                :ref-y="[0]" :ref-x="[0]" :height="140" caption=""
              />
            </ClientOnly>
            <div v-else class="chart-sample">
              <ClientOnly>
                <MiniBandChart
                  :x="SAMPLE_MEAL_X" :lines="[{ y: SAMPLE_MEAL_Y, color: 'var(--text-muted)', label: 'jó CH-arány: 4 óra múlva vissza a kezdőre', dash: true }]"
                  :x-ticks="[0, 60, 120, 180, 240]" :x-format="minLabel"
                  :y-ticks="[-2, 0, 2, 4]" :y-format="(v: number) => signed(v)"
                  :ref-y="[0]" :ref-x="[0]" :height="140" caption=""
                />
              </ClientOnly>
              <span class="sample-badge">Minta · még nincs saját adat</span>
            </div>
            <p v-if="s.clean" class="small seg-verdict">4 óra múlva <b>{{ signed(s.clean.d4h) }}</b> mmol/L: {{ cleanVerdict(s.clean) }}.</p>
            <p v-else class="small seg-verdict">Még nincs tiszta étkezés (legalább {{ MIN }} kell).</p>
            <small v-if="s.counts.truncatedMeals" class="muted" title="Ezeknél az étkezést 3 óra után megzavarta valami (korrekció, ráevés, hipó kezelése): csak a zavarásig számít, a már felszívódott CH-val.">ebből {{ s.counts.truncatedMeals }} rövidített</small>
          </div>
        </div>
      </section>

      <!-- Egész nap: az összes napszak egybevonva (tájékoztató, a szerkesztőbe nem kerül be). -->
      <section v-if="a.segments.length > 1 && (showOverall || act?.observed)" class="seg-sec">
        <header class="seg-sec-head">
          <h3>Egész nap <span class="muted">· összevont, tájékoztató</span></h3>
        </header>
        <div v-if="showOverall" class="seg-est">
          <div class="est-tile">
            <span class="est-k">Érzékenység <small>mmol/L/E</small></span>
            <span class="est-v"><b v-if="overall.estimate.isf" class="calc" :class="{ 'est-bad': overall.estimate.isf.unreliable }">{{ fmt(overall.estimate.isf.value) }}</b><span v-else class="muted">?</span></span>
            <small class="est-q">{{ overall.estimate.isf?.unreliable ? 'nem megbízható' : 'előzetes' }}</small>
          </div>
          <div class="est-tile">
            <span class="est-k">CH-arány <small>g/E</small></span>
            <span class="est-v"><b v-if="overall.estimate.icr" class="calc" :class="{ 'est-bad': overall.estimate.icr.unreliable }">{{ fmt(overall.estimate.icr.value) }}</b><span v-else class="muted">?</span></span>
            <small class="est-q">{{ overall.estimate.icr?.unreliable ? 'még emelkedik' : quality(overall.counts.cleanMeals) }}</small>
          </div>
          <div class="est-tile">
            <span class="est-k">Hatásidő</span>
            <span class="est-v"><b v-if="overall.estimate.action" class="calc" :class="{ 'est-bad': overall.estimate.action.unreliable }">{{ overall.estimate.action.atLimit ? '≥ ' : '' }}{{ actionLabel(overall.estimate.action.dia) }}</b><span v-else class="muted">?</span></span>
            <small class="est-q">{{ overall.estimate.action?.unreliable ? 'nem megbízható' : 'előzetes' }}</small>
          </div>
        </div>
        <div v-if="act?.observed" class="seg-charts">
          <div class="seg-chart">
            <div class="seg-chart-head"><b>Korrekció után</b><span class="muted small">{{ act.n }} tiszta</span></div>
            <ClientOnly>
              <MiniBandChart
                :x="actChart(act).minutes" :lines="actChart(act).lines" :bands="actChart(act).bands"
                :x-ticks="[0, 120, 240, 360]" :x-format="(v: number) => (v ? actionLabel(v) : '0')"
                :y-ticks="actChart(act).yTicks" :y-format="pctFmt" :ref-y="[1]" :height="140" caption=""
              />
            </ClientOnly>
            <p v-if="act.fit?.atLimit" class="alert small">
              A vércukor a leghosszabb hatásidőn ({{ actionLabel(act.fit.maxDia) }}) túl is esett, ezt az inzulin nem magyarázza
              (pl. erős bázis vagy ráfekvés); nem megbízható, a szerkesztőbe nem kerül.
            </p>
            <p v-else class="small seg-verdict">{{ actNote(act) }}</p>
          </div>
        </div>
      </section>
    </div>

    <div class="btn-row apply-row">
      <button type="button" :disabled="!hasEstimate" @click="apply">Becslések beírása a szerkesztőbe</button>
      <span class="muted small">Csak a megbízható (5+ eseményes) becsléseket, lépésenként legfeljebb ±20%-kal tölti ki; mentés előtt átnézheted, a változtatást a diabetológusoddal egyeztesd.</span>
    </div>
  </section>
</template>
