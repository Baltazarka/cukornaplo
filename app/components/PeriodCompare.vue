<script setup lang="ts">
// Időszakok összevetése: a jelenlegi időszak az azt megelőző, ugyanolyan hosszú időszakkal.
const props = defineProps<{ data: any }>()
const { data: prev } = await useFetch<any>('/api/agp', {
  query: computed(() => ({ end: props.data.prevEnd, days: props.data.days })),
  key: computed(() => `agp-prev-${props.data.prevEnd}-${props.data.days}`),
})

/**
 * Ennél kevesebb lefedettség alatt az előző időszak adata nem megbízható összevetésre.
 * A szerver `coverage` mezője az első mérés óta eltelt időhöz viszonyít (self-korrigál, ha a napló
 * később kezdődött), ezért itt a teljes kért időszakhoz képest, 5 percenkénti méréssel (288/nap) saját
 * magunk számoljuk, hogy a részben lefedett (pl. a napló elejébe lógó) időszak ne tűnjön tévesen teljesnek.
 */
const MIN_COVERAGE = 50

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function diff(cur: number, old: number, dec = 1): string {
  const d = cur - old
  const s = Math.abs(d).toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  return d > 0.05 ? `+${s}` : d < -0.05 ? `-${s}` : '±0'
}
const enough = computed(() => {
  const p = prev.value
  if (!p) return false
  return (100 * p.stats.n) / (p.days * 288) >= MIN_COVERAGE
})
</script>

<template>
  <section v-if="prev" class="card">
    <div class="card-head">
      <h2>Időszakok összevetése</h2>
    </div>
    <p v-if="!enough" class="muted small">Az előző {{ data.days }} napra nincs elég korábbi adat az összevetéshez.</p>
    <template v-else>
      <p class="muted small">{{ prev.label }} → {{ data.label }}</p>
      <dl class="facts">
        <div><dt>Tartományban</dt><dd>{{ fmt(prev.stats.pct.inRange, 0) }}% → {{ fmt(data.stats.pct.inRange, 0) }}% ({{ diff(data.stats.pct.inRange, prev.stats.pct.inRange, 0) }})</dd></div>
        <div><dt>Átlag</dt><dd>{{ fmt(prev.stats.avg) }} → {{ fmt(data.stats.avg) }} mmol/L ({{ diff(data.stats.avg, prev.stats.avg) }})</dd></div>
        <div><dt>GMI</dt><dd>{{ fmt(prev.stats.gmi) }}% → {{ fmt(data.stats.gmi) }}% ({{ diff(data.stats.gmi, prev.stats.gmi) }})</dd></div>
      </dl>
    </template>
  </section>
</template>
