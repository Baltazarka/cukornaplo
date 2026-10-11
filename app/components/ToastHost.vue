<script setup lang="ts">
// A felugró értesítések megjelenítése (jobb felső sarok, telefonon a képernyő tetején). Magától eltűnik, kattintásra azonnal.
const items = useToasts()
const toast = useToast()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

watch(items, (list) => {
  for (const t of list) {
    const key = t.id
    if (timers.has(key)) continue
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      toast.dismiss(key)
    }, t.ttl))
  }
}, { deep: true, immediate: true })

onBeforeUnmount(() => {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
})

const icon = (k: string) => (k === 'success' ? '✓' : k === 'error' ? '!' : 'i')
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" aria-live="polite">
      <TransitionGroup name="toast">
        <button
          v-for="t in items" :key="t.id" type="button" class="toast" :class="'toast-' + t.kind"
          :role="t.kind === 'error' ? 'alert' : 'status'" @click="toast.dismiss(t.id)"
        >
          <span class="toast-icon" aria-hidden="true">{{ icon(t.kind) }}</span>
          <span class="toast-text">{{ t.text }}</span>
          <span class="toast-x" aria-hidden="true">×</span>
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style>
.toast-host {
  position: fixed; top: 12px; right: 12px; z-index: 1000;
  display: flex; flex-direction: column; gap: 8px; width: min(380px, calc(100vw - 24px)); pointer-events: none;
}
.toast {
  pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; text-align: left; width: 100%;
  padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); border-left: 4px solid var(--accent, #2a78d6);
  background: var(--surface-1); color: var(--text-primary); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
  font: inherit; font-size: 14px; line-height: 1.35; cursor: pointer;
}
.toast-success { border-left-color: var(--status-good); }
.toast-error { border-left-color: var(--status-critical); }
.toast-info { border-left-color: var(--accent, #2a78d6); }
.toast-icon {
  flex: none; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; background: var(--accent, #2a78d6);
}
.toast-success .toast-icon { background: var(--status-good); }
.toast-error .toast-icon { background: var(--status-critical); }
.toast-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.toast-x { flex: none; color: var(--text-muted); font-size: 18px; line-height: 1; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }
@media (max-width: 560px) {
  .toast-host { top: 8px; right: 8px; left: 8px; width: auto; }
}
@media print { .toast-host { display: none; } }
</style>
