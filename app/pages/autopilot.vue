<script setup lang="ts">
// Autopilot: "mintha lenne pumpa" adagjavaslat, teljesen elkülönítve a többi oldaltól. A háttérben percenként
// újraértékel (server/plugins/notifier.ts → checkAutopilot); minden javaslatot itt kell nyugtázni.
const { data, refresh } = await useFetch<any>('/api/autopilot/status', { key: 'autopilot-status' })

// Friss állapot a függő javaslathoz / visszaszámlálóhoz, amíg az oldal nyitva van.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => refresh(), 30_000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <main class="autopilot-page">
    <h1 class="tp-title">Autopilot</h1>
    <template v-if="data">
      <AutopilotKillSwitch :settings="data.settings" @changed="refresh" />
      <AutopilotPendingCard :pending="data.pending" :last-decision="data.lastDecision" :context="data.context" @changed="refresh" />
      <AutopilotStatus :context="data.context" :settings="data.settings" :pending="data.pending" />
      <AutopilotHistory />
      <AutopilotSettings :settings="data.settings" @changed="refresh" />
    </template>
  </main>
</template>

<style scoped>
.autopilot-page { max-width: 720px; }
</style>
