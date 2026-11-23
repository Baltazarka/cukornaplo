<script setup lang="ts">
// Napszakos kiemelés: fix napszakok (nem a terápiás napszakok) szerint mutatja a tartományban töltött
// időt és az átlagot, hogy kiderüljön, van-e tartósan rosszabb szakasz (pl. este).
const props = defineProps<{ dayparts: { label: string; n: number; avg: number | null; tir: number | null }[] }>()

/** Csak akkor emelünk ki egy napszakot, ha legalább ennyi százalékponttal rosszabb a legjobbnál, és van elég adat. */
const MIN_DIFF = 10
const MIN_N = 20

function fmt(v: number | null, dec = 1): string {
  return v == null ? '–' : v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

const withTir = computed(() => props.dayparts.filter((d) => d.tir != null && d.n >= MIN_N))
const best = computed(() => Math.max(...withTir.value.map((d) => d.tir!), 0))
const worst = computed(() => withTir.value.reduce<typeof props.dayparts[number] | null>((a, d) => (a == null || d.tir! < a.tir!) ? d : a, null))
const isWorst = (label: string) => worst.value?.label === label && best.value - worst.value!.tir! >= MIN_DIFF
</script>

<template>
  <section v-if="dayparts.some((d) => d.n > 0)" class="card">
    <div class="card-head">
      <h2>Napszakonként</h2>
    </div>
    <p class="muted small">tartományban töltött idő és átlag, fix napszakok szerint (nem a terápiás beállítás)</p>
    <div class="basal-blocks">
      <div v-for="d in dayparts" :key="d.label" class="basal-block" :class="{ 'st-down': isWorst(d.label) }">
        <div class="tile-label">{{ d.label }}</div>
        <div class="tile-value">{{ fmt(d.tir, 0) }}<small>%</small></div>
        <div class="tile-sub">
          <template v-if="d.n">átlag {{ fmt(d.avg) }} mmol/L</template>
          <template v-else>nincs adat</template>
          <template v-if="isWorst(d.label)"> · tartósan rosszabb</template>
        </div>
      </div>
    </div>
  </section>
</template>
