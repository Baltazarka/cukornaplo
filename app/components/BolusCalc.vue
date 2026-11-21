<script setup lang="ts">
// Bóluskalkulátor: a beírt szénhidrátból, a vércukorból (alapból a friss CGM-érték), a most érvényes
// napszak CH-arányából, érzékenységéből és célértékéből, valamint a még aktív inzulinból javasol adagot.
// Tájékoztató. A számolt szénhidrátot és adagot kérésre be lehet írni a naplóba is (a mostani időponttal).
const emit = defineEmits<{ (e: 'logged'): void }>()
const { data, refresh } = await useFetch<any>('/api/bolus-context', { key: 'bolus-context' })
const entriesChanged = useEntriesChanged()

/** A CGM-érték ennyi percig számít frissnek, utána kézzel kell beírni. */
const FRESH_MIN = 15
/** Ennél magasabb vércukornál ketonvizsgálat javasolt (mmol/L). */
const KETONE_BG = 14

const carbs = ref('')
const bg = ref('')
const bgTouched = ref(false)
const useIob = ref(true)
// Átmenet a napszakok között (a választás ebben a böngészőben megmarad).
const BLEND_KEY = 'cukornaplo.bolusBlend'
const useBlend = ref(true)
onMounted(() => {
  try { useBlend.value = localStorage.getItem(BLEND_KEY) !== '0' } catch { /* nincs tároló */ }
})
watch(useBlend, (v) => {
  try { localStorage.setItem(BLEND_KEY, v ? '1' : '0') } catch { /* nincs tároló */ }
})

const cgm = computed(() => data.value?.glucose ?? null)
const cgmFresh = computed(() => cgm.value && cgm.value.ageMin <= FRESH_MIN)
// A vércukor mezőt a friss CGM-értékkel töltjük, amíg kézzel nem írtál bele.
watchEffect(() => {
  if (!bgTouched.value) bg.value = cgmFresh.value ? fmt(cgm.value.v) : ''
})
function useCgm() {
  bgTouched.value = false
}

// Percenként és amikor visszatérsz a lapra, frissítjük (CGM, aktív inzulin, napszak).
let timer: ReturnType<typeof setInterval> | undefined
const onVisible = () => document.visibilityState === 'visible' && refresh()
onMounted(() => {
  timer = setInterval(refresh, 60_000)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})

const num = (s: string) => {
  const v = Number(String(s).replace(',', '.').trim())
  return s.trim() !== '' && Number.isFinite(v) ? v : null
}
function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

const seg = computed(() => data.value?.segment)
const blend = computed(() => data.value?.blend ?? null)
/** A számításhoz használt CH-arány és érzékenység: átmenettel vagy a napszak lépcsős értéke. */
const ratios = computed(() =>
  useBlend.value && blend.value ? { icr: blend.value.icr, isf: blend.value.isf } : { icr: seg.value.icr, isf: seg.value.isf },
)
const carbsV = computed(() => num(carbs.value))
const bgV = computed(() => num(bg.value))
const iob = computed(() => (useIob.value ? data.value?.iob ?? 0 : 0))
const invalid = computed(() =>
  (carbs.value.trim() !== '' && (carbsV.value == null || carbsV.value < 0 || carbsV.value > 400))
  || (bg.value.trim() !== '' && (bgV.value == null || bgV.value < 1 || bgV.value > 35)),
)
const result = computed(() => {
  if (!seg.value || invalid.value || (carbsV.value == null && bgV.value == null)) return null
  return calcBolus({
    carbs: carbsV.value ?? 0, bg: bgV.value, target: seg.value.target, isf: ratios.value.isf, icr: ratios.value.icr,
    iob: iob.value, maxBolus: data.value.maxBolus,
  })
})
// --- Beírás a naplóba (CH és/vagy bólus), a mostani időponttal ---
const logCarbs = ref(true)
const logInsulin = ref(true)
const logCarbSub = ref('')
// --- Zsíros étel: tájékoztató plusz-javaslat a varsói módszerrel (a számolt adag nem változik) ---
// 1 zsír-fehérje egység (FPU) = 100 kcal zsírból és fehérjéből, ennyi inzulin kell hozzá, mint 10 g CH-hoz;
// a hatása kb. 1–1,5 óra múlva kezdődik és a mennyiségtől függően 3–8 óráig tart. A beállított %-kal (Terápia),
// a napszak CH-arányával (ugyanígy számol a szerver az emlékeztetőnél; shared/utils/fpu.ts).
const fatG = ref('')
const proteinG = ref('')
const fatV = computed(() => num(fatG.value))
const proteinV = computed(() => num(proteinG.value))
const macroInvalid = computed(() => [fatV.value, proteinV.value].some((v) => v != null && (v < 0 || v > MACRO_MAX_G)))
/** A Terápia oldalon beállított időzítés: egyben, evéskor (különben később, emlékeztetővel). */
const fpuTogether = computed(() => data.value?.fpuTiming === 'together')
/** 5 órán belüli zsíros étkezés zsír-fehérje javaslattal (a szerver adja; a korrekció ezzel átfed). */
const fpuRecent = computed(() => data.value?.recentFpu ?? null)
const fpu = computed(() => {
  if (logCarbSub.value !== 'fatty' || !result.value || macroInvalid.value) return null
  return fpuSuggestion(fatV.value, proteinV.value, seg.value.icr, Number(data.value?.fpuPercent ?? 50))
})
/** Egyben adásnál a zsír-fehérje plusz adag (a beírási mezőbe az összeg kerül); különben 0. */
const fpuTogetherExtra = computed(() => (fpuTogether.value && fpu.value && fpu.value.extra >= 0.5 ? fpu.value.extra : 0))
/** Az összeg (étkezési + egyben adott zsír-fehérje) a beállított maximális dózisig; e fölött a különbség. */
const togetherSum = computed(() => (result.value ? result.value.dose + fpuTogetherExtra.value : 0))
/** A beírható legnagyobb adag: a maximális dózis a lépésközre (0,5 E) lefelé kerekítve, mint a kalkulátor adagja. */
const maxDose = computed(() => (data.value?.maxBolus ? Math.floor(data.value.maxBolus / 0.5 + 1e-9) * 0.5 : Infinity))
const togetherOverMax = computed(() => (fpuTogetherExtra.value && data.value?.maxBolus ? Math.max(0, togetherSum.value - maxDose.value) : 0))
const logDose = ref('')
const doseTouched = ref(false)
// A beírási mezőbe a javasolt adag kerül (egyben adásnál a zsír-fehérje plusszal együtt, legfeljebb a maximális
// dózisig), amíg kézzel át nem írod. Ha utána a CH-t, a vércukrot vagy a jelölést módosítod, újra a javasolt jön.
function syncDose() {
  const d = result.value?.dose
  if (doseTouched.value || d == null) return
  const extra = fpuTogetherExtra.value
  const v = extra ? Math.min(d + extra, maxDose.value) : d
  logDose.value = String(v).replace('.', ',')
}
watch(() => [result.value?.dose, fpuTogetherExtra.value, data.value?.maxBolus] as const, syncDose, { immediate: true })
// Csak a kézi módosításra (a CGM-frissítés a vércukor mezőt magától is átírja: az nem írhatja felül a beírt adagot).
function inputChanged() {
  if (!doseTouched.value) return
  doseTouched.value = false
  nextTick(syncDose)
}
const doseV = computed(() => num(logDose.value))
// Üres vagy 0 adag nem hiba (pl. nem kell inzulin): olyankor bólus nem kerül a naplóba.
const doseInvalid = computed(() => logInsulin.value && logDose.value.trim() !== '' && doseV.value !== 0
  && (doseV.value == null || doseV.value < 0.1 || doseV.value > 100))
const canLog = computed(() => (logCarbs.value && !!carbsV.value) || (logInsulin.value && !doseInvalid.value && (doseV.value ?? 0) > 0))
const logBusy = ref(false)
const logMsg = ref('')
const logErr = ref('')
useToastFrom(logMsg, 'success')
useToastFrom(logErr, 'error')
/** Felvesz egy bejegyzést; false, ha a hasonló közeli bejegyzés miatt mégsem kérted (dupla). */
async function addEntry(body: Record<string, any>, force = false): Promise<boolean> {
  try {
    await $fetch('/api/entry-add', { method: 'POST', body: { ...body, force } })
    return true
  } catch (e: any) {
    // Hasonló bejegyzés a közelben (pl. véletlenül kétszer beírva): rákérdezünk.
    if (e?.data?.duplicate && !force && (await askConfirm(`${e.data.error}

Mégis felveszed?`, { confirmLabel: 'Felveszem' }))) return addEntry(body, true)
    if (e?.data?.duplicate) return false
    throw e
  }
}
// A kalkulátor kiürítése: beírt CH, kézi vércukor, javasolt/átírt adag (a frissítés gomb is ezt hívja).
function clearInputs() {
  carbs.value = ''
  bgTouched.value = false
  logCarbSub.value = ''
  fatG.value = ''
  proteinG.value = ''
  logDose.value = ''
  doseTouched.value = false
  logCarbs.value = true
  logInsulin.value = true
}
const resetTick = useState<number>('bolus-reset', () => 0)
watch(resetTick, clearInputs)

// --- Átvitel a Guardian appba: beírás után a CH és az adag egy sorban (GuardianLine) ---
const lastLogged = ref<{ carbs: number | null; dose: number | null } | null>(null)
// Új számolás kezdetén a sor eltűnik.
watch(carbs, (v) => { if (v.trim() !== '') { lastLogged.value = null; logCarbs.value = true; logInsulin.value = true } })

async function logToDiary() {
  logBusy.value = true
  logMsg.value = ''
  logErr.value = ''
  const done: string[] = []
  const logged: { carbs: number | null; dose: number | null } = { carbs: null, dose: null }
  let skipped = false
  try {
    if (logCarbs.value && carbsV.value) {
      // Zsíros ételnél a zsír / fehérje is elmentődik; plusz-javaslatnál a szerver 1,5 óra múlvára emlékeztetőt állít be.
      const macros = logCarbSub.value === 'fatty' && !macroInvalid.value ? { fat: fatV.value, protein: proteinV.value } : {}
      if (await addEntry({ type: 'carbs', value: carbsV.value, sub: logCarbSub.value, ...macros })) {
        done.push(`${fmt(carbsV.value, 0)} g CH`)
        logged.carbs = carbsV.value
      } else skipped = true
    }
    if (logInsulin.value && doseV.value && !doseInvalid.value) {
      // Típussal: a CH-val együtt (vagy a kalkulátorba írt CH mellett) étkezési bólus, CH nélkül korrekció.
      const kind = carbsV.value ? 'meal' : 'correction'
      // A számítás bontása is elmentődik, hogy utólag látszódjon, mennyi volt az ételre és mennyi a korrekció.
      const r = result.value
      const calc = r ? {
        carbs: carbsV.value ?? 0, bg: bgV.value, icr: ratios.value.icr, isf: ratios.value.isf, target: seg.value.target,
        carbDose: r.carbDose, correction: r.correction, iobUsed: r.iobUsed, total: r.total, dose: r.dose, fpu: fpuTogetherExtra.value || null,
      } : undefined
      if (await addEntry({ type: 'insulin', value: doseV.value, sub: kind, calc })) {
        done.push(`${fmt(doseV.value)} E ${kind === 'meal' ? 'étkezési bólus' : 'korrekció'}`)
        logged.dose = doseV.value
      } else skipped = true
    }
    // Részleges beírás utáni újrapróbálásnál a korábban beírt CH is megmarad a Guardian-sorban.
    lastLogged.value = done.length ? { carbs: logged.carbs ?? lastLogged.value?.carbs ?? null, dose: logged.dose ?? lastLogged.value?.dose ?? null } : null
    logMsg.value = done.length ? `Beírva a naplóba: ${done.join(', ')}.` : skipped ? '' : 'Nem történt beírás.'
    // Ha minden a naplóba került, a kalkulátor üres, készen áll a következőre (dupla miatt kihagyottnál megmarad).
    if (done.length && !skipped) clearInputs()
    else {
      // A már beírt részt újra ne küldje.
      if (logged.carbs != null) logCarbs.value = false
      if (logged.dose != null) logInsulin.value = false
    }
  } catch (e: any) {
    // Részleges hiba (pl. a CH bekerült, a bólus nem): a már beírt CH-t újra ne küldje, csak a bólust.
    if (logged.carbs != null) {
      logCarbs.value = false
      lastLogged.value = logged
    }
    logErr.value = (done.length ? `Beírva: ${done.join(', ')}. ` : '') + (e?.data?.error ?? 'A beírás nem sikerült.')
  } finally {
    logBusy.value = false
  }
  if (done.length) {
    entriesChanged()
    await refresh().catch(() => null)
    emit('logged')
  }
}

const low = computed(() => bgV.value != null && bgV.value < (data.value?.range.low ?? 3.9))
const ago = (min: number) => (min < 1 ? 'most' : min < 60 ? `${min} perce` : `${Math.floor(min / 60)} ó ${min % 60} p-e`)
// Esik a vércukor, és a számítás pozitív korrekciót ad: a korrekció a mostani értékre számol, az esést nem látja.
const fallingCorrection = computed(() => !!(cgmFresh.value && cgm.value?.trend && cgm.value.trend.dir < 0 && bgV.value != null && result.value && result.value.correction > 0))
const trendText = computed(() => {
  const t = cgm.value?.trend
  if (!t || t.level < 2) return ''
  return t.dir > 0 ? 'Gyorsan emelkedik.' : 'Gyorsan csökken.'
})
</script>

<template>
  <section class="card bolus-calc" aria-labelledby="bolus-title">
    <div class="card-head">
      <h2 id="bolus-title">Bóluskalkulátor <GuideLink section="bolus" /></h2>
      <span v-if="seg" class="muted small">{{ seg.start === seg.end ? 'egész nap' : `${seg.start}–${seg.end}` }}</span>
    </div>

    <p v-if="data && !data.therapySet" class="muted">
      A számításhoz előbb add meg a <NuxtLink to="/terapia">terápiás beállításokat</NuxtLink> (CH-arány, érzékenység, célérték).
    </p>
    <template v-else-if="seg">
      <form class="bc-form" @submit.prevent>
        <label>Szénhidrát
          <span class="bc-input"><input v-model="carbs" type="text" inputmode="numeric" placeholder="0" @input="inputChanged"><small>g</small></span>
        </label>
        <label>Vércukor
          <span class="bc-input"><input v-model="bg" type="text" inputmode="decimal" placeholder="–" @input="bgTouched = true; inputChanged()"><small>mmol/L</small></span>
        </label>
      </form>
      <div class="bc-cgm small">
        <template v-if="cgm">
          {{ cgm.manual ? 'Kézi mérés' : 'CGM' }}: <b>{{ cgm.manual ? fmt(cgm.v) : sgText(cgm.v) }}</b>
          <TrendArrows v-if="cgm.trend" :dir="cgm.trend.dir" :level="cgm.trend.level" />
          <span class="muted">{{ ago(cgm.ageMin) }}</span>
          <span v-if="cgm.manual" class="note-chip manual-chip" title="Kézzel felvitt vércukor, nem szenzoradat">kézi</span>
          <span v-if="!cgmFresh" class="err-text"> · régi, írd be a mért értéket</span>
          <button v-if="bgTouched && cgmFresh" type="button" class="link-btn" @click="useCgm">CGM-érték</button>
        </template>
        <span v-else class="muted">Nincs friss CGM-érték, írd be a mért vércukrot.</span>
      </div>
      <label class="bc-iob small">
        <input v-model="useIob" type="checkbox">
        Aktív inzulin levonása <b>{{ fmt(data.iob) }} E</b>
        <span v-if="data.lastBolus" class="muted">(utolsó: {{ fmt(data.lastBolus.v) }} E, {{ ago(data.lastBolus.minutesAgo) }})</span>
      </label>

      <label v-if="blend" class="bc-iob small">
        <input v-model="useBlend" type="checkbox">
        Átmenet a napszakok között
        <span class="muted">
          (most {{ fmt(blend.icr, 2) }} g/E és {{ fmt(blend.isf, 2) }} mmol/L/E: {{ seg.start }} {{ fmt(seg.icr) }} → {{ blend.next.start }} {{ fmt(blend.next.icr) }} g/E)
        </span>
      </label>

      <p v-if="invalid" class="alert small">Ellenőrizd a beírt értékeket (szénhidrát 0–400 g, vércukor 1–35 mmol/L).</p>

      <div v-if="result" class="bc-result" aria-live="polite">
        <dl class="bc-lines">
          <div v-if="carbsV">
            <dt>Étkezés <span class="muted">{{ fmt(carbsV, 0) }} g ÷ {{ fmt(ratios.icr, 2) }} g/E</span></dt>
            <dd>{{ fmt(result.carbDose, 2) }} E</dd>
          </div>
          <div v-if="bgV != null">
            <dt>Korrekció <span class="muted">({{ fmt(bgV) }} − {{ fmt(seg.target) }}) ÷ {{ fmt(ratios.isf, 2) }}</span></dt>
            <dd>{{ result.correction > 0 ? '+' : '' }}{{ fmt(result.correction, 2) }} E</dd>
          </div>
          <div v-if="result.iobUsed > 0">
            <dt>Aktív inzulin <span class="muted">{{ result.iobFromMeal ? 'célérték alatt az étkezésiből' : 'a korrekcióból' }}</span></dt>
            <dd>−{{ fmt(result.iobUsed, 2) }} E</dd>
          </div>
          <div class="bc-sum"><dt>Számított</dt><dd>{{ fmt(result.total, 2) }} E</dd></div>
        </dl>
        <div class="bc-dose">
          <span class="tile-label">Javasolt adag</span>
          <span class="bc-dose-v">{{ fmt(result.dose) }} <small>E</small></span>
          <span class="muted small">0,5 E-re lefelé kerekítve</span>
        </div>
      </div>

      <div v-if="result && (carbsV || result.dose > 0)" class="bc-log small">
        <b>Beírás a naplóba</b>
        <label v-if="carbsV" class="bc-log-row">
          <span class="bc-log-check"><input v-model="logCarbs" type="checkbox"> CH <b>{{ fmt(carbsV, 0) }} g</b></span>
          <select v-model="logCarbSub" class="sub-select" @change="inputChanged" aria-label="Étkezés típusa" :title="logCarbSub === 'fatty' ? CARB_TAG_HINT.fatty : logCarbSub === 'fast' ? CARB_TAG_HINT.fast : CARB_TAG_HINT.normal">
            <option value="" :title="CARB_TAG_HINT.normal">normál</option>
            <option value="fatty" :title="CARB_TAG_HINT.fatty">{{ CARB_TAG_ICON.fatty }} zsíros / fehérjedús</option>
            <option value="fast" :title="CARB_TAG_HINT.fast">{{ CARB_TAG_ICON.fast }} gyors CH</option>
          </select>
          <GuideLink section="zsiros" text="Zsíros ételek" label="Mit jelölj zsírosnak? Példák táblázattal" />
        </label>
        <div v-if="carbsV && logCarbSub === 'fatty'" class="bc-log-row">
          <span class="muted">Ha tudod:</span>
          <label class="bc-fpu-in">zsír <span class="bc-input"><input v-model="fatG" type="text" inputmode="decimal" placeholder="0" aria-label="Zsír, gramm" @input="inputChanged"><small>g</small></span></label>
          <label class="bc-fpu-in">fehérje <span class="bc-input"><input v-model="proteinG" type="text" inputmode="decimal" placeholder="0" aria-label="Fehérje, gramm" @input="inputChanged"><small>g</small></span></label>
        </div>
        <p v-if="carbsV && logCarbSub === 'fatty' && fpu" class="muted bc-hint">
          Zsír-fehérje: kb. {{ fmt(fpu.units) }} egység (≈ {{ fmt(fpu.carbEq, 0) }} g CH) →
          <template v-if="fpu.extra >= 0.5">kb. <b>+{{ fmt(fpu.extra) }} E</b></template><template v-else>0,5 E alatt</template>
          (a varsói érték {{ fpu.pct }}%-a). Ez nincs benne a számolt adagban; a hatása kb. 1–1,5 óra múlva kezdődik és kb. {{ fpu.hours }} óráig tart.
          <template v-if="fpuTogether && fpu.extra >= 0.5">
            Egyben adva: <b>{{ fmt(result.dose) }} + {{ fmt(fpu.extra) }} = {{ fmt(result.dose + fpu.extra) }} E</b>.
            Az első 1–1,5 órában ilyenkor több inzulin hat, mint amennyi CH felszívódik: korai hipó lehet, nézd meg a cukrot 60–90 perc múlva.
            Beírás után 75 perc múlva ellenőrző emlékeztető jön (ha be van kapcsolva).
          </template>
          <template v-else-if="fpu.extra >= 0.5">A plusz adag később, vagy csak akkor jöhet szóba, ha a cukor emelkedik. Beírás után 1,5 óra múlva emlékeztető jön (ha be van kapcsolva).</template>
        </p>
        <p v-else-if="carbsV && logCarbSub === 'fatty'" class="muted bc-hint">
          A zsír és a fehérje később (1–1,5 óra múlva, órákig) emel. Ha megadod a grammjukat, kiírom, mennyi plusz inzulin jönne ki rá (tájékoztató, a számolt adag nem változik).
        </p>
        <p v-if="carbsV && logCarbSub === 'fast'" class="muted bc-hint">
          Gyors CH: grammonként ugyanannyi inzulin kell hozzá, csak gyorsabban emel, mint ahogy az inzulin hatni kezd. Ha lehet, az adagot 10–15 perccel evés előtt add be. Hipó kezelésére bevitt gyors CH-hoz nem kell inzulin.
        </p>
        <label class="bc-log-row">
          <span class="bc-log-check"><input v-model="logInsulin" type="checkbox"> Bólus</span>
          <span class="bc-input"><input v-model="logDose" type="text" inputmode="decimal" aria-label="A beadott adag" @input="doseTouched = true"><small>E</small></span>
          <span class="muted">a javasolt: {{ fmt(result.dose) }} E<template v-if="fpuTogetherExtra"> + {{ fmt(fpuTogetherExtra) }} E zsír-fehérje</template></span>
        </label>
        <p v-if="togetherOverMax" class="alert">Az összeg ({{ fmt(togetherSum) }} E) több a beállított maximális dózisnál ({{ fmt(data.maxBolus) }} E): a mezőbe a maximum került. A különbséget ({{ fmt(togetherOverMax) }} E) később add be, ha a cukor emelkedik, vagy egyeztesd a diabetológussal.</p>
        <p v-if="doseInvalid" class="alert">Az adag 0,1–100 E között lehet.</p>
        <button type="button" :disabled="logBusy || !canLog" @click="logToDiary">Beírás a naplóba (most)</button>
        <p class="muted">Az adag a mostani időponttal kerül be. Írd át a tényleg beadott mennyiségre, ha eltér a javasolttól.</p>
      </div>

      <GuardianLine v-if="lastLogged" :carbs="lastLogged.carbs" :dose="lastLogged.dose" @close="lastLogged = null" />

      <div v-if="result" class="bc-warn small">
        <p v-if="low" class="alert">Alacsony a vércukor: előbb kezeld gyors szénhidráttal. Étkezési bólust csak rendeződés után adj.</p>
        <p v-if="result.capped" class="alert">A számított adag több a beállított maximális dózisnál ({{ fmt(data.maxBolus) }} E), ezért arra korlátoztuk.</p>
        <!-- 5 órán belüli zsíros étel zsír-fehérje javaslattal: a korrekció ezzel átfed (a mostani emelkedés egy része már a zsír-fehérje hatása). -->
        <p v-if="fpuRecent && result.correction > 0" class="notice">
          {{ fpuRecent.time }}-kor zsíros étel volt (zsír-fehérje javaslat: +{{ fmt(fpuRecent.extra) }} E, a hatása kb. {{ fpuRecent.hours }} óráig tart).
          <template v-if="fpuRecent.timing === 'together'">A plusz adagot a beállítás szerint evéskor egyben adtad: ezt a korrekció aktív inzulinként már levonja, ne pótold még egyszer.</template>
          <template v-else-if="fpuRecent.givenSince >= 0.5">Azóta {{ fmt(fpuRecent.givenSince) }} E inzulint adtál be: ezt a korrekció már levonja, a pluszt ne add rá még egyszer.</template>
          <template v-else>Ez a korrekció a zsír-fehérje további hatását nem ismeri: a kettő átfed, ne add össze, a nagyobbat vedd figyelembe.</template>
        </p>
        <p v-if="bgV != null && bgV >= KETONE_BG" class="notice">{{ fmt(KETONE_BG, 0) }} mmol/L fölött ketonvizsgálat javasolt.</p>
        <p v-if="fallingCorrection" class="notice">Esik a vércukor{{ cgm.trend.level >= 2 ? ' gyorsan' : '' }}: a korrekciós rész (+{{ fmt(result.correction) }} E) túl sok lehet. A kalkulátor a trendet nem veszi figyelembe.</p>
        <p v-else-if="trendText && bgV != null" class="notice">{{ trendText }} A kalkulátor a trendet nem veszi figyelembe.</p>
        <p v-if="result.correction > 0 && data.iob > 0 && !useIob" class="notice">Az aktív inzulin levonása ki van kapcsolva: az egymásra adott korrekciók összeadódnak.</p>
      </div>

      <p class="muted small bc-note">
        Tájékoztató számítás a beállított terápiás értékekből{{ data.insulin ? ` (${data.insulin})` : '' }}. A beadott adagról te döntesz.
        Átmenet nélkül a napszakhatáron lépcsősen vált az érték; átmenettel a napszakok vége felé már a következő napszak felé közelít.
      </p>
    </template>
  </section>
</template>
