<script setup lang="ts">
// Trendnyilak a Guardian szenzor mintájára: 1–3 nyíl felfelé vagy lefelé; stabilnál vízszintes nyíl.
const props = defineProps<{ dir: -1 | 0 | 1; level: 0 | 1 | 2 | 3 }>()
const label = computed(() => {
  if (props.dir === 0 || props.level === 0) return 'stabil'
  const speed = ['', 'lassan', 'közepesen', 'gyorsan'][props.level]
  return `${speed} ${props.dir > 0 ? 'emelkedik' : 'csökken'}`
})
</script>

<template>
  <span class="trend" :class="{ stable: dir === 0 || level === 0 }" role="img" :aria-label="label" :title="label">
    <svg v-if="dir === 0 || level === 0" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <svg
      v-for="i in level" v-else :key="i" viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"
      :style="dir < 0 ? 'transform: rotate(180deg)' : undefined"
    >
      <path d="M5 14V3M1.5 6.5 5 3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
</template>
