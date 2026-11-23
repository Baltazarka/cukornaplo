<script setup lang="ts">
// Előzmény-napló: minden javaslat és a vele történt döntés, visszamenőleg ellenőrizhető.
const days = ref(7)
const { data, refresh } = await useFetch<any>('/api/autopilot/history', { query: { days }, key: computed(() => `autopilot-history-${days.value}`) })

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const KIND_LABEL: Record<string, string> = { correction: 'korrekció', basal_micro: 'mikro-kiegészítés' }
const STATUS_LABEL: Record<string, string> = { pending: 'Függőben', accepted: 'Beadva', declined: 'Kihagyva', expired: 'Lejárt' }
const open = ref<number | null>(null)

defineExpose({ refresh })
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2>Autopilot napló</h2>
      <div class="segmented ap-hist-period" role="group" aria-label="Időszak">
        <button type="button" :aria-pressed="days === 7" @click="days = 7">7 nap</button>
        <button type="button" :aria-pressed="days === 30" @click="days = 30">30 nap</button>
      </div>
    </div>
    <p v-if="!data?.items?.length" class="muted">Még nincs Autopilot-javaslat ebben az időszakban.</p>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr><th>Időpont</th><th>Javaslat</th><th>Döntés</th><th /></tr></thead>
        <tbody>
          <template v-for="s in data.items" :key="s.id">
            <tr class="ap-hist-row" @click="open = open === s.id ? null : s.id">
              <td>{{ new Date(s.ts * 1000).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }) }}</td>
              <td>{{ fmt(s.amount) }} E {{ KIND_LABEL[s.kind] }}</td>
              <td>
                <span v-if="s.status === 'accepted'">Beadva{{ s.decidedAmount != null && s.decidedAmount !== s.amount ? ` ${fmt(s.decidedAmount)} E (eltérés)` : '' }}</span>
                <span v-else>{{ STATUS_LABEL[s.status] }}</span>
              </td>
              <td class="muted small">{{ open === s.id ? '▲' : '▼' }}</td>
            </tr>
            <tr v-if="open === s.id">
              <td colspan="4" class="muted small">
                Most: {{ fmt(s.snapshot?.now?.v) }} mmol/L · aktív inzulin: {{ fmt(s.snapshot?.iob) }} E · aktív CH: {{ fmt(s.snapshot?.cob, 0) }} g ·
                becsült érték: {{ fmt(s.snapshot?.eventual) }} mmol/L (cél: {{ fmt(s.snapshot?.target) }}, ISF: {{ fmt(s.snapshot?.isf) }}).
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.ap-hist-row { cursor: pointer; }
.ap-hist-period { margin-left: auto; }
</style>
