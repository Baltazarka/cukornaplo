<script setup lang="ts">
// Autopilot BE/KI kapcsoló: alapból kikapcsolva, bekapcsoláskor kötelező megerősítés, kikapcsolás mindig azonnali.
const props = defineProps<{ settings: any }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const readOnly = useReadOnly()
const busy = ref(false)
const err = ref('')
useToastFrom(err, 'error')

async function toggle() {
  if (busy.value) return
  const next = !props.settings.enabled
  if (next) {
    const ok = await askConfirm(
      'Bekapcsolod az Autopilotot? Minden javasolt adagot neked kell beadnod a tollal és nyugtáznod az appban — a program soha nem ad be automatikusan semmit.',
      { title: 'Autopilot bekapcsolása', confirmLabel: 'Bekapcsolom' },
    )
    if (!ok) return
  }
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/autopilot/settings', { method: 'POST', body: { ...props.settings, enabled: next } })
    emit('changed')
  } catch (e: any) {
    err.value = e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card ap-kill" :class="{ on: settings.enabled }">
    <div class="ap-kill-row">
      <div>
        <div class="ap-kill-label">Autopilot: <b>{{ settings.enabled ? 'BEKAPCSOLVA' : 'KIKAPCSOLVA' }}</b></div>
        <p class="muted small">
          Bekapcsolva a rendszer percenként ellenőrzi a vércukrot, és push-ban javasol adagot — neked kell beadnod a tollal és nyugtáznod az appban.
        </p>
      </div>
      <label class="switch-wrap" v-if="!readOnly">
        <input :checked="settings.enabled" type="checkbox" class="switch" role="switch" :disabled="busy" @change="toggle">
      </label>
    </div>
  </section>
</template>

<style scoped>
.ap-kill { border: 2px solid var(--border); }
.ap-kill.on { border-color: var(--status-good); background: color-mix(in srgb, var(--status-good) 8%, var(--surface-1)); }
.ap-kill-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ap-kill-label { font-size: 18px; font-weight: 600; }
.ap-kill p { margin: 4px 0 0; }
.switch-wrap { flex-shrink: 0; }
</style>
