<script setup lang="ts">
// Terápiás beállítások kézi szerkesztése (az InPen „Inzulinbeállítások” képernyője alapján).
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
const byTimeOfDay = ref<boolean>(t?.byTimeOfDay ?? true)
const segments = ref<EditSegment[]>(t ? t.segments.map(toEdit) : [toEdit({ start: '06:00' })])

// 2:00–8:00 negyedórás lépésekben, ahogy az InPen is kínálja.
const actionOptions = Array.from({ length: (480 - 120) / 15 + 1 }, (_, i) => 120 + i * 15)

// Kikapcsolt napszakbeállításnál csak a legkorábban kezdődő napszak érvényes (a többi megmarad).
const visible = computed(() =>
  byTimeOfDay.value ? segments.value : [...segments.value].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start)).slice(0, 1),
)

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

const errors = ref<string[]>([])
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
      <p class="muted small">Az InPen app <b>Beállítások → Inzulinbeállítások</b> képernyőjének értékei. Egyelőre kézzel adod meg, és csak tájékoztató jellegűek: az adagot továbbra is az InPen app számolja.</p>

      <div v-if="applied" class="notice" role="status">{{ applied }}</div>
      <div v-if="errors.length" class="alert" role="alert">
        <b>Nem sikerült menteni:</b>
        <ul class="errors"><li v-for="e in errors" :key="e">{{ e }}</li></ul>
      </div>

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
              <td><input v-model.number="s.isf" type="number" step="0.1" min="0.1" max="20" required aria-label="Inzulinérzékenységi tényező"></td>
              <td><input v-model.number="s.icr" type="number" step="0.1" min="0.5" max="150" required aria-label="Inzulin-szénhidrát arány"></td>
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
    <AbsorptionCard />
  </main>
</template>
