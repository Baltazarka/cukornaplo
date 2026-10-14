<script setup lang="ts">
// Szenzor- és transzmitterállapot a legutóbbi CareLink-lekérésből: hátralévő szenzoridő, lejárat,
// transzmitter töltöttsége, nem normál szenzorállapot és a Guardian app utolsó riasztása.
import type { DeviceStatus } from '#shared/utils/device'

const props = defineProps<{ device: DeviceStatus }>()

/** A Guardian 4 szenzor élettartama (óra), a csíkhoz. */
const SENSOR_LIFE_H = 7 * 24

// A hátralévő idő percenként halad (a CareLink-adat csak 5 percenként frissül).
const now = ref(Math.floor(Date.now() / 1000))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Math.floor(Date.now() / 1000) }, 60_000) })
onBeforeUnmount(() => clearInterval(timer))
const ago = (ts: number) => {
  const m = Math.max(0, Math.round((now.value - ts) / 60))
  return m < 1 ? 'most' : m < 60 ? `${m} perce` : m < 48 * 60 ? `${Math.round(m / 60)} órája` : `${Math.round(m / 1440)} napja`
}
const dateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('hu-HU', { month: 'short', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' })

const hoursLeft = computed(() => {
  const d = props.device
  if (d.sensorEndsAt == null) return null
  return Math.max(0, (d.sensorEndsAt - now.value) / 3600)
})
const sensorPct = computed(() => (hoursLeft.value == null ? 0 : Math.min(100, (hoursLeft.value / SENSOR_LIFE_H) * 100)))
const sensorEnding = computed(() => hoursLeft.value != null && hoursLeft.value <= SENSOR_ENDING_HOURS)
const battery = computed(() => props.device.transmitterBattery)
const batteryLow = computed(() => battery.value != null && battery.value <= TRANSMITTER_LOW)
const stateText = computed(() => sensorStateText(props.device.sensorState))
// Az utolsó Guardian-riasztás csak egy napig érdekes.
const alarm = computed(() => {
  const a = props.device.lastAlarm
  return a && a.ts && now.value - a.ts < 24 * 3600 ? a : null
})
</script>

<template>
  <section class="card sensor-card" aria-labelledby="sensor-title">
    <div class="card-head">
      <h2 id="sensor-title">Guardian</h2>
      <span class="muted small">CareLink, {{ ago(device.at) }}</span>
    </div>

    <p v-if="stateText" class="alert small">{{ stateText }}</p>
    <p v-if="device.sensorInRange === false" class="alert small">A telefon nem éri el a transzmittert.</p>

    <div v-if="hoursLeft != null" class="sc-row">
      <div class="sc-line">
        <span class="tile-label">Szenzor</span>
        <b :class="{ 'err-text': sensorEnding }">még {{ hoursLeftText(hoursLeft) }}</b>
      </div>
      <div class="sc-bar" :class="{ low: sensorEnding }"><span :style="{ width: `${sensorPct}%` }" /></div>
      <span class="muted small">Lejár: {{ dateTime(device.sensorEndsAt!) }}</span>
    </div>

    <div v-if="battery != null" class="sc-row">
      <div class="sc-line">
        <span class="tile-label">Transzmitter</span>
        <b :class="{ 'err-text': batteryLow }">{{ battery }}%</b>
      </div>
      <div class="sc-bar" :class="{ low: batteryLow }"><span :style="{ width: `${battery}%` }" /></div>
      <span v-if="batteryLow" class="muted small">Töltsd fel a következő szenzorcserénél.</span>
    </div>

    <p v-if="alarm" class="muted small sc-alarm">
      Utolsó Guardian-riasztás: <b>{{ alarmText(alarm.kind) }}</b> ({{ ago(alarm.ts!) }})
    </p>
  </section>
</template>

<style scoped>
.sc-row { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.sc-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.sc-bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
.sc-bar > span { display: block; height: 100%; background: var(--status-good); }
.sc-bar.low > span { background: var(--status-critical); }
.sensor-card p { margin: 8px 0 0; }
.sc-alarm { margin-top: 12px !important; }
</style>
