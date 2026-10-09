<script setup lang="ts">
// Főoldali figyelmeztetés: ha a becsült vércukor a céltartomány alá esne (vagy már alatta van).
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
      <b v-if="prediction.currentLow">Alacsony a vércukor: {{ fmt(prediction.now.v) }} mmol/L</b>
      <b v-else>Hipó-veszély: {{ prediction.horizon }} percen belül kb. {{ fmt(prediction.predicted) }} mmol/L várható</b>
      <span>
        Utolsó érték: {{ fmt(prediction.now.v) }} mmol/L {{ prediction.now.arrow }} ({{ prediction.now.time }}) ·
        aktív inzulin {{ fmt(prediction.iob) }} E · fel nem szívódott CH {{ prediction.cob }} g.
        Becslés, nem helyettesíti a szenzor riasztását.
      </span>
    </div>
  </div>
</template>
