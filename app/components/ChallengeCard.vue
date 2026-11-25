<script setup lang="ts">
// Kihívás a főoldal jobb sávjában: mutatja, fut-e most tiszta mérés (korrekció / étkezés), meddig kell tisztán
// tartani (ne egyél, ne adj inzulint), hogy az elemzés beszámítsa a Terápia oldali becslésbe, és a mostani napszak
// tiszta eseményeinek számát. Tájékoztató: a beszámításról az elemzés dönt. Percenként és a lapra visszatérve frissül.
interface Measure { kind: 'correction' | 'meal'; phase: 'running' | 'done' | 'broken'; start: number; until: number; hours: number; dose?: number; carbs?: number }
type State = Measure | { kind: 'busy'; iob: number; carbsUntil: number | null } | { kind: 'clear' }
interface Seg { start: string; end: string; cleanCorrections: number; cleanMeals: number; good: number }

const { data, refresh } = await useFetch<{ state: State; segment: Seg | null }>('/api/challenge', { key: 'challenge' })
const tick = useEntriesTick()
watch(tick, () => refresh())

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

const hm = (ts: number) => new Date(ts * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
const fmt = (v: number) => v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
const s = computed(() => data.value?.state)
const seg = computed(() => data.value?.segment)
const what = computed(() => (s.value && 'kind' in s.value && s.value.kind === 'meal' ? 'étkezés' : 'korrekció'))

interface View { title: string; text: string; tone: 'run' | 'ok' | 'bad' | 'idle' }
const view = computed<View | null>(() => {
  const x = s.value
  if (!x) return null
  if (x.kind === 'correction' || x.kind === 'meal') {
    const own = x.kind === 'meal' ? 'Étkezés-mérés' : 'Korrekció-mérés'
    const avoid = x.kind === 'meal' ? 'Ne korrigálj, ne egyél' : 'Ne egyél, ne adj inzulint'
    if (x.phase === 'running') return { title: `${own} fut`, text: `${avoid} ${hm(x.until)}-ig (3 óra után megszakítva is számít, rövidítve).`, tone: 'run' }
    if (x.phase === 'done') return { title: `${own}: kész`, text: `A tiszta ablak ${hm(x.start)} és ${hm(x.until)} között megvolt; az elemzés a következő számoláskor beszámítja.`, tone: 'ok' }
    return { title: `${own}: megszakadt`, text: `Közbejött valami ${fmt(x.hours)} óra után, ez a ${what.value} 3 óra előtt nem számít.`, tone: 'bad' }
  }
  if (x.kind === 'busy') {
    const parts = [x.iob > 0.25 ? `aktív inzulin ${fmt(x.iob)} E` : '', x.carbsUntil ? `a CH ${hm(x.carbsUntil)}-ig felszívódik` : ''].filter(Boolean)
    return { title: 'Most nem mér', text: `${parts.join(', ')}: új tiszta mérés ezután indulhat.`, tone: 'idle' }
  }
  return { title: 'Most tiszta kiindulás', text: 'Nincs aktív inzulin és felszívódó CH: ha amúgy is eszel vagy korrigálsz, az beszámíthat a becslésbe.', tone: 'idle' }
})
</script>

<template>
  <section v-if="view" class="card challenge" aria-labelledby="challenge-title">
    <div class="card-head">
      <h2 id="challenge-title">Kihívás</h2>
    </div>
    <p class="ch-title" :data-tone="view.tone">{{ view.title }}</p>
    <p class="muted small">{{ view.text }}</p>
    <p v-if="seg" class="muted small ch-seg">
      {{ seg.start }}–{{ seg.end }}: {{ seg.cleanCorrections }}/{{ seg.good }} tiszta korrekció · {{ seg.cleanMeals }}/{{ seg.good }} tiszta étkezés (14 nap)
    </p>
  </section>
</template>

<style scoped>
.ch-title { margin: 6px 0 2px; font-weight: 600; font-size: 14px; }
.ch-title[data-tone='run'] { color: var(--status-warning); }
.ch-title[data-tone='ok'] { color: var(--status-good); }
.ch-title[data-tone='bad'] { color: var(--status-critical); }
.ch-seg { margin-top: 8px; font-variant-numeric: tabular-nums; }
</style>
