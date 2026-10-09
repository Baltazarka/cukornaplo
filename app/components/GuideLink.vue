<script setup lang="ts">
// Kis „?” gomb a kártyák mellett: a számítások magyarázatát a megfelelő szakasznál nyitja meg.
defineProps<{ section: string; label?: string }>()
</script>

<template>
  <button type="button" class="guide-link" :title="label ?? 'Hogyan számol?'" :aria-label="label ?? 'Hogyan számol?'" @click="openGuide(section)">?</button>
</template>
