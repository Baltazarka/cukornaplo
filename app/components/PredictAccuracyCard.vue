<script setup lang="ts">
// Terápia oldal: az előrejelzés pontossága a saját adataidon visszatesztelve (tárolt, éjszaka újraszámolt eredmény).
// Az elmúlt napokban fél óránként kiszámolja, mit jósolt volna 15 / 30 / 60 percre, és összeveti a ténylegesen mért
// szenzorértékkel. Négy módszer; a 14 napos teszt alapján a program távolságonként és állapotonként (van-e aktív
// inzulin / CH) automatikusan a legjobbat használja.
const DAYS = [7, 14, 30]
const days = ref(14)
const { data, pending, refresh } = await useFetch<any>('/api/predict-accuracy', {
  query: computed(() => ({ days: days.value })),
  key: computed(() => `predict-accuracy-${days.value}`),
  server: false,
  lazy: true,
})

type Mode = 'persist' | 'trend' | 'residual' | 'blend'
const MODES: { id: Mode; label: string }[] = [
  { id: 'persist', label: 'Változatlan' },
  { id: 'trend', label: 'Trend' },
  { id: 'residual', label: 'Modell + lendület' },
  { id: 'blend', label: 'Keverés' },
]
const modeLabel = (m: Mode) => MODES.find((x) => x.id === m)?.label ?? m

const SUBSETS = [
  { id: 'all', label: 'Összes' },
  { id: 'active', label: 'Aktív inzulin/CH' },
  { id: 'calm', label: 'Nyugodt' },
] as const
const subset = ref<'all' | 'active' | 'calm'>('all')

const rows = computed<any[]>(() =>
  (data.value?.horizons ?? []).map((r: any) => {
    const part = subset.value === 'all' ? { n: r.n, mae: r.mae } : r[subset.value]
    return { minutes: r.minutes, n: part.n, mae: part.mae as Record<Mode, number | null> }
  }),
)
const f = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('hu-HU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
/** A legkisebb hibájú módszer a sorban. */
function best(mae: Record<Mode, number | null>): Mode | null {
  const c = MODES.map((m) => m.id).filter((k) => mae[k] != null)
  if (!c.length) return null
  return c.reduce((a, b) => (mae[b]! < mae[a]! ? b : a))
}
const choice = computed(() => data.value?.choice as Record<string, { active: Mode; calm: Mode }> | null)
</script>

<template>
  <section class="card accuracy-card">
    <div class="card-head">
      <h2>Az előrejelzés pontossága</h2>
      <div class="segmented" role="group" aria-label="Időszak">
        <button v-for="d in DAYS" :key="d" type="button" :aria-pressed="days === d" @click="days = d">{{ d }} nap</button>
      </div>
    </div>
    <RecomputeBar v-if="data" :at="data.computedAt" kind="accuracy" :days="days" @done="refresh()" />
    <p class="tp-what">Méri: <b>mennyit tévedett az előrejelzés</b> (mmol/L, kisebb a jobb) · Miből: visszateszt a szenzoradataidon; a legjobbat magától használja</p>
    <details class="more">
      <summary>Hogyan teszteli?</summary>
      <p class="muted small">
      Visszateszt a saját szenzoradataidon: minden időpontban kiszámolja, mit jósolt volna az előrejelzés, és összeveti a ténylegesen
      mért értékkel. Átlagos abszolút hiba mmol/L-ben, <b>kisebb a jobb</b>. A „változatlan” az összehasonlítási alap: az utolsó érték marad;
      a „trend” a csillapított meredekség (a fele, legfeljebb 15 percig). A program a 14 napos teszt alapján <b>magától a legjobbat használja</b>
      (az egyszerűbbet, ha nem rosszabb 3%-nál többel), így a bonyolultabb modell csak akkor számít, ha nálad tényleg pontosabb.
      </p>
      <p class="muted small">
      A hipó-figyelmeztetésnél a program óvatosan a választott módszer, a trend és az inzulin / CH modellje közül a kisebb értéket veszi; a modellt az itt mért átlagos eltérésével korrigálja. A tanult felszívódási görbe
      az egész időszak étkezéseiből készült, ezért a teszt kissé optimista. Az étkezés előtti órákban, új étkezés vagy adag felvétele előtt
      a modell nem ismerheti a jövőt, így azok hibája természetes.
      </p>
    </details>
    <details class="more">
    <summary>Módszerenként (táblázat)</summary>
    <div class="segmented" role="group" aria-label="Mikor">
      <button v-for="s in SUBSETS" :key="s.id" type="button" :aria-pressed="subset === s.id" @click="subset = s.id">{{ s.label }}</button>
    </div>
    <p v-if="pending" class="muted">Számolás…</p>
    <div v-else-if="rows.length" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Távolság</th><th class="num">Minta<small>db</small></th>
            <th v-for="m in MODES" :key="m.id" class="num">{{ m.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.minutes">
            <td>{{ r.minutes }} perc</td>
            <td class="num muted">{{ r.n }}</td>
            <td v-for="m in MODES" :key="m.id" class="num" :class="{ 'acc-best': best(r.mae) === m.id }">{{ f(r.mae[m.id]) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="muted">Nincs elég szenzoradat a teszthez.</p>
    </details>
    <div v-if="choice" class="small">
      <b>Most használt módszer</b> (a 14 napos teszt alapján):
      <ul class="choice-list">
        <li v-for="h in ['15', '30', '60']" :key="h">
          {{ h }} perc: <b>{{ modeLabel(choice[h]?.calm ?? 'trend') }}</b> (nyugodtan), <b>{{ modeLabel(choice[h]?.active ?? 'trend') }}</b> (aktív inzulin / CH mellett)
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.acc-best { font-weight: 700; color: var(--status-good); background: color-mix(in srgb, var(--status-good) 12%, transparent); }
th small { display: block; font-size: 11px; font-weight: 400; }
.choice-list { margin: 4px 0 0; padding-left: 18px; }
</style>
