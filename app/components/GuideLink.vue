<script setup lang="ts">
// Kis „?” gomb a kártyák mellett: a számítások magyarázatát a megfelelő szakasznál nyitja meg.
// `text`: felirat a kérdőjel előtt (pl. „Zsíros ételek”), ha önmagában nem egyértelmű, mire vonatkozik.
defineProps<{ section: string; label?: string; text?: string }>()
</script>

<template>
  <button v-if="text" type="button" class="guide-text-link" :title="label ?? text" @click="openGuide(section)">
    {{ text }}<span class="guide-link" aria-hidden="true">?</span>
  </button>
  <button v-else type="button" class="guide-link" :title="label ?? 'Hogyan számol?'" :aria-label="label ?? 'Hogyan számol?'" @click="openGuide(section)">?</button>
</template>
