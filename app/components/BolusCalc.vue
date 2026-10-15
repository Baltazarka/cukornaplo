<script setup lang="ts">
// Bóluskalkulátor: a beírt szénhidrátból, a vércukorból (alapból a friss CGM-érték), a most érvényes
// napszak CH-arányából, érzékenységéből és célértékéből, valamint a még aktív inzulinból javasol adagot.
// Tájékoztató. A számolt szénhidrátot és adagot kérésre be lehet írni a naplóba is (a mostani időponttal).
const emit = defineEmits<{ (e: 'logged'): void }>()
const { data, refresh } = await useFetch<any>('/api/bolus-context', { key: 'bolus-context' })

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
const fpu = computed(() => {
  if (logCarbSub.value !== 'fatty' || !result.value || macroInvalid.value) return null
  return fpuSuggestion(fatV.value, proteinV.value, seg.value.icr, Number(data.value?.fpuPercent ?? 50))
})
const logDose = ref('')
const doseTouched = ref(false)
watch(() => result.value?.dose, (d) => {
  if (!doseTouched.value && d != null) logDose.value = String(d).replace('.', ',')
}, { immediate: true })
const doseV = computed(() => num(logDose.value))
const doseInvalid = computed(() => logInsulin.value && (doseV.value == null || doseV.value < 0.1 || doseV.value > 100))
const canLog = computed(() => (logCarbs.value && !!carbsV.value) || (logInsulin.value && !doseInvalid.value && (doseV.value ?? 0) > 0))
const logBusy = ref(false)
const logMsg = ref('')
const logErr = ref('')
useToastFrom(logMsg, 'success')
useToastFrom(logErr, 'error')
async function addEntry(body: Record<string, any>, force = false): Promise<void> {
  try {
    await $fetch('/api/entry-add', { method: 'POST', body: { ...body, force } })
  } catch (e: any) {
    // Hasonló bejegyzés a közelben (pl. véletlenül kétszer beírva): rákérdezünk.
    if (e?.data?.duplicate && !force && (await askConfirm(`${e.data.error}

Mégis felveszed?`, { confirmLabel: 'Felveszem' }))) return addEntry(body, true)
    if (e?.data?.duplicate) return
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
}
const resetTick = useState<number>('bolus-reset', () => 0)
watch(resetTick, clearInputs)

// --- Átvitel a Guardian appba: beírás után a CH és az adag egy sorban (GuardianLine) ---
const lastLogged = ref<{ carbs: number | null; dose: number | null } | null>(null)
// Új számolás kezdetén a sor eltűnik.
watch(carbs, (v) => { if (v.trim() !== '') lastLogged.value = null })

async function logToDiary() {
  logBusy.value = true
  logMsg.value = ''
  logErr.value = ''
  const done: string[] = []
  const logged: { carbs: number | null; dose: number | null } = { carbs: null, dose: null }
  try {
    if (logCarbs.value && carbsV.value) {
      // Zsíros ételnél a zsír / fehérje is elmentődik; plusz-javaslatnál a szerver 1,5 óra múlvára emlékeztetőt állít be.
      const macros = logCarbSub.value === 'fatty' && !macroInvalid.value ? { fat: fatV.value, protein: proteinV.value } : {}
      await addEntry({ type: 'carbs', value: carbsV.value, sub: logCarbSub.value, ...macros })
      done.push(`${fmt(carbsV.value, 0)} g CH`)
      logged.carbs = carbsV.value
    }
    if (logInsulin.value && doseV.value && !doseInvalid.value) {
      // Típussal: a CH-val együtt (vagy a kalkulátorba írt CH mellett) étkezési bólus, CH nélkül korrekció.
      const kind = carbsV.value ? 'meal' : 'correction'
      await addEntry({ type: 'insulin', value: doseV.value, sub: kind })
      done.push(`${fmt(doseV.value)} E ${kind === 'meal' ? 'étkezési bólus' : 'korrekció'}`)
      logged.dose = doseV.value
    }
    lastLogged.value = done.length ? logged : null
    logMsg.value = done.length ? `Beírva a naplóba: ${done.join(', ')}.` : 'Nem történt beírás.'
    // A beírt adatok a naplóba kerültek, a kalkulátor üres, készen áll a következőre.
    if (done.length) clearInputs()
    await refresh()
    emit('logged')
  } catch (e: any) {
    logErr.value = e?.data?.error ?? 'A beírás nem sikerült.'
  } finally {
    logBusy.value = false
  }
}

const low = computed(() => bgV.value != null && bgV.value < (data.value?.range.low ?? 3.9))
const ago = (min: number) => (min < 1 ? 'most' : min < 60 ? `${min} perce` : `${Math.floor(min / 60)} ó ${min % 60} p-e`)
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
          <span class="bc-input"><input v-model="carbs" type="text" inputmode="numeric" placeholder="0"><small>g</small></span>
        </label>
        <label>Vércukor
          <span class="bc-input"><input v-model="bg" type="text" inputmode="decimal" placeholder="–" @input="bgTouched = true"><small>mmol/L</small></span>
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
          <select v-model="logCarbSub" class="sub-select" aria-label="Étkezés típusa" :title="logCarbSub === 'fatty' ? CARB_TAG_HINT.fatty : logCarbSub === 'fast' ? CARB_TAG_HINT.fast : CARB_TAG_HINT.normal">
            <option value="" :title="CARB_TAG_HINT.normal">normál</option>
            <option value="fatty" :title="CARB_TAG_HINT.fatty">zsíros / fehérjedús</option>
            <option value="fast" :title="CARB_TAG_HINT.fast">gyors CH</option>
          </select>
        </label>
        <div v-if="carbsV && logCarbSub === 'fatty'" class="bc-log-row">
          <span class="muted">Ha tudod:</span>
          <label class="bc-fpu-in">zsír <span class="bc-input"><input v-model="fatG" type="text" inputmode="decimal" placeholder="0" aria-label="Zsír, gramm"><small>g</small></span></label>
          <label class="bc-fpu-in">fehérje <span class="bc-input"><input v-model="proteinG" type="text" inputmode="decimal" placeholder="0" aria-label="Fehérje, gramm"><small>g</small></span></label>
        </div>
        <p v-if="carbsV && logCarbSub === 'fatty' && fpu" class="muted bc-hint">
          Zsír-fehérje: kb. {{ fmt(fpu.units) }} egység (≈ {{ fmt(fpu.carbEq, 0) }} g CH) →
          <template v-if="fpu.extra >= 0.5">kb. <b>+{{ fmt(fpu.extra) }} E</b></template><template v-else>0,5 E alatt</template>
          (a varsói érték {{ fpu.pct }}%-a). Ez nincs benne a számolt adagban: a hatása kb. 1–1,5 óra múlva kezdődik és kb. {{ fpu.hours }} óráig tart,
          ezért a plusz adag később, vagy csak akkor jöhet szóba, ha a cukor emelkedik.<template v-if="fpu.extra >= 0.5"> Beírás után 1,5 óra múlva emlékeztető jön (ha be van kapcsolva).</template>
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
          <span class="muted">a javasolt: {{ fmt(result.dose) }} E</span>
        </label>
        <p v-if="doseInvalid" class="alert">Az adag 0,1–100 E között lehet.</p>
        <button type="button" :disabled="logBusy || !canLog" @click="logToDiary">Beírás a naplóba (most)</button>
        <p class="muted">Az adag a mostani időponttal kerül be. Írd át a tényleg beadott mennyiségre, ha eltér a javasolttól.</p>
      </div>

      <GuardianLine v-if="lastLogged" :carbs="lastLogged.carbs" :dose="lastLogged.dose" @close="lastLogged = null" />

      <div v-if="result" class="bc-warn small">
        <p v-if="low" class="alert">Alacsony a vércukor: előbb kezeld gyors szénhidráttal. Étkezési bólust csak rendeződés után adj.</p>
        <p v-if="result.capped" class="alert">A számított adag több a beállított maximális dózisnál ({{ fmt(data.maxBolus) }} E), ezért arra korlátoztuk.</p>
        <p v-if="bgV != null && bgV >= KETONE_BG" class="notice">{{ fmt(KETONE_BG, 0) }} mmol/L fölött ketonvizsgálat javasolt.</p>
        <p v-if="trendText && bgV != null" class="notice">{{ trendText }} A kalkulátor a trendet nem veszi figyelembe.</p>
        <p v-if="result.correction > 0 && data.iob > 0 && !useIob" class="notice">Az aktív inzulin levonása ki van kapcsolva: az egymásra adott korrekciók összeadódnak.</p>
      </div>

      <p class="muted small bc-note">
        Tájékoztató számítás a beállított terápiás értékekből{{ data.insulin ? ` (${data.insulin})` : '' }}. A beadott adagról te döntesz.
        Átmenet nélkül a napszakhatáron lépcsősen vált az érték; átmenettel a napszakok vége felé már a következő napszak felé közelít.
      </p>
    </template>
  </section>
</template>
