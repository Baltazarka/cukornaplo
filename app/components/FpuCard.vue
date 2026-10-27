<script setup lang="ts">
// Zsíros ételek (zsír-fehérje): a zsíros jelölésű, zsír / fehérje grammal beírt étkezések kiértékelése az utolsó
// 90 napból, és ebből a saját % becslése a varsói értékhez képest (server/utils/analysis.ts, fpu).
// Az átvétel csak a szerkesztőt tölti ki; menteni a Terápia oldalon kell.
const emit = defineEmits<{ (e: 'apply', pct: number): void }>()
const DAYS = 90
const { data } = await useFetch<any>('/api/analysis', { query: { days: DAYS }, key: 'analysis-fpu' })
const fpu = computed(() => data.value?.fpu ?? null)
const MIN = 3

const fmt = (v: number | null | undefined, dec = 1) =>
  v == null ? '–' : v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const signed = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${fmt(v)}`)
const when = (ts: number) =>
  new Date(ts * 1000).toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const hours = (m: number) => `${Math.round(m / 6) / 10}`.replace('.', ',')

const est = computed(() => fpu.value?.estimate ?? null)
/** A beállításba átvehető érték: 10%-ra kerekítve, 0–100% között. */
const applyPct = computed(() => (est.value ? Math.min(100, Math.max(0, Math.round(est.value.pct / 10) * 10)) : null))
const evaluable = computed(() => (fpu.value?.events ?? []).filter((e: any) => e.pct != null).length)
</script>

<template>
  <section v-if="fpu" class="card analysis-card">
    <h2>Zsíros ételek (zsír-fehérje) <GuideLink section="zsiros" label="Mit jelölj zsírosnak? Példák táblázattal" /></h2>
    <p class="muted small">A „zsíros” jelölésű étkezések zsír- és fehérjegrammal (utolsó {{ DAYS }} nap): mennyit emelt nálad egy zsír-fehérje egység.</p>
    <details class="more">
      <summary>Hogyan számol?</summary>
      <p class="muted small">
      A program megnézi, mennyit emelt a cukor a végpontig (a zsír-fehérje várt hatásidejének végéig, 4–8 óra) a szénhidrát és a
      beadott inzulin hatásán felül, és ebből számolja, hogy nálad egy zsír-fehérje egység a varsói érték (10 g CH) hány
      %-ának felelt meg. A beállított CH-arányra és ISF-re épül, tájékoztató; a beállításról a diabetológussal dönts.
      </p>
    </details>

    <div v-if="est" class="fpu-est">
      <div>
        Nálad egy zsír-fehérje egység kb. <b>{{ fmt(est.pct / 10, 0) }} g CH</b>-nak megfelelően emelt:
        a varsói érték kb. <b>{{ est.pct }}%</b>-a
        <span class="muted">({{ est.n }} étkezésből, {{ est.reliable ? 'megbízható' : 'előzetes' }})</span>.
        <template v-if="fpu.current != null"> Beállítva: {{ fpu.current }}%.</template>
      </div>
      <p v-if="est.pct > 100" class="muted small">Több, mint a varsói érték; a beállítás legfeljebb 100% lehet.</p>
      <p v-else-if="est.pct < 0" class="muted small">A zsíros ételek után nem emelt a cukor a vártnál jobban: plusz adag nem tűnik szükségesnek.</p>
      <div v-if="applyPct != null && applyPct !== fpu.current" class="btn-row">
        <button type="button" class="ghost sm" @click="emit('apply', applyPct)">Beírás a beállításba ({{ applyPct }}%)</button>
        <span class="muted small">Csak kitölti a mezőt, mentés előtt átnézheted.</span>
      </div>
    </div>
    <p v-else class="muted">
      A saját % becsléséhez legalább {{ MIN }} kiértékelhető zsíros étkezés kell (most {{ evaluable }}).
      Jelöld „zsíros”-nak, és add meg a zsír és a fehérje grammját (a bóluskalkulátorban vagy a naplóban, utólag is).
    </p>

    <div v-if="fpu.events.length" class="table-wrap">
      <table class="table analysis-table fpu-table">
        <thead>
          <tr>
            <th>Időpont</th>
            <th class="num">CH</th>
            <th class="num">Zsír / fehérje<small>egység</small></th>
            <th class="num">Plusz adag<small>45 p – 5 ó</small></th>
            <th class="num">Csúcs<small>2 ó után</small></th>
            <th class="num">Végpont<small>eltérés</small></th>
            <th class="num">Saját %</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in fpu.events" :key="e.ts">
            <td class="seg-time">{{ when(e.ts) }}</td>
            <td class="num">{{ fmt(e.carbs, 0) }} g</td>
            <td class="num">{{ fmt(e.fat, 0) }} / {{ fmt(e.protein, 0) }} g<small class="est-q">{{ fmt(e.units) }} egység</small></td>
            <td class="num">{{ e.extraGiven ? fmt(e.extraGiven) + ' E' : '–' }}</td>
            <td class="num">{{ signed(e.peakRise) }}</td>
            <td class="num">{{ signed(e.endDelta) }}<small class="est-q">{{ hours(e.endMin) }} ó</small></td>
            <td class="num">
              <template v-if="e.pct != null"><b>{{ e.pct }}%</b></template>
              <small v-else class="est-q" title="Más étel a végpontig, hipó az ablakban, kevés szenzoradat, vagy gyorsan változó / alacsony kezdő vércukor.">nem kiértékelhető</small>
              <small v-if="e.hypoAfter" class="est-drift">hipó 8 órán belül</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.fpu-est { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
.fpu-table th small { display: block; font-size: 11px; font-weight: 400; }
.fpu-table .est-drift { display: block; font-size: 11px; color: var(--status-serious); }
</style>
