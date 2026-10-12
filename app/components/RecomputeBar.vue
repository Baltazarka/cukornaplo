<script setup lang="ts">
// A Terápia oldal nehéz számolásai előre kiszámolva, tárolva vannak (éjszaka frissülnek). Ez a sor mutatja,
// mikor készült az eredmény, és újraszámolást kérhetsz (pl. új adat, jegyzet vagy beállítás után).
const props = defineProps<{ at: number | null | undefined; kind: 'analysis' | 'accuracy'; days: number; end?: string }>()
const emit = defineEmits<{ (e: 'done'): void }>()

const busy = ref(false)
const err = ref<string[]>([])
useToastFrom(err, 'error')

const label = computed(() => {
  if (!props.at) return 'még nincs kiszámolva'
  const d = new Date(props.at * 1000)
  const t = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const yesterday = new Date(today.getTime() - 86400_000)
  if (same(d, today)) return `ma ${t}`
  if (same(d, yesterday)) return `tegnap ${t}`
  return `${d.toLocaleDateString('hu-HU', { month: 'numeric', day: 'numeric' })}. ${t}`
})

async function recompute() {
  busy.value = true
  err.value = []
  try {
    await $fetch('/api/recompute', { method: 'POST', body: { kind: props.kind, days: props.days, end: props.end } })
    emit('done')
  } catch (e: any) {
    err.value = [e?.data?.error ?? 'Az újraszámolás nem sikerült.']
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="recompute-bar muted small">
    <span>Számolva: <b>{{ label }}</b> (éjszaka magától frissül)</span>
    <button type="button" class="ghost sm" :disabled="busy" @click="recompute">{{ busy ? 'Számolás…' : 'Újraszámolás' }}</button>
  </div>
</template>

<style scoped>
.recompute-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 8px; }
</style>
