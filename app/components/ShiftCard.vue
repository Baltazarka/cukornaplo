<script setup lang="ts">
// Váltott műszak: a beosztás (melyik héten délelőttös / délutános, hétvége szabad-e) és a mutatók műszak szerint.
// A beosztás a mostani hét megjelöléséből hetente váltakozik; egyes napok a főoldalon átállíthatók (pl. szabadság).
import type { ShiftSchedule } from '#shared/types/therapy'

const props = defineProps<{ readOnly?: boolean }>()
const emit = defineEmits<{ (e: 'saved'): void }>()
const { data: th, refresh: refreshTherapy } = await useFetch<any>('/api/therapy', { key: 'therapy' })
const days = ref(30)
const { data, refresh } = await useFetch<any>('/api/shifts', { query: { days }, key: 'shifts' })

const schedule = computed<ShiftSchedule | null>(() => th.value?.shift ?? null)
const enabled = ref(!!schedule.value?.enabled)
// Az e heti műszak a beosztás szerint (kézi átállítás nélkül, hétvégén is a hét műszakja).
const today = computed(() => th.value?.today?.date ?? '')
const weekShift = (s: ShiftSchedule | null): 'morning' | 'afternoon' => {
  if (!s?.enabled || !today.value) return 'morning'
  return scheduledShift({ ...s, weekendFree: false }, today.value) === 'afternoon' ? 'afternoon' : 'morning'
}
const thisWeek = ref<'morning' | 'afternoon'>(weekShift(schedule.value))
const weekendFree = ref(schedule.value?.weekendFree ?? true)
const saving = ref(false)
const msg = ref('')
const err = ref('')
useToastFrom(msg, 'success')
useToastFrom(err, 'error')
async function save() {
  saving.value = true
  msg.value = ''
  err.value = ''
  try {
    await $fetch('/api/shift', { method: 'POST', body: { enabled: enabled.value, thisWeek: thisWeek.value, weekendFree: weekendFree.value } })
    await Promise.all([refreshTherapy(), refresh()])
    msg.value = enabled.value ? 'Műszakbeosztás mentve.' : 'Műszakbeosztás kikapcsolva.'
    emit('saved')
  } catch (e: any) {
    err.value = e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    saving.value = false
  }
}
// A mostani hét dátumai (hétfő–vasárnap): vasárnap is a most véget érő hét, nem a következő.
const thisWeekRange = computed(() => {
  if (!today.value) return ''
  const mon = mondayOf(today.value)
  const [y, m, d] = mon.split('-').map(Number)
  const sun = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10)
  return `${mon.slice(5).replace('-', '.')}.–${sun.slice(5).replace('-', '.')}.`
})
// A következő 3 hét előnézete.
const preview = computed(() => {
  if (!enabled.value || !today.value) return []
  const s: ShiftSchedule = { enabled: true, anchor: today.value, anchorShift: thisWeek.value, weekendFree: false, overrides: {} }
  const mon = mondayOf(today.value)
  const add = (ymd: string, n: number) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
  }
  return [0, 7, 14].map((n) => {
    const w = add(mon, n)
    return { from: w.slice(5).replace('-', '.') + '.', to: add(w, weekendFree.value ? 4 : 6).slice(5).replace('-', '.') + '.', shift: scheduledShift(s, w)! }
  })
})

const fmt = (v: number | null | undefined, dec = 0) => (v == null ? '–' : v.toLocaleString('hu-HU', { maximumFractionDigits: dec }))
const shifts = computed<any[]>(() => (data.value?.shifts ?? []).filter((x: any) => x.days > 0))
</script>

<template>
  <section class="card analysis-card shift-card">
    <h2>Váltott műszak</h2>
    <p class="muted small">
      Jelöld meg, milyen ez a hét: onnan a program hetente váltogatja. Egyes napokat (szabadság, csere) a főoldalon, a nap
      fejlécénél állíthatsz át. A délutános hét külön értékei fent, a „Napszakok” résznél adhatók meg.
    </p>
    <form v-if="!props.readOnly" class="shift-form therapy-fields" @submit.prevent="save">
      <label class="tf-row">
        <span class="tf-label">Váltott műszak</span>
        <input v-model="enabled" type="checkbox" class="switch" role="switch">
      </label>
      <template v-if="enabled">
        <label class="tf-row">
          <span class="tf-label">Ez a hét <small class="muted">({{ thisWeekRange }})</small></span>
          <select v-model="thisWeek">
            <option value="morning">délelőttös</option>
            <option value="afternoon">délutános</option>
          </select>
        </label>
        <label class="tf-row">
          <span class="tf-label">Hétvége</span>
          <select v-model="weekendFree">
            <option :value="true">szabadnap</option>
            <option :value="false">a hét műszakja szerint</option>
          </select>
        </label>
        <ul v-if="preview.length" class="shift-preview">
          <li v-for="(p, i) in preview" :key="i">{{ p.from }}–{{ p.to }}: <b>{{ SHIFT_LABEL[p.shift].toLowerCase() }}</b></li>
        </ul>
      </template>
      <div class="btn-row">
        <button type="submit" class="sm" :disabled="saving">Műszakbeosztás mentése</button>
      </div>
    </form>

    <template v-if="data?.enabled && shifts.length">
      <div class="btn-row">
        <h3 class="shift-h">Műszak szerint</h3>
        <span class="spacer" />
        <select v-model.number="days" aria-label="Időszak">
          <option :value="14">14 nap</option>
          <option :value="30">30 nap</option>
          <option :value="60">60 nap</option>
          <option :value="90">90 nap</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="table analysis-table shift-table">
          <thead>
            <tr>
              <th />
              <th v-for="x in shifts" :key="x.kind" class="num">{{ SHIFT_LABEL[x.kind as 'morning'] }}<small>{{ x.days }} nap</small></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Célban ({{ fmt(data.range.low, 1) }}–{{ fmt(data.range.high, 1) }})</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ fmt(x.all?.tir) }}%</td>
            </tr>
            <tr>
              <td>3,9–10 között</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ fmt(x.all?.tir10) }}%</td>
            </tr>
            <tr v-for="(b, i) in data.blocks" :key="b" class="shift-block">
              <td>&nbsp;&nbsp;{{ b }} óra, 3,9–10</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ x.blocks[i] ? fmt(x.blocks[i].tir10) + '%' : '–' }} <small class="muted">{{ x.blocks[i] ? `átl. ${fmt(x.blocks[i].avg, 1)}` : '' }}</small></td>
            </tr>
            <tr>
              <td>Átlag</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ fmt(x.all?.avg, 1) }}</td>
            </tr>
            <tr>
              <td>13,9 fölött / {{ fmt(data.range.low, 1) }} alatt</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ fmt(x.all?.veryHigh, 1) }}% / {{ fmt(x.all?.below, 1) }}%</td>
            </tr>
            <tr>
              <td>Bólus / korrekció naponta</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ fmt(x.perDay.bolus) }} / {{ fmt(x.perDay.correction) }} E</td>
            </tr>
            <tr>
              <td>CH naponta</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ fmt(x.perDay.carbs) }} g</td>
            </tr>
            <tr>
              <td>Bázis beírva</td>
              <td v-for="x in shifts" :key="x.kind" class="num">{{ x.basalLogged }} / {{ x.days }} nap</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small">A nap a naptári nap (éjféltől éjfélig); csak a legalább félig szenzoradatos napok számítanak. A kizárt szenzorszakaszok nélkül.</p>
    </template>
  </section>
</template>
