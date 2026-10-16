<script setup lang="ts">
// Terápiás beállítások kézi szerkesztése (célérték, ISF, CH-arány, hatásidő napszakonként).
import type { Therapy, TherapySegment } from '#shared/types/therapy'

const { data } = await useFetch<{ therapy: Therapy | null }>('/api/therapy', { key: 'therapy' })

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
const actionMinutes = ref<number>(t?.actionMinutes ?? 240)
const fpuPercent = ref<number>(t?.fpuPercent ?? 50)
const fpuTiming = ref<'later' | 'together'>(t?.fpuTiming ?? 'later')
const fpuOptions = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const byTimeOfDay = ref<boolean>(t?.byTimeOfDay ?? true)
const segments = ref<EditSegment[]>(t ? t.segments.map(toEdit) : [toEdit({ start: '06:00' })])

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

function addSegment() {
  const last = [...segments.value].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start)).at(-1)!
  const m = Math.min(23 * 60 + 30, hmToMinutes(last.start) + 180)
  const start = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  segments.value.push(toEdit({ start, target: last.target || undefined, isf: last.isf || undefined, icr: last.icr || undefined }))
}
function removeSegment(key: number) {
  segments.value = segments.value.filter((s) => s.key !== key)
}

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
  applied.value = changed.length ? `Beírtam a becsléseket (${changed.join('; ')}). Nézd át, és ha jó, mentsd.` : ''
  if (changed.length) document.querySelector('.therapy-edit-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// A saját zsír-fehérje % átvétele a szerkesztőbe (menteni külön kell).
function applyFpu(pct: number) {
  fpuPercent.value = pct
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
        maxBolus: maxBolus.value,
        actionMinutes: actionMinutes.value,
        fpuPercent: fpuPercent.value,
        fpuTiming: fpuTiming.value,
        byTimeOfDay: byTimeOfDay.value,
        segments: segments.value.map(({ start, target, isf, icr, actionMinutes }) => ({ start, target, isf, icr, actionMinutes: actionMinutes || null })),
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
        <p class="muted small tf-note">
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

      <div class="table-wrap">
        <table class="table therapy-edit-table">
          <thead>
            <tr>
              <th v-if="byTimeOfDay">Kezdet</th>
              <th>Glükóz célértéke <small>mmol/L</small></th>
              <th>Inzulinérzékenységi tényező <small>mmol/L/E</small></th>
              <th>Inzulin-szénhidrát arány <small>g/E</small></th>
              <th v-if="byTimeOfDay">Inzulinhatás időtartama <small>ebben a napszakban</small></th>
              <th v-if="byTimeOfDay"><span class="sr-only">Törlés</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in visible" :key="s.key">
              <td v-if="byTimeOfDay"><input v-model="s.start" type="time" step="900" required aria-label="Kezdő időpont"></td>
              <td><input v-model.number="s.target" type="number" step="0.1" min="3.9" max="13.9" required aria-label="Glükóz célértéke"></td>
              <td><input v-model.number="s.isf" type="number" step="0.05" min="0.1" max="20" required aria-label="Inzulinérzékenységi tényező"></td>
              <td><input v-model.number="s.icr" type="number" step="0.05" min="0.5" max="150" required aria-label="Inzulin-szénhidrát arány"></td>
              <td v-if="byTimeOfDay">
                <select v-model.number="s.actionMinutes" aria-label="Inzulinhatás időtartama ebben a napszakban">
                  <option value="">közös ({{ actionLabel(actionMinutes) }})</option>
                  <option v-for="m in actionOptions" :key="m" :value="m">{{ actionLabel(m) }}</option>
                </select>
              </td>
              <td v-if="byTimeOfDay" class="act">
                <button type="button" class="row-del" :disabled="segments.length < 2" :aria-label="`${s.start} napszak törlése`" title="Törlés" @click="removeSegment(s.key)">×</button>
              </td>
            </tr>
          </tbody>
        </table>
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

      <div class="btn-row">
        <button v-if="byTimeOfDay" type="button" class="ghost" :disabled="segments.length >= 12" @click="addSegment">+ Napszak</button>
        <span class="spacer" />
        <NuxtLink to="/" class="btn ghost">Mégse</NuxtLink>
        <button type="submit" :disabled="saving">Mentés</button>
      </div>
    </form>
    <AnalysisCard @apply="applyEstimates" />
    <FpuCard @apply="applyFpu" />
    <!-- Üres végdátum: a szerver a mai napig számol. -->
    <BasalCheck class="analysis-card" end="" :days="30" selectable />
    <AbsorptionCard />
    <PredictAccuracyCard />
  </main>
</template>
