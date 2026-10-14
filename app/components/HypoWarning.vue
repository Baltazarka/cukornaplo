<script setup lang="ts">
// Főoldali figyelmeztetés: hipó-veszély (szénhidrát-javaslattal), vagy magas vércukornál inzulinjavaslat.
const prediction = ref<any>(null)
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  try {
    const r = await $fetch<any>('/api/predict')
    prediction.value = r.prediction
  } catch {
    prediction.value = null
  }
}
onMounted(() => {
  load()
  timer = setInterval(() => { if (!document.hidden) load() }, 60_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const fmt = (v: number) => v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
</script>

<template>
  <div v-if="prediction?.risk" class="cl-alert error" role="alert">
    <div class="cl-alert-text">
      <b v-if="prediction.currentLow">Alacsony a vércukor: {{ sgText(prediction.now.v) }} mmol/L</b>
      <b v-else>Hipó-veszély: {{ prediction.nadirIn || prediction.horizon }} percen belül kb. {{ fmt(prediction.nadir) }} mmol/L várható</b>
      <b v-if="prediction.carbsNeeded">🍬 Kb. {{ prediction.carbsNeeded }} g gyors szénhidrát kellene</b>
      <span>
        Utolsó érték: {{ sgText(prediction.now.v) }} mmol/L {{ prediction.now.arrow }} ({{ prediction.now.time }}) ·
        aktív inzulin {{ fmt(prediction.iob) }} E · fel nem szívódott CH {{ prediction.cob }} g.
        Becslés, nem helyettesíti a szenzor riasztását.
      </span>
    </div>
  </div>
  <div v-else-if="prediction?.insulinNeeded" class="cl-alert warning" role="status">
    <div class="cl-alert-text">
      <b>Magas vércukor: kb. {{ prediction.insulinNeeded.toLocaleString('hu-HU', { maximumFractionDigits: 1 }) }} E inzulin javasolt</b>
      <span>
        Most {{ sgText(prediction.now.v) }} mmol/L {{ prediction.now.arrow }}, az aktív inzulin ({{ fmt(prediction.iob) }} E) után is kb. {{ fmt(prediction.eventual) }} mmol/L marad.
        Számított javaslat a terápiás beállításaid alapján; beadás előtt ellenőrizd.
      </span>
    </div>
  </div>
</template>
