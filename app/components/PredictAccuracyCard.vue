<script setup lang="ts">
// Terápia oldal: az előrejelzés pontossága a saját adataidon visszatesztelve. Az elmúlt napokban fél óránként
// kiszámolja, mit jósolt volna 15 / 30 / 60 percre, és összeveti a ténylegesen mért szenzorértékkel.
const DAYS = [7, 14, 30]
const days = ref(14)
const { data, pending } = await useFetch<any>('/api/predict-accuracy', {
  query: computed(() => ({ days: days.value })),
  key: computed(() => `predict-accuracy-${days.value}`),
  server: false,
  lazy: true,
})
const rows = computed<any[]>(() => data.value?.horizons ?? [])
const f = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('hu-HU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
/** A legkisebb hibájú módszer a sorban. */
function best(r: any): 'persistence' | 'residual' | 'blend' | null {
  const c = (['persistence', 'residual', 'blend'] as const).filter((k) => r[k] != null)
  if (!c.length) return null
  return c.reduce((a, b) => (r[b] < r[a] ? b : a))
}
</script>

<template>
  <section class="card accuracy-card">
    <div class="card-head">
      <h2>Az előrejelzés pontossága</h2>
      <div class="segmented" role="group" aria-label="Időszak">
        <button v-for="d in DAYS" :key="d" type="button" :aria-pressed="days === d" @click="days = d">{{ d }} nap</button>
      </div>
    </div>
    <p class="muted small">
      Visszateszt a saját szenzoradataidon: minden időpontban kiszámolja, mit jósolt volna az előrejelzés, és összeveti a ténylegesen
      mért értékkel. Átlagos abszolút hiba mmol/L-ben, <b>kisebb a jobb</b>. A „változatlan” az összehasonlítási alap: az utolsó érték marad.
    </p>
    <p v-if="pending" class="muted">Számolás…</p>
    <div v-else-if="rows.length" class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Távolság</th><th class="num">Minta</th><th class="num">Változatlan</th><th class="num">Modell + lendület</th><th class="num">Keverés (jelenlegi)</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.minutes">
            <td>{{ r.minutes }} perc</td>
            <td class="num">{{ r.n }}</td>
            <td class="num" :class="{ 'acc-best': best(r) === 'persistence' }">{{ f(r.persistence) }}</td>
            <td class="num" :class="{ 'acc-best': best(r) === 'residual' }">{{ f(r.residual) }}</td>
            <td class="num" :class="{ 'acc-best': best(r) === 'blend' }">{{ f(r.blend) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="muted">Nincs elég szenzoradat a teszthez.</p>
    <p class="muted small">
      A tanult felszívódási görbe az egész időszak étkezéseiből készült, ezért a teszt kissé optimista. Az étkezés előtti órákban, új étkezés
      vagy adag felvétele előtt a modell nem ismerheti a jövőt, így azok hibája természetes.
    </p>
  </section>
</template>

<style scoped>
.acc-best { font-weight: 700; color: var(--status-good); }
</style>
