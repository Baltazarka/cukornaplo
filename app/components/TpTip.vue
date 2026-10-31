<script setup lang="ts">
// Terápia oldal: tipp a kártya mellett (mit tegyen a felhasználó, hogy a számolások meglegyenek).
// Széles képernyőn mindig nyitva a kártya mellett, keskenyebben lenyitható sor a kártya alatt.
const wide = ref(false)
let mq: MediaQueryList | null = null
const onChange = (e: MediaQueryListEvent) => (wide.value = e.matches)
onMounted(() => {
  mq = matchMedia('(min-width: 1200px)')
  wide.value = mq.matches
  mq.addEventListener('change', onChange)
})
onBeforeUnmount(() => mq?.removeEventListener('change', onChange))
</script>

<template>
  <details class="tp-tip" :open="wide">
    <summary>💡 Tipp</summary>
    <slot />
  </details>
</template>
