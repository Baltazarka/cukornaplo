<script setup lang="ts">
// Időszakos nézet: étkezés utáni vércukor napszakonként. Minden étkezés görbéje az étkezés
// pillanatához igazítva, a kezdő értékhez képest; medián és 25–75% sáv, mellette a fő számok.
const props = defineProps<{ end: string; days: number }>()

const { data } = await useFetch<any>('/api/analysis', {
  query: computed(() => ({ end: props.end, days: props.days })),
  key: computed(() => `analysis-${props.end}-${props.days}`),
})
const segs = computed(() => (data.value?.segments ?? []).filter((s: any) => s.meals))

function fmt(v: number | null | undefined, dec = 1, sign = false): string {
  if (v == null) return '–'
  const s = v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  return sign && v > 0 ? `+${s}` : s
}
const preBolus = (v: number | null) => (v == null ? '–' : v < 0 ? `${-v} p-cel előtte` : v > 0 ? `${v} p-cel utána` : 'evéskor')
const minLabel = (v: number) => (v === 0 ? '0' : v < 0 ? `${v} p` : actionLabel(v))

/** y-tengely: a sáv köré kerekítve, legalább −2 … +4 mmol/L. */
function yTicks(c: any): number[] {
  const vals = [...c.p25, ...c.p75].filter((v: number | null) => v != null) as number[]
  const lo = Math.min(-2, Math.floor(Math.min(...vals) / 2) * 2)
  const hi = Math.max(4, Math.ceil(Math.max(...vals) / 2) * 2)
  const step = hi - lo > 12 ? 4 : 2
  const out: number[] = []
  for (let v = lo; v <= hi; v += step) out.push(v)
  if (out.at(-1)! < hi) out.push(out.at(-1)! + step)
  return out
}

const RATINGS = [
  ['ok', 'rendben'],
  ['spike', 'magas csúcs, visszajött'],
  ['high', 'magasan maradt'],
  ['low', 'leesett'],
] as const
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2>Étkezések napszakonként</h2>
      <span class="muted small">a vércukor változása az étkezéstől, a kezdő értékhez képest</span>
    </div>
    <p v-if="!segs.length" class="muted">Ebben az időszakban nincs elemezhető étkezés (beírt CH vagy étkezési bólus, és utána legalább 4 óra szenzoradat).</p>
    <div v-else class="meal-grid">
      <div v-for="s in segs" :key="s.index" class="meal-seg">
        <h3>
          <span>{{ data.therapySet ? `${s.start}–${s.end}` : 'Egész nap' }}</span>
          <span class="muted small">{{ s.meals.n }} étkezés, ebből {{ s.counts.cleanMeals }} tiszta</span>
        </h3>
        <ClientOnly>
          <MiniBandChart
            :x="s.meals.curve.minutes"
            :lines="[{ y: s.meals.curve.p50, color: 'var(--series-glucose)', label: 'medián' }]"
            :bands="[{ lo: s.meals.curve.p25, hi: s.meals.curve.p75, color: 'color-mix(in srgb, var(--series-glucose) 18%, transparent)' }]"
            :x-ticks="[0, 60, 120, 180, 240]" :x-format="minLabel"
            :y-ticks="yTicks(s.meals.curve)" :y-format="(v: number) => fmt(v, Number.isInteger(v) ? 0 : 1, true)"
            :ref-y="[0]" :ref-x="[0]" :height="150"
            :caption="`Medián emelkedés ${fmt(s.meals.rise, 1, true)} mmol/L, ${fmt(s.meals.peakMin, 0)} perc után`"
          >
            <template #legend><span class="k"><span class="sw" style="background: color-mix(in srgb, var(--series-glucose) 18%, transparent)" /> 25–75%</span></template>
          </MiniBandChart>
        </ClientOnly>
        <dl class="meal-stats">
          <div><dt>Emelkedés</dt><dd>{{ fmt(s.meals.rise, 1, true) }}</dd></div>
          <div><dt>Csúcs</dt><dd>{{ fmt(s.meals.peakMin, 0) }} p után</dd></div>
          <div><dt>Előbólus</dt><dd>{{ preBolus(s.meals.preBolus) }}</dd></div>
          <div><dt>2 óra múlva</dt><dd>{{ fmt(s.meals.d2h, 1, true) }}</dd></div>
          <div><dt>4 óra múlva</dt><dd>{{ fmt(s.meals.d4h, 1, true) }}</dd></div>
          <div><dt>Becsült CH-arány</dt><dd>{{ s.estimate.icr ? fmt(s.estimate.icr.value) + ' g/E' : '–' }}</dd></div>
        </dl>
        <div class="meal-ratings" role="img" :aria-label="RATINGS.map(([k, l]) => `${l}: ${s.meals.ratings[k]}`).join(', ')">
          <template v-for="[k] in RATINGS" :key="k">
            <span v-if="s.meals.ratings[k]" :class="'r-' + k" :style="{ flex: s.meals.ratings[k] }" />
          </template>
        </div>
        <div class="meal-rating-legend">
          <span v-for="[k, l] in RATINGS" :key="k"><i :class="'r-' + k" />{{ l }} {{ s.meals.ratings[k] }}</span>
        </div>
      </div>
    </div>
    <p class="muted small">
      Értékelés: <b>rendben</b>, ha a csúcs a céltartomány felső határa alatt maradt, és 4 óra múlva ±2 mmol/L-en belül visszaállt;
      <b>magasan maradt</b>, ha 4 óra múlva 2-vel fölötte volt vagy korrekció kellett; <b>leesett</b>, ha hipó lett vagy 2-vel a kezdő alá ment.
      A becsült CH-arány csak a tiszta étkezésekből (más étel és bólus nélkül) számol, legalább 3 kell hozzá; tájékoztató érték.
    </p>
  </section>
</template>
