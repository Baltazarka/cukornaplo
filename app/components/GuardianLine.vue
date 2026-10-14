<script setup lang="ts">
// Beírás után a CH és az inzulin egy sorban, hogy a Guardian appba is felvihesd, mellette a Guardian app nyitógombja.
// A Guardian appnak nincs URL-sémája, ezért egy „Guardian” nevű iOS Parancs nyitja meg (Telefon oldal).
const props = defineProps<{ carbs?: number | null; dose?: number | null; time?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const GUARDIAN_SHORTCUT = 'Guardian'
const guardianUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(GUARDIAN_SHORTCUT)}`

const fmt = (v: number, dec: number) => v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const parts = computed(() => [
  props.time,
  props.carbs ? `${fmt(props.carbs, 0)} g CH` : null,
  props.dose ? `${fmt(props.dose, 1)} E` : null,
].filter(Boolean))
</script>

<template>
  <div class="bc-guardian">
    <span>Guardianbe: <b>{{ parts.join(' · ') }}</b></span>
    <a class="btn sm" :href="guardianUrl" title="A Telefon oldalon leírt „Guardian” Parancsot futtatja">Guardian megnyitása</a>
    <button type="button" class="link-btn" aria-label="Bezárás" @click="emit('close')">✕</button>
  </div>
</template>
