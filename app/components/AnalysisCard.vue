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
const reliableDia = (s: any) => (s.estimate.action && !s.estimate.action.unreliable ? s.estimate.action.dia : undefined)
// A CH-arány csak akkor átvehető, ha nem emelkedik még a végpontban, és az ISF-et sem írjuk át egyszerre (az ICR a régi ISF-fel készült).
const reliableIcr = (s: any) => {
  if (!s.estimate.icr || s.estimate.icr.unreliable) return undefined
  const newIsf = reliableIsf(s)
  const cur = s.therapy?.isf
  if (newIsf != null && cur && Math.abs(newIsf - cur) / cur > 0.1) return undefined
  return s.estimate.icr.value
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
// Napszakonként kevés eseménynél is kirajzoljuk (tájékoztatásul); esemény nélkül csak a beállított görbe látszik.
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
  // A y-tengely a mért értékekhez igazodik (25%-os lépésekben), hogy a 100% fölé vagy 0 alá menő rész ne vágódjon le.
  const o = x?.observed
  const vals = o ? ([...o.p25, ...o.p50, ...o.p75].filter((v: number | null) => v != null) as number[]) : []
  const lo = Math.min(0, Math.floor(Math.min(0, ...vals) * 4) / 4)
  const hi = Math.max(1, Math.ceil(Math.max(1, ...vals) * 4) / 4)
  const yTicks: number[] = []
  for (let v = lo; v <= hi + 1e-9; v += 0.25) yTicks.push(Math.round(v * 100) / 100)
  const bands = o && x.n >= 3 ? [{ lo: o.p25, hi: o.p75, color: 'color-mix(in srgb, var(--series-glucose) 18%, transparent)' }] : []
  return { minutes, lines, yTicks, bands }
}
/** Rövid összegzés egy napszak (vagy az összevont) hatásgörbéje alá. */
function actNote(x: any): string {
  if (!x?.n) return 'Még nincs tiszta korrekció; a szaggatott a beállított görbe.'
  if (x.fit?.atLimit) return `${x.n} korrekció: a leghosszabb hatásidőn túl is esett, nem megbízható.`
  if (x.fit) return `Illesztett: csúcs ${actionLabel(x.fit.peak)}, hatásidő ${actionLabel(x.fit.dia)}, érzékenység ${fmt(x.fit.isf)} mmol/L/E.`
  return `${x.n} korrekció: az illesztéshez még ${MIN - x.n} kell (tájékoztató).`
}
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

    <div class="table-wrap">
      <table class="table analysis-table est-table">
        <thead>
          <tr>
            <th>Napszak</th>
            <th>Korrekció<small>tiszta</small></th>
            <th>Étkezés<small>tiszta</small></th>
            <th class="num">Érzékenység<small>mmol/L/E</small></th>
            <th class="num">CH-arány<small>g/E</small></th>
            <th class="num">Hatásidő<small>óra</small></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in a.segments" :key="s.index">
            <td class="seg-time">
              {{ s.start }}<span class="muted">–{{ s.end }}</span>
              <small
                v-if="s.estimate.drifting" class="est-drift"
                title="A böjti időszakokban (étel és ható bólus nélkül) a vércukor ebben a napszakban átlagosan ennyit változik óránként: a bázis nem fedi az alapigényt, ezért a korrekciók esése és az étkezések végpontja torzul, a becslések nem megbízhatók."
              >sodródás {{ s.estimate.drift > 0 ? '+' : '' }}{{ fmt(s.estimate.drift) }}/óra</small>
            </td>
            <td data-label="Korrekció">
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(s.counts.cleanCorrections) }" /></span>{{ count(s.counts.cleanCorrections) }}</div>
            </td>
            <td data-label="Étkezés">
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(s.counts.cleanMeals) }" /></span>{{ count(s.counts.cleanMeals) }}</div>
              <small v-if="s.counts.truncatedMeals" class="muted" title="Ezeknél az étkezést 3 óra után megzavarta valami (korrekció, ráevés, hipó kezelése): csak a zavarásig számít, a már felszívódott CH-val.">ebből {{ s.counts.truncatedMeals }} rövidített</small>
            </td>
            <td class="num" data-label="Érzékenység">
              <span class="muted">{{ fmt(s.therapy?.isf) }} →</span>
              <b v-if="s.estimate.isf" class="calc" :class="{ 'est-bad': s.estimate.isf.unreliable }">{{ fmt(s.estimate.isf.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ s.estimate.isf?.unreliable ? 'nem megbízható' : quality(s.estimate.isf?.n ?? s.counts.cleanCorrections) }}</small>
            </td>
            <td class="num" data-label="CH-arány">
              <span class="muted">{{ fmt(s.therapy?.icr) }} →</span>
              <b v-if="s.estimate.icr" class="calc" :class="{ 'est-bad': s.estimate.icr.unreliable }">{{ fmt(s.estimate.icr.value) }}</b><span v-else class="muted">?</span>
              <small v-if="s.estimate.icr?.unreliable && s.estimate.drifting" class="est-q" title="Jelentős bázis-sodródás ebben a napszakban: a végpont torzul.">nem megbízható</small>
              <small v-else-if="s.estimate.icr?.unreliable" class="est-q" title="A tiszta étkezések többségénél a vércukor a végpontban még emelkedik: a CH nem szívódott fel teljesen, ezért a CH-arány túl nagy lehet.">még emelkedik</small>
              <small class="est-q">{{ quality(s.counts.cleanMeals) }}</small>
            </td>
            <td class="num" data-label="Hatásidő">
              <span class="muted">{{ s.therapy ? actionLabel(s.therapy.actionMinutes) : '–' }} →</span>
              <b v-if="s.estimate.action" class="calc" :class="{ 'est-bad': s.estimate.action.unreliable }">{{ s.estimate.action.atLimit ? '≥ ' : '' }}{{ actionLabel(s.estimate.action.dia) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ s.estimate.action?.unreliable ? 'nem megbízható' : quality(s.estimate.action?.n ?? s.counts.cleanCorrections) }}</small>
            </td>
          </tr>
          <tr v-if="showOverall" class="overall-row">
            <td class="seg-time">Egész nap<small class="muted">összevont</small></td>
            <td data-label="Korrekció">
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(overall.counts.cleanCorrections) }" /></span>{{ count(overall.counts.cleanCorrections) }}</div>
            </td>
            <td data-label="Étkezés">
              <div class="gather"><span class="gather-bar"><i :style="{ width: pct(overall.counts.cleanMeals) }" /></span>{{ count(overall.counts.cleanMeals) }}</div>
            </td>
            <td class="num" data-label="Érzékenység">
              <b v-if="overall.estimate.isf" class="calc" :class="{ 'est-bad': overall.estimate.isf.unreliable }">{{ fmt(overall.estimate.isf.value) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ overall.estimate.isf?.unreliable ? 'nem megbízható' : 'előzetes' }}</small>
            </td>
            <td class="num" data-label="CH-arány">
              <b v-if="overall.estimate.icr" class="calc" :class="{ 'est-bad': overall.estimate.icr.unreliable }">{{ fmt(overall.estimate.icr.value) }}</b><span v-else class="muted">?</span>
              <small v-if="overall.estimate.icr?.unreliable" class="est-q" title="A tiszta étkezések többségénél a vércukor a végpontban még emelkedik: a CH nem szívódott fel teljesen, ezért a CH-arány túl nagy lehet.">még emelkedik</small>
              <small class="est-q">{{ quality(overall.counts.cleanMeals) }}</small>
            </td>
            <td class="num" data-label="Hatásidő">
              <b v-if="overall.estimate.action" class="calc" :class="{ 'est-bad': overall.estimate.action.unreliable }">{{ overall.estimate.action.atLimit ? '≥ ' : '' }}{{ actionLabel(overall.estimate.action.dia) }}</b><span v-else class="muted">?</span>
              <small class="est-q">{{ overall.estimate.action?.unreliable ? 'nem megbízható' : 'előzetes' }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="showOverall" class="muted small">
      Az „Egész nap” sor az összes napszakot egybevonja (tájékoztató, a szerkesztőbe nem kerül be).
    </p>

    <div class="btn-row apply-row">
      <button type="button" :disabled="!hasEstimate" @click="apply">Becslések beírása a szerkesztőbe</button>
      <span class="muted small">Csak kitölti a mezőket, mentés előtt átnézheted; a változtatást a diabetológusoddal egyeztesd.</span>
    </div>

    <div class="analysis-action">
      <h3>Inzulin hatásideje (mért)</h3>
      <p class="tp-what">Becsüli: <b>hatásidő, érzékenység</b> · Miből: tiszta korrekciók után a vércukoresés, a teljes esés %-ában</p>
      <template v-if="act?.observed">
        <div class="tile-label">Egész nap <span class="muted">· {{ act.n }} tiszta korrekció</span></div>
        <ClientOnly>
          <MiniBandChart
            :x="actChart(act).minutes" :lines="actChart(act).lines" :bands="actChart(act).bands"
            :x-ticks="[0, 60, 120, 180, 240, 300, 360]" :x-format="(v: number) => (v ? actionLabel(v) : '0')"
            :y-ticks="actChart(act).yTicks" :y-format="pctFmt" :ref-y="[1]" :height="170" caption=""
          >
            <template v-if="act.n >= 3" #legend><span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 18%, transparent)" /> 25–75%</span></template>
          </MiniBandChart>
        </ClientOnly>
        <p v-if="act.fit?.atLimit" class="alert small">
          A vércukor a kiválasztott inzulin leghosszabb hatásidején ({{ actionLabel(act.fit.maxDia) }}) túl is tovább esett, ezt az
          inzulin már nem magyarázza (pl. erős bázis vagy ráfekvés). Az illesztett érték ezért nem megbízható, a szerkesztőbe nem írjuk be.
        </p>
        <p v-else class="muted small">{{ actNote(act) }}</p>
      </template>
      <p v-else class="muted small">Még nincs tiszta korrekció. Akkor kerül ide, ha magas vércukorra étkezésen kívül adsz bólust, és utána pár óráig nem eszel.</p>
      <div v-if="segList.length > 1" class="clean-meals">
        <div v-for="s in segList" :key="s.index" class="clean-meal">
          <div class="tile-label">{{ s.start }}–{{ s.end }} <span class="muted">· {{ s.action?.n ?? 0 }} tiszta korrekció</span></div>
          <ClientOnly>
            <MiniBandChart
              :x="actChart(s.action).minutes" :lines="actChart(s.action).lines" :bands="actChart(s.action).bands"
              :x-ticks="[0, 120, 240, 360]" :x-format="(v: number) => (v ? actionLabel(v) : '0')"
              :y-ticks="actChart(s.action).yTicks" :y-format="pctFmt" :ref-y="[1]" :height="130" caption=""
            />
          </ClientOnly>
          <p class="muted small">{{ actNote(s.action) }}</p>
        </div>
      </div>
    </div>

    <div class="analysis-action">
      <h3>CH-arány ellenőrzése (étkezés utáni görbe)</h3>
      <p class="tp-what">Mutatja: tiszta étkezések után a vércukor a kezdőhöz képest · 4 óra múlva fölötte: kevés inzulin, alatta: sok</p>
      <div v-if="segList.length" class="clean-meals">
        <div v-for="s in segList" :key="s.index" class="clean-meal">
          <div class="tile-label">{{ s.start }}–{{ s.end }} <span class="muted">· {{ s.clean?.n ?? 0 }} tiszta étkezés</span></div>
          <p v-if="!s.clean" class="muted small clean-empty">Még nincs tiszta étkezés ebben a napszakban.</p>
          <ClientOnly v-else>
            <MiniBandChart
              :x="cleanChart(s).x" :lines="cleanChart(s).lines" :bands="s.clean.n >= 2 ? cleanChart(s).bands : []"
              :x-ticks="[0, 60, 120, 180, 240]" :x-format="minLabel"
              :y-ticks="cleanChart(s).yTicks" :y-format="(v: number) => signed(v)"
              :ref-y="[0]" :ref-x="[0]" :height="140"
              :caption="`Emelkedés ${signed(s.clean.rise)} mmol/L, csúcs ${fmt(s.clean.peakMin, 0)} perc után, 4 óra múlva ${signed(s.clean.d4h)}`"
            >
              <template v-if="s.clean.n >= 3" #legend><span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 18%, transparent)" /> 25–75%</span></template>
            </MiniBandChart>
          </ClientOnly>
          <p v-if="s.clean" class="muted small">4 óra múlva {{ signed(s.clean.d4h) }} mmol/L: {{ cleanVerdict(s.clean) }}.</p>
        </div>
      </div>
      <p v-else class="muted small">Még nincs tiszta étkezés. Akkor kerül ide, ha beírt CH-val és bólussal eszel, és utána 4 óráig nem eszel és nem adsz más bólust.</p>
    </div>
  </section>
</template>
