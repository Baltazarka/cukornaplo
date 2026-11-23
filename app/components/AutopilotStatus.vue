<script setup lang="ts">
// Kompakt állapotkártya: jelenlegi vércukor, IOB/COB, és a motor "véleménye" emberi nyelven.
const props = defineProps<{ context: any; settings: any; pending: any }>()

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

const opinion = computed<{ text: string; cls: string }>(() => {
  if (!props.settings.enabled) return { text: 'Kikapcsolva', cls: 'none' }
  if (!props.context) return { text: 'Nincs friss szenzoradat', cls: 'none' }
  if (props.pending) return { text: 'Javaslatra vár', cls: 'warn' }
  if (props.context.risk) return { text: 'Hipó-veszély — nem javasol adagot', cls: 'bad' }
  const rate = props.context.now?.rate
  if (rate != null && rate <= -0.03) return { text: 'Esik, visszafogja magát', cls: 'info' }
  if (rate != null && rate >= 0.03 && props.context.eventual > props.context.now?.v) return { text: 'Emelkedik, korrekciót fontolgat', cls: 'warn' }
  return { text: 'Stabil', cls: 'ok' }
})
</script>

<template>
  <section v-if="settings.enabled" class="card now-card">
    <div class="now-main">
      <span class="now-label">Autopilot állapota</span>
      <span v-if="context" class="now-value">{{ fmt(context.now?.v) }} <small>mmol/L</small> {{ context.now?.arrow }}</span>
    </div>
    <div class="now-facts">
      <div v-if="context"><span>Aktív inzulin</span><b class="now-ins">{{ fmt(context.iob) }} E</b></div>
      <div v-if="context"><span>Aktív CH</span><b class="now-carbs">{{ fmt(context.cob, 0) }} g</b></div>
      <div><span>A motor véleménye</span><b class="ap-opinion" :class="'op-' + opinion.cls">{{ opinion.text }}</b></div>
    </div>
  </section>
</template>

<style scoped>
.ap-opinion.op-ok { color: var(--status-good); }
.ap-opinion.op-warn { color: var(--status-warning); }
.ap-opinion.op-bad { color: var(--status-critical); }
.ap-opinion.op-info { color: var(--accent); }
.ap-opinion.op-none { color: var(--text-muted); }
</style>
