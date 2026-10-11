<script setup lang="ts">
// A megerősítő ablak (askConfirm): sötétített háttér, kérdés, „Mégse” és megerősítő gomb. Esc = mégse.
const st = useConfirmState()
const cancelBtn = ref<HTMLButtonElement | null>(null)
const okBtn = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

function finish(v: boolean) {
  const r = st.value.resolve
  st.value = { ...st.value, open: false, resolve: null }
  r?.(v)
}

watch(() => st.value.open, async (open) => {
  if (!import.meta.client) return
  if (open) {
    returnFocus = document.activeElement as HTMLElement | null
    await nextTick()
    // Veszélyes műveletnél a „Mégse” kapja a fókuszt, hogy egy véletlen Enter ne töröljön.
    ;(st.value.danger ? cancelBtn.value : okBtn.value)?.focus()
  } else {
    returnFocus?.focus?.()
  }
})

function onKey(e: KeyboardEvent) {
  if (!st.value.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    finish(false)
  } else if (e.key === 'Tab') {
    // A fókusz az ablakon belül marad.
    const f = [cancelBtn.value, okBtn.value].filter(Boolean) as HTMLElement[]
    if (!f.length) return
    const i = f.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div v-if="st.open" class="confirm-backdrop" @click.self="finish(false)">
        <div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirm-text">
          <h2 v-if="st.title" class="confirm-title">{{ st.title }}</h2>
          <p id="confirm-text" class="confirm-text">{{ st.text }}</p>
          <div class="confirm-actions">
            <button ref="cancelBtn" type="button" class="ghost" @click="finish(false)">{{ st.cancelLabel ?? 'Mégse' }}</button>
            <button ref="okBtn" type="button" :class="{ 'confirm-danger': st.danger }" @click="finish(true)">{{ st.confirmLabel ?? 'Igen' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.confirm-backdrop {
  position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: rgba(0, 0, 0, 0.55);
}
.confirm-box {
  width: min(420px, 100%); padding: 18px; border-radius: 12px; background: var(--surface-1); color: var(--text-primary);
  border: 1px solid var(--border); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.confirm-title { font-size: 16px; margin: 0 0 8px; }
.confirm-text { margin: 0 0 16px; white-space: pre-line; line-height: 1.45; overflow-wrap: anywhere; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.confirm-danger { background: var(--status-critical); border-color: var(--status-critical); color: #fff; }
.confirm-enter-active, .confirm-leave-active { transition: opacity 0.15s ease; }
.confirm-enter-from, .confirm-leave-to { opacity: 0; }
@media print { .confirm-backdrop { display: none; } }
</style>
