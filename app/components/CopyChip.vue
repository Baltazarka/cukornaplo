<script setup lang="ts">
const props = defineProps<{ value: string }>()
const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = props.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <span class="chip"><code>{{ value }}</code><button type="button" class="ghost sm" @click="copy">{{ copied ? 'Másolva ✓' : 'Másolás' }}</button></span>
</template>

<style scoped>
.chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; vertical-align: middle; }
.chip code {
  background: var(--page); border: 1px solid var(--border); border-radius: 6px;
  padding: 3px 8px; overflow-x: auto; white-space: nowrap; min-width: 0;
}
</style>
