<script setup lang="ts">
// Főoldali kártya: a terápiás beállítások (célérték, ISF, CH-arány napszakonként), a most érvényes napszak kiemelve.
import type { Therapy } from '#shared/types/therapy'

const { data } = await useFetch<{ therapy: Therapy | null; today?: { shift: 'morning' | 'afternoon' | 'free' | null; profile: 'base' | 'alt' } }>('/api/therapy', { key: 'therapy' })
const t = computed(() => data.value?.therapy ?? null)
const readOnly = useReadOnly()

// A most érvényes napszak percenként frissül.
// Az app időzónája szerint (a böngésző órája más időzónában lehet).
const { nowMinute } = useAppTime()
const minute = ref(nowMinute())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => (minute.value = nowMinute()), 60_000) })
onBeforeUnmount(() => clearInterval(timer))

const bolus = computed(() => insulinById(t.value?.bolusInsulin))
const basal = computed(() => insulinById(t.value?.basalInsulin))
// Váltott műszaknál a mai profil (délutános héten a külön beállítás).
const todayShift = computed(() => data.value?.today?.shift ?? null)
const alt = computed(() => data.value?.today?.profile === 'alt' && !!t.value?.altSegments?.length)
const segs = computed(() => (t.value ? (alt.value ? t.value.altSegments! : t.value.segments) : []))
const rows = computed(() => (t.value ? (t.value.byTimeOfDay ? segs.value : segs.value.slice(0, 1)) : []))
const active = computed(() => (t.value ? activeSegment(t.value, minute.value, segs.value) : -1))
// A kártya görbéje a most érvényes napszak hatásidejével (ha annak van saját értéke).
const activeAction = computed(() => (t.value ? rows.value[active.value]?.actionMinutes ?? t.value.actionMinutes : 0))

function fmt(v: number, dec = 1): string {
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const updated = computed(() =>
  t.value ? new Date(t.value.updatedAt * 1000).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }) : '',
)
</script>

<template>
  <section class="card therapy-card" aria-labelledby="therapy-title">
    <div class="card-head">
      <h2 id="therapy-title">Terápiás beállítások <GuideLink section="hatas" /></h2>
      <span v-if="todayShift" class="note-chip shift-chip" :title="alt ? 'Ma a délutános hétre beállított értékek érvényesek' : t?.altEnabled ? 'Ma az alap (délelőttös hét) beállítás érvényes' : 'Műszak a beosztás szerint'">{{ SHIFT_LABEL[todayShift] }}{{ todayShift !== 'free' ? ' hét' : '' }}</span>
      <NuxtLink v-if="t && !readOnly" to="/terapia" class="btn ghost sm">Szerkesztés</NuxtLink>
    </div>

    <template v-if="t">
      <dl class="therapy-kv">
        <div><dt>Étkezésalapú terápia</dt><dd>Szénhidrátszámolás</dd></div>
        <div><dt>Max. dózis</dt><dd>{{ fmt(t.maxBolus, t.maxBolus % 1 ? 1 : 0) }} E</dd></div>
        <div><dt>Inzulinhatás időtartama</dt><dd>{{ actionLabel(t.actionMinutes) }}</dd></div>
        <div v-if="bolus"><dt>Bólusinzulin</dt><dd>{{ bolus.name }}</dd></div>
        <div v-if="basal"><dt>Bázisinzulin</dt><dd>{{ basal.name }}</dd></div>
      </dl>

      <table class="table therapy-table">
        <thead>
          <tr>
            <th>Napszak</th>
            <th class="num" title="Glükóz célértéke">Cél<small>mmol/L</small></th>
            <th class="num" title="Inzulinérzékenységi tényező">Érzék.<small>mmol/L/E</small></th>
            <th class="num" title="Inzulin-szénhidrát arány">CH-arány<small>g/E</small></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in rows" :key="s.start" :class="{ active: i === active }" :aria-current="i === active ? 'time' : undefined">
            <td class="seg-time">
              <template v-if="t.byTimeOfDay">
                {{ s.start }}<span class="muted">–{{ segmentEnd(rows, i) }}</span>
                <small v-if="s.actionMinutes" class="seg-action" title="Inzulinhatás időtartama ebben a napszakban">hatás {{ actionLabel(s.actionMinutes) }}</small>
              </template>
              <template v-else>Egész nap</template>
            </td>
            <td class="num">{{ fmt(s.target) }}</td>
            <td class="num">{{ fmt(s.isf) }}</td>
            <td class="num">{{ fmt(s.icr) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="bolus?.peakMinutes" class="therapy-curve">
        <h3>
          {{ bolus.name }} hatásgörbe
          <span v-if="t.byTimeOfDay" class="muted small">most ({{ rows[active].start }}–{{ segmentEnd(rows, active) }})</span>
        </h3>
        <ClientOnly><InsulinCurve :peak-minutes="bolus.peakMinutes" :duration-minutes="activeAction" /></ClientOnly>
      </div>
      <p v-if="basal?.facts" class="muted small therapy-basal">
        <b>{{ basal.name }}:</b> {{ [basal.facts.peak, basal.facts.duration, basal.facts.note].filter(Boolean).join(', ') }}.
      </p>
      <p class="muted small therapy-foot">
        <span class="now-key" aria-hidden="true" /> most érvényes · kézzel beállítva, {{ updated }}
      </p>
    </template>

    <template v-else>
      <p class="muted small">Még nincs megadva. Add meg a diabetológussal egyeztetett értékeket: célérték, érzékenységi tényező és CH-arány napszakonként.</p>
      <NuxtLink v-if="!readOnly" to="/terapia" class="btn">Beállítás</NuxtLink>
    </template>
  </section>
</template>
