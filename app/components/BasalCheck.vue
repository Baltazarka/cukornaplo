<script setup lang="ts">
// Bázisellenőrzés: étel és bólus nélküli időszakokban mennyit változik a vércukor óránként.
// Ha a bázisinzulin jól fedi az alapigényt, a sodródás közel nulla; tartós emelkedés vagy esés
// egy napszakban (pl. hajnalban) a bázis vagy a napszak beállításának jele lehet.
// `selectable`: saját időszakválasztó (Terápia oldal); különben a megadott időszak (főoldali időszakos nézet).
const props = defineProps<{ end: string; days: number; selectable?: boolean }>()
// A Terápia oldalon (selectable) a közös időszakválasztó szerint, a főoldalon a megadott időszakra.
const shared = useAnalysisDays().days
const days = computed(() => (props.selectable ? shared.value : props.days))
const { data } = await useFetch<any>('/api/analysis', {
  query: computed(() => ({ end: props.end, days: days.value })),
  key: computed(() => `analysis-${props.end}-${days.value}`),
})
const b = computed(() => data.value?.basal)

/** Ennél kisebb óránkénti változás stabilnak számít (6 óra alatt kb. ±1,7 mmol/L). */
const STABLE = 0.3
/** Legalább ennyi óra adat kell egy órához (a sávhoz), hogy ne legyen halvány. */
const MIN_HOURS = 1
/**
 * A napszak ítéletéhez (stabil / emelkedik / csökken) legalább ennyi óra adat kell, legalább ennyi különböző napról:
 * ugyanaz a küszöb, mint az elemzés bázis-sodródás jelzésénél (server/utils/analysis.ts MIN_DRIFT_HOURS / DAYS).
 */
const BLOCK_MIN_HOURS = 3
const BLOCK_MIN_DAYS = 3

function fmt(v: number | null | undefined, dec = 1, sign = false): string {
  if (v == null) return '–'
  const s = v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  return sign && v > 0 ? `+${s}` : s
}
const state = (slope: number | null, hours: number, minHours = MIN_HOURS) =>
  slope == null || hours < minHours ? 'none' : slope > STABLE ? 'up' : slope < -STABLE ? 'down' : 'ok'
const blockState = (bl: any) => (bl.days < BLOCK_MIN_DAYS ? 'none' : state(bl.slope, bl.hours, BLOCK_MIN_HOURS))
const STATE_LABEL: Record<string, string> = { ok: 'stabil', up: 'emelkedik', down: 'csökken', none: 'kevés adat' }

// Oszlopdiagram: 24 óra, nulla körül fel-le.
const maxAbs = computed(() => Math.max(1, ...(b.value?.hours ?? []).map((h: any) => Math.abs(h.slope ?? 0))))
const H = 120
const barY = (v: number) => (H / 2) * (1 - v / maxAbs.value)
const hover = ref<number | null>(null)
</script>

<template>
  <section v-if="b" class="card basal-check">
    <div class="card-head">
      <h2>Bázisellenőrzés <GuideLink section="bazis" /></h2>
    </div>
    <p v-if="selectable" class="tp-what basal-sub">Becsüli: <b>elég-e a bázis</b> napszakonként · Miből: étel és ható bólus nélküli szakaszok vércukor-változása, {{ days }} nap</p>
    <p v-else class="muted small basal-sub">a vércukor változása étel és bólus nélküli időszakokban</p>

    <div class="basal-blocks">
      <div v-for="bl in b.blocks" :key="bl.label" class="basal-block" :class="'st-' + blockState(bl)">
        <div class="tile-label">{{ bl.label }}</div>
        <div class="tile-value">{{ fmt(bl.hours >= MIN_HOURS ? bl.slope : null, 1, true) }} <small>mmol/L / óra</small></div>
        <div class="tile-sub">
          <i class="st-dot" />{{ STATE_LABEL[blockState(bl)] }} · {{ fmt(bl.hours, 0) }} óra adat, {{ bl.days }} napról
        </div>
      </div>
    </div>

    <div class="basal-bars">
      <div class="ic-readout" aria-live="polite">
        <template v-if="hover != null && b.hours[hover].slope != null">
          <b>{{ String(hover).padStart(2, '0') }}:00–{{ String(hover + 1).padStart(2, '0') }}:00</b>
          · {{ fmt(b.hours[hover].slope, 2, true) }} mmol/L / óra · {{ fmt(b.hours[hover].hours, 1) }} óra adat
        </template>
        <template v-else>Óránként: fölfelé emelkedés, lefelé esés; halvány, ha 1 óránál kevesebb adat van.</template>
      </div>
      <svg :viewBox="`0 0 240 ${H + 16}`" preserveAspectRatio="none" class="basal-svg" role="img" aria-label="Óránkénti vércukor-sodródás étel és bólus nélkül">
        <line x1="0" x2="240" :y1="barY(STABLE)" :y2="barY(STABLE)" class="mc-ref" />
        <line x1="0" x2="240" :y1="barY(-STABLE)" :y2="barY(-STABLE)" class="mc-ref" />
        <line x1="0" x2="240" :y1="H / 2" :y2="H / 2" class="basal-zero" />
        <g v-for="h in b.hours" :key="h.h" @pointerenter="hover = h.h" @pointerleave="hover = null">
          <rect :x="h.h * 10" y="0" width="10" :height="H" fill="transparent" />
          <rect
            v-if="h.slope != null"
            :x="h.h * 10 + 2" :width="6"
            :y="Math.min(barY(h.slope), H / 2)" :height="Math.max(1, Math.abs(barY(h.slope) - H / 2))"
            :class="['basal-bar', 'st-' + state(h.slope, h.hours)]"
          />
        </g>
      </svg>
      <div class="chart-legend ic-legend">
        <span v-for="k in ['ok', 'up', 'down', 'none']" :key="k" class="k"><span class="sw" :class="'basal-sw st-' + k" /> {{ STATE_LABEL[k] }}</span>
        <span class="k"><span class="sw dashed" style="border-top-color: var(--axis)" /> ±{{ fmt(STABLE, 1) }} mmol/L / óra</span>
      </div>
      <div class="basal-axis"><span v-for="h in [0, 4, 8, 12, 16, 20, 24]" :key="h" :style="{ left: `${(h / 24) * 100}%` }">{{ String(h).padStart(2, '0') }}</span></div>
    </div>

    <details class="more">
    <summary>Részletek</summary>
    <p class="muted small">
      Csak azok az időszakok számítanak, amikor legalább 4 órája (zsíros étkezés után 6) nem ettél, nincs ható bólus, és 2 órán belül nem volt hipó.
      Stabilnak a ±{{ fmt(STABLE, 1) }} mmol/L óránkénti változáson belüli érték számít (6 óra alatt kb. ±1,7 mmol/L).
      Egy napszakról legalább {{ BLOCK_MIN_HOURS }} óra adatból, {{ BLOCK_MIN_DAYS }} különböző napról mond ítéletet (kevesebbnél „kevés adat”, a szám tájékoztató).
      Tartós emelkedés vagy esés egy napszakban a bázis vagy a napszak beállításának jele lehet: ezt a diabetológusoddal érdemes átnézni.
    </p>
    </details>
  </section>
</template>
