<script setup lang="ts">
// Értesítésnapló a főoldal jobb sávjában: a legutóbbi kiküldött push értesítések röviden; rákattintva nagyban,
// a teljes szöveggel (ha egy értesítés elsikkadt, itt visszanézhető). Percenként és a lapra visszatérve frissül.
interface Item { id: number; ts: number; tag: string; title: string; body: string; sent: number; failed: number }
const SHORT = 4
const { data, refresh } = await useFetch<{ items: Item[] }>('/api/push/log', { query: { limit: 100 }, key: 'push-log' })
const items = computed(() => data.value?.items ?? [])

let timer: ReturnType<typeof setInterval> | undefined
const onVisible = () => { if (!document.hidden) refresh() }
onMounted(() => {
  timer = setInterval(() => { if (!document.hidden) refresh() }, 60_000)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})

const dlg = ref<HTMLDialogElement | null>(null)
function openAll() {
  dlg.value?.showModal()
}
function closeAll() {
  dlg.value?.close()
}
// A párbeszédablakon kívülre kattintva bezárul.
function onDialogClick(ev: MouseEvent) {
  if (ev.target === dlg.value) closeAll()
}

const ymd = (d: Date) => d.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' })
function when(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const hm = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  if (ymd(d) === ymd(now)) return hm
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (ymd(d) === ymd(y)) return `tegnap ${hm}`
  return `${d.toLocaleDateString('hu-HU', { month: '2-digit', day: '2-digit' })} ${hm}`
}
const isTest = (i: Item) => i.tag.startsWith('test-')
</script>

<template>
  <section class="card notify-log" aria-labelledby="notify-log-title">
    <div class="card-head">
      <h2 id="notify-log-title">Értesítések</h2>
      <button v-if="items.length" type="button" class="link-btn" @click="openAll">Összes</button>
    </div>
    <p v-if="!items.length" class="muted small">Még nem ment ki értesítés. Itt visszanézheted, ha egy elsikkadt.</p>
    <button v-else type="button" class="nl-list" title="Megnyitás nagyban" @click="openAll">
      <span v-for="i in items.slice(0, SHORT)" :key="i.id" class="nl-item">
        <span class="nl-time">{{ when(i.ts) }}</span>
        <span class="nl-title">{{ i.title }}</span>
      </span>
    </button>

    <dialog ref="dlg" class="nl-dialog" aria-labelledby="nl-dlg-title" @click="onDialogClick">
      <div class="nl-dlg-inner">
        <div class="card-head">
          <h2 id="nl-dlg-title">Értesítések</h2>
          <button type="button" class="ghost sm" @click="closeAll">Bezárás</button>
        </div>
        <p class="muted small">Az utolsó {{ items.length }} kiküldött értesítés (60 napig őrizzük).</p>
        <ul class="nl-full">
          <li v-for="i in items" :key="i.id">
            <div class="nl-full-head">
              <b>{{ i.title }}</b>
              <span class="muted small">{{ new Date(i.ts * 1000).toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
            </div>
            <p>{{ i.body }}</p>
            <p v-if="isTest(i) || !i.sent" class="muted small">
              <template v-if="isTest(i)">Teszt. </template>
              <template v-if="!i.sent">Nem érkezett meg egy eszközre sem{{ i.failed ? ` (${i.failed} hiba)` : '' }}.</template>
            </p>
          </li>
        </ul>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.nl-list { display: flex; flex-direction: column; gap: 6px; width: 100%; margin-top: 6px; padding: 0; border: 0; background: none; text-align: left; color: inherit; font: inherit; cursor: pointer; }
.nl-item { display: flex; gap: 8px; font-size: 13px; line-height: 1.35; }
.nl-time { flex: none; min-width: 74px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.nl-title { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.nl-dialog { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 64px); padding: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-1); color: var(--text-primary); }
.nl-dialog::backdrop { background: rgb(0 0 0 / 45%); }
.nl-dlg-inner { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.nl-full { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nl-full li { padding: 10px 0; border-top: 1px solid var(--border); }
.nl-full li p { margin: 4px 0 0; }
.nl-full-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
</style>
