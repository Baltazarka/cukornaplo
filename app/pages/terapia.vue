<script setup lang="ts">
// Terápiás beállítások kézi szerkesztése (célérték, ISF, CH-arány, hatásidő napszakonként).
import type { Therapy, TherapySegment } from '#shared/types/therapy'

const { data } = await useFetch<{ therapy: Therapy | null; shift: any }>('/api/therapy', { key: 'therapy' })

type EditSegment = { start: string; target: number | ''; isf: number | ''; icr: number | ''; actionMinutes: number | ''; key: number }
let nextKey = 0
const toEdit = (s: Partial<TherapySegment>): EditSegment => ({
  start: s.start ?? '00:00', target: s.target ?? '', isf: s.isf ?? '', icr: s.icr ?? '', actionMinutes: s.actionMinutes ?? '', key: nextKey++,
})

const t = data.value?.therapy
const bolusInsulin = ref<string>(t?.bolusInsulin ?? '')
const basalInsulin = ref<string>(t?.basalInsulin ?? '')
const bolusOptions = INSULINS.filter((i) => i.kind === 'bolus')
const basalOptions = INSULINS.filter((i) => i.kind === 'basal')
const bolusInfo = computed(() => insulinById(bolusInsulin.value))
const basalInfo = computed(() => insulinById(basalInsulin.value))
const maxBolus = ref<number | ''>(t?.maxBolus ?? '')
// A bázis automatikus beírása: naponta a megadott időpontban a naplóba kerül (push értesítéssel).
const basalAutoOn = ref<boolean>(!!t?.basalAuto)
const basalAutoTime = ref<string>(t?.basalAuto?.time ?? '07:00')
const basalAutoUnits = ref<number | ''>(t?.basalAuto?.units ?? '')
const actionMinutes = ref<number>(t?.actionMinutes ?? 240)
const fpuPercent = ref<number>(t?.fpuPercent ?? 50)
const fpuTiming = ref<'later' | 'together'>(t?.fpuTiming ?? 'later')
const fpuOptions = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const byTimeOfDay = ref<boolean>(t?.byTimeOfDay ?? true)
const segments = ref<EditSegment[]>(t ? t.segments.map(toEdit) : [toEdit({ start: '06:00' })])
// Váltott műszak: külön napszakbeállítás a délutános hétre (bekapcsoláskor az alap másolatával indul).
const altEnabled = ref<boolean>(!!t?.altEnabled)
const altSegments = ref<EditSegment[]>(t?.altSegments?.length ? t.altSegments.map(toEdit) : [])
const freeProfile = ref<'base' | 'alt'>(t?.freeProfile ?? 'base')
watch(altEnabled, (on) => {
  if (on && !altSegments.value.length) altSegments.value = segments.value.map(({ key, ...s }) => toEdit({ ...s, target: s.target || undefined, isf: s.isf || undefined, icr: s.icr || undefined, actionMinutes: s.actionMinutes || undefined }))
})
const shiftOn = computed(() => !!data.value?.shift?.enabled)
const newKey = () => nextKey++
const baseEd = ref<{ add: () => void } | null>(null)
const altEd = ref<{ add: () => void } | null>(null)

// 2:00–8:00 negyedórás lépésekben, ahogy az InPen is kínálja.
const actionOptions = Array.from({ length: (480 - 120) / 15 + 1 }, (_, i) => 120 + i * 15)

// Kikapcsolt napszakbeállításnál csak a legkorábban kezdődő napszak érvényes (a többi megmarad).
const visible = computed(() =>
  byTimeOfDay.value ? segments.value : [...segments.value].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start)).slice(0, 1),
)

// Tájékoztatás a napi összinzulinból (TDD, az utolsó 30 nap átlaga, bázissal): az ökölszabályok szerinti kiinduló
// értékek (ISF ≈ 100 ÷ TDD mmol/L/E, CH-arány ≈ 500 ÷ TDD g/E). Nem tiltás és nem javaslat: a szabály csak kiindulópont,
// a beállítás a diabetológus döntése. Csak akkor emeljük ki, ha az ISF több mint kétszeresen eltér a szabálytól.
const { data: period } = await useFetch<any>('/api/agp', { query: { days: 30 }, key: 'agp-30-tdd' })
const tdd = computed(() => {
  const t = period.value?.totals
  return t && t.penDays >= 3 && t.insulinPerDay > 0 ? (t.insulinPerDay as number) : null
})
const rule = computed(() => (tdd.value ? { isf: 100 / tdd.value, icr: 500 / tdd.value } : null))
const isfOff = computed(() => {
  if (!rule.value) return []
  return visible.value
    .filter((s) => Number(s.isf) > 0 && (Number(s.isf) > rule.value!.isf * 2 || Number(s.isf) < rule.value!.isf / 2))
    .map((s) => s.start)
})
const hu = (v: number, dec = 1) => v.toLocaleString('hu-HU', { maximumFractionDigits: dec })


// A becslések átvétele a szerkesztőbe (napszak-kezdet szerint párosítva); menteni külön kell.
const applied = ref('')
function applyEstimates(values: { start: string; isf?: number; icr?: number; actionMinutes?: number }[]) {
  const sorted = [...segments.value].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start))
  const changed: string[] = []
  for (const v of values) {
    const row = byTimeOfDay.value ? segments.value.find((s) => s.start === v.start) : sorted[0]
    if (!row) continue
    const parts: string[] = []
    if (v.isf != null) { row.isf = v.isf; parts.push('ISF') }
    if (v.icr != null) { row.icr = v.icr; parts.push('CH-arány') }
    if (v.actionMinutes != null) { row.actionMinutes = v.actionMinutes; parts.push('hatásidő') }
    if (parts.length) changed.push(`${row.start}: ${parts.join(', ')}`)
  }
  applied.value = '' // az ismételt, azonos üzenet is jelenjen meg
  applied.value = changed.length ? `Beírtam a becsléseket (${changed.join('; ')}). Nézd át, és ha jó, mentsd.` : ''
  if (changed.length) document.querySelector('.therapy-edit-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// A saját zsír-fehérje % átvétele a szerkesztőbe (menteni külön kell).
function applyFpu(pct: number) {
  fpuPercent.value = pct
  applied.value = ''
  applied.value = `A zsír-fehérje javaslatot ${pct}%-ra állítottam. Nézd át, és ha jó, mentsd.`
  document.querySelector('.fpu-select')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const errors = ref<string[]>([])
useToastFrom(applied, 'info')
useToastFrom(errors, 'error')
const saving = ref(false)
async function save() {
  saving.value = true
  errors.value = []
  try {
    await $fetch('/api/therapy', {
      method: 'POST',
      body: {
        bolusInsulin: bolusInsulin.value || null,
        basalInsulin: basalInsulin.value || null,
        basalAuto: { enabled: basalAutoOn.value, time: basalAutoTime.value, units: basalAutoUnits.value },
        maxBolus: maxBolus.value,
        actionMinutes: actionMinutes.value,
        fpuPercent: fpuPercent.value,
        fpuTiming: fpuTiming.value,
        byTimeOfDay: byTimeOfDay.value,
        segments: segments.value.map(({ start, target, isf, icr, actionMinutes }) => ({ start, target, isf, icr, actionMinutes: actionMinutes || null })),
        altEnabled: altEnabled.value,
        altSegments: altSegments.value.map(({ start, target, isf, icr, actionMinutes }) => ({ start, target, isf, icr, actionMinutes: actionMinutes || null })),
        freeProfile: freeProfile.value,
      },
    })
    await refreshNuxtData('therapy')
    await navigateTo('/')
  } catch (e: any) {
    errors.value = e?.data?.errors ?? ['A mentés nem sikerült.']
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main>
    <form class="card therapy-edit" @submit.prevent="save">
      <h1>Terápiás beállítások</h1>
      <p class="muted small">A diabetológussal egyeztetett terápiás értékek. Ezekből számol a bóluskalkulátor, az aktív inzulin, az előrejelzés és az elemzés; tájékoztató jellegűek, a beadott adagról te döntesz.</p>


      <div class="therapy-fields">
        <div class="tf-row">
          <span class="tf-label">Étkezésalapú terápia</span>
          <span>Szénhidrátszámolás</span>
        </div>
        <label class="tf-row">
          <span class="tf-label">Bólusinzulin</span>
          <select v-model="bolusInsulin">
            <option value="">Nincs megadva</option>
            <option v-for="i in bolusOptions" :key="i.id" :value="i.id">{{ i.name }} ({{ i.generic }})</option>
          </select>
        </label>
        <label class="tf-row">
          <span class="tf-label">Bázisinzulin</span>
          <select v-model="basalInsulin">
            <option value="">Nincs megadva</option>
            <option v-for="i in basalOptions" :key="i.id" :value="i.id">{{ i.name }} ({{ i.generic }})</option>
          </select>
        </label>
        <label class="tf-row">
          <span class="tf-label">Bázis automatikus beírása</span>
          <input v-model="basalAutoOn" type="checkbox" class="switch" role="switch">
        </label>
        <template v-if="basalAutoOn">
          <label class="tf-row">
            <span class="tf-label">Beadás időpontja</span>
            <input v-model="basalAutoTime" type="time" required>
          </label>
          <label class="tf-row">
            <span class="tf-label">Bázisadag</span>
            <span class="tf-input"><input v-model.number="basalAutoUnits" type="number" step="0.5" min="1" max="100" required> E</span>
          </label>
          <p class="muted small">
            Naponta ekkor beírja a naplóba bázisként, és push értesítést küld róla (ha aznap még nincs bázis beírva). Ha más
            adagot adtál be, vagy kimaradt, a naplóban javíthatod vagy törölheted; ha aznap kézzel írod be a bázist, az
            automatikus sor helyére lép.
          </p>
        </template>
        <label class="tf-row">
          <span class="tf-label">Kiszámított maximális dózis</span>
          <span class="tf-input"><input v-model.number="maxBolus" type="number" step="0.5" min="0.5" max="50" required> E</span>
        </label>
        <label class="tf-row">
          <span class="tf-label">Inzulinhatás időtartama</span>
          <select v-model.number="actionMinutes">
            <option v-for="m in actionOptions" :key="m" :value="m">{{ actionLabel(m) }}</option>
          </select>
        </label>
        <div v-if="bolusInfo?.peakMinutes" class="tf-curve">
          <ClientOnly><InsulinCurve :peak-minutes="bolusInfo.peakMinutes" :duration-minutes="actionMinutes" :height="150" /></ClientOnly>
          <p class="muted small">
            A görbe az OpenAPS / Loop exponenciális modelljével készül: a csúcs ideje az inzulin típusától függ
            ({{ bolusInfo.name }}: {{ actionLabel(bolusInfo.peakMinutes) }}), a hossza a fenti hatásidő.
            <template v-if="bolusInfo.facts">Alkalmazási előírás: hatáskezdet {{ bolusInfo.facts.onset }}, legerősebb hatás {{ bolusInfo.facts.peak }}, hatástartam {{ bolusInfo.facts.duration }}.</template>
          </p>
        </div>
        <label class="tf-row">
          <span class="tf-label">Zsír-fehérje javaslat</span>
          <select v-model.number="fpuPercent" class="fpu-select">
            <option v-for="p in fpuOptions" :key="p" :value="p">{{ p === 0 ? 'nincs' : `a varsói érték ${p}%-a` }}</option>
          </select>
        </label>
        <label class="tf-row">
          <span class="tf-label">A plusz adag ideje</span>
          <select v-model="fpuTiming" :disabled="!fpuPercent">
            <option value="later">később, ha emelkedik (emlékeztető 1,5 óra múlva)</option>
            <option value="together">egyben, evéskor az étkezési bólussal</option>
          </select>
        </label>
        <p class="muted small">
          Zsíros / fehérjedús étkezésnél a bóluskalkulátor a számolt adag alatt tájékoztatásul kiírja, mennyi plusz inzulin
          jönne ki a zsír és a fehérje grammjából (1 zsír-fehérje egység = 100 kcal zsírból és fehérjéből ≈ 10 g CH), és
          mikorra. A teljes érték sokaknál későbbi hipót okoz; a szorzót a diabetológussal egyeztesd.
          <b>Egyben</b> adva a zsír hatása még nem kezdődött el, amikor az inzulin a legerősebb (1–1,5 óra): korai hipó lehet,
          ezért ilyenkor 75 perc múlva ellenőrző emlékeztető jön. <b>Később</b> adva 1,5 óra múlva emlékeztet a plusz adagra.
        </p>
        <p v-if="basalInfo?.facts" class="muted small tf-note">
          <b>{{ basalInfo.name }}</b> (alkalmazási előírás): {{ [basalInfo.facts.peak, basalInfo.facts.duration, basalInfo.facts.note].filter(Boolean).join(', ') }}.
        </p>
        <label class="tf-row">
          <span class="tf-label">Napszakbeállítások</span>
          <input v-model="byTimeOfDay" type="checkbox" class="switch" role="switch">
        </label>
      </div>

      <h3 v-if="altEnabled" class="seg-profile-h">Délelőttös hét és minden más nap</h3>
      <SegmentsEditor ref="baseEd" :segments="segments" :by-time-of-day="byTimeOfDay" :action-minutes="actionMinutes" :action-options="actionOptions" :new-key="newKey" />
      <div v-if="byTimeOfDay" class="btn-row">
        <button type="button" class="ghost sm" :disabled="segments.length >= 12" @click="baseEd?.add()">+ Napszak</button>
      </div>
      <p v-if="rule" class="muted small">
        Tájékoztatásul: a napi összinzulinod átlaga {{ hu(tdd!, 0) }} E (utolsó 30 nap, bázissal). Az ökölszabályok szerinti kiinduló érték ehhez
        ISF ≈ {{ hu(rule.isf) }} mmol/L/E (100 ÷ TDD) és CH-arány ≈ {{ hu(rule.icr) }} g/E (500 ÷ TDD). Ezek csak kiindulópontok, a saját értékeid ettől eltérhetnek.
      </p>
      <p v-if="isfOff.length" class="notice small" role="note">
        <b>Egyeztesd:</b> az ISF{{ byTimeOfDay ? ` (${isfOff.join(', ')})` : '' }} több mint kétszeresen eltér a napi összinzulinodból számolt kiinduló értéktől.
        Az előrejelzés és a javaslatok erre épülnek, ezért érdemes a diabetológussal átbeszélni.
      </p>
      <p v-if="byTimeOfDay" class="muted small">Minden napszak a következő kezdetéig tart, az utolsó éjfélen át az elsőig. Mentéskor időrendbe kerülnek.
        Ha egy napszakhoz külön inzulinhatás-időt adsz meg, a napi grafikonon az abban beadott bólusok hatásgörbéje ezzel rajzolódik; „közös” esetén a fenti érték érvényes.</p>
      <p v-else class="muted small">Kikapcsolva ezek az értékek egész nap érvényesek. A többi napszakot megőrzöm, visszakapcsolva újra látszanak.</p>

      <!-- Váltott műszak: külön értékek a délutános hétre (a műszakbeosztás lent, a „Váltott műszak” kártyán). -->
      <div class="therapy-fields">
        <label class="tf-row">
          <span class="tf-label">Külön beállítás a délutános hétre</span>
          <input v-model="altEnabled" type="checkbox" class="switch" role="switch">
        </label>
      </div>
      <template v-if="altEnabled">
        <p v-if="!shiftOn" class="notice small" role="note">Ehhez add meg lent, a „Váltott műszak” kártyán, milyen műszakos ez a hét; addig az alap beállítás érvényes minden nap.</p>
        <h3 class="seg-profile-h">Délutános hét</h3>
        <SegmentsEditor ref="altEd" :segments="altSegments" :by-time-of-day="byTimeOfDay" :action-minutes="actionMinutes" :action-options="actionOptions" :new-key="newKey" />
        <div v-if="byTimeOfDay" class="btn-row">
          <button type="button" class="ghost sm" :disabled="altSegments.length >= 12" @click="altEd?.add()">+ Napszak</button>
        </div>
        <div class="therapy-fields">
          <label class="tf-row">
            <span class="tf-label">Szabadnapon érvényes</span>
            <select v-model="freeProfile">
              <option value="base">a délelőttös hét beállítása</option>
              <option value="alt">a délutános hét beállítása</option>
            </select>
          </label>
        </div>
        <p class="muted small">A délutános héten (a műszakbeosztás szerint) ezek az értékek érvényesek a kalkulátorban, az aktív inzulinban, az előrejelzésben és a javaslatokban. Az elemzés napszakonkénti becslései az alap beállítás napszakai szerint csoportosítanak.</p>
      </template>

      <div class="btn-row">
        <span class="spacer" />
        <NuxtLink to="/" class="btn ghost">Mégse</NuxtLink>
        <button type="submit" :disabled="saving">Mentés</button>
      </div>
    </form>
    <ShiftCard />
    <AnalysisCard @apply="applyEstimates" />
    <FpuCard @apply="applyFpu" />
    <!-- Üres végdátum: a szerver a mai napig számol. -->
    <BasalCheck class="analysis-card" end="" :days="30" selectable />
    <AbsorptionCard />
    <PredictAccuracyCard />
  </main>
</template>
