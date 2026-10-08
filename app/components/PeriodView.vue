<script setup lang="ts">
// Időszakos nézet (7 / 14 / 30 nap): összesítő csempék, AGP-grafikon, idő a tartományokban,
// GMI/CV és napi összesítő táblázat. Egy napra kattintva a napi nézetre vált.
const props = defineProps<{ data: any }>()
const emit = defineEmits<{ (e: 'day', date: string): void }>()

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

const bandLabels = computed<[string, string, string][]>(() => {
  const r = props.data.range
  return [
    ['veryHigh', 'Nagyon magas', `> ${fmt(r.veryHigh)}`],
    ['high', 'Magas', `${fmt(r.high)}–${fmt(r.veryHigh)}`],
    ['inRange', 'Céltartomány', `${fmt(r.low)}–${fmt(r.high)}`],
    ['low', 'Alacsony', `${fmt(r.veryLow)}–${fmt(r.low)}`],
    ['veryLow', 'Nagyon alacsony', `< ${fmt(r.veryLow)}`],
  ]
})
const s = computed(() => props.data.stats)
</script>

<template>
  <div class="period-view">
    <section v-if="!s.n && !data.totals.penDays" class="card">
      <p>Erre az időszakra nincs adat.</p>
    </section>

    <StatTiles
      :stats="s" :change="data.change" :range="data.range" :coverage="data.coverage" per-day
      :insulin="{ total: data.totals.insulinPerDay, meal: data.totals.mealPerDay, correction: data.totals.correctionPerDay, basal: data.totals.basalPerDay }" :carbs="data.totals.carbsPerDay"
    />

    <section class="card">
      <div class="card-head">
        <h2>Glükózprofil, {{ data.days }} nap</h2>
        <span class="muted small">Minden nap egy közös 24 órás tengelyen: a medián és a mérések szórása napszakonként.</span>
      </div>
      <ClientOnly>
        <GlucoseAgpChart :data="data" />
        <template #fallback><div class="chart-box" /></template>
      </ClientOnly>
    </section>

    <MealAnalysis :end="data.end" :days="data.days" />

    <div class="grid2">
      <section class="card">
        <h2>Idő a tartományokban</h2>
        <div class="tir">
          <div class="tir-title">{{ data.label }}</div>
          <p v-if="!s.n" class="muted">Nincs glükózadat.</p>
          <div v-else class="tir-row">
            <div class="tir-bar">
              <template v-for="[k] in bandLabels" :key="k">
                <span v-if="s.pct[k] > 0" class="seg" :class="'seg-' + k" :style="{ flexBasis: s.pct[k] + '%' }" />
              </template>
            </div>
            <ul class="tir-legend">
              <li v-for="[k, name, range] in bandLabels" :key="k">
                <span class="key" :class="'seg-' + k" />
                <span>{{ name }} <span class="muted">{{ range }}</span></span>
                <b>{{ fmt(s.pct[k], 0) }}%</b>
              </li>
            </ul>
          </div>
        </div>
        <dl v-if="s.n" class="facts">
          <div><dt>Átlag</dt><dd>{{ fmt(s.avg) }} mmol/L</dd></div>
          <div><dt>GMI (becsült HbA1c)</dt><dd>{{ fmt(s.gmi) }}%</dd></div>
          <div><dt>Variabilitás (CV)</dt><dd>{{ fmt(s.cv, 0) }}%</dd></div>
        </dl>
        <p v-if="s.n && data.days < 14" class="muted small">A GMI csak legalább 14 napnyi, jó lefedettségű szenzoradatból megbízható.</p>
      </section>

      <section class="card">
        <h2>Napok</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Nap</th><th class="num">Átlag</th><th class="num">Célban</th><th class="num">Alacsony</th><th class="num">Inzulin</th><th class="num">CH</th></tr></thead>
            <tbody>
              <tr v-for="row in data.summary" :key="row.date">
                <td><a href="#" @click.prevent="emit('day', row.date)">{{ row.label }} <span class="muted">{{ row.weekday }}</span></a></td>
                <td class="num">{{ fmt(row.avg) }}</td>
                <td class="num">{{ row.inRange != null ? fmt(row.inRange, 0) + '%' : '–' }}</td>
                <td class="num">{{ row.low != null ? fmt(row.low, 0) + '%' : '–' }}</td>
                <td class="num">{{ row.insulin ? fmt(row.insulin) + ' E' : '–' }}</td>
                <td class="num">{{ row.carbs ? fmt(row.carbs, 0) + ' g' : '–' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
