<script setup lang="ts">
// A legfontosabb elem az Autopilot oldalon: ha van függő javaslat, nyugtázásra vár ("Beadtam" / "Kihagyom").
const props = defineProps<{ pending: any; lastDecision: any; context: any }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const readOnly = useReadOnly()

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const KIND_LABEL: Record<string, string> = { correction: 'korrekció', basal_micro: 'mikro-kiegészítés' }
const STATUS_LABEL: Record<string, string> = { accepted: 'Beadva', declined: 'Kihagyva', expired: 'Lejárt' }

// Élő visszaszámláló a lejáratig.
const nowTick = ref(Math.floor(Date.now() / 1000))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { nowTick.value = Math.floor(Date.now() / 1000) }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const secsLeft = computed(() => props.pending ? Math.max(0, props.pending.expiresAt - nowTick.value) : 0)
const countdown = computed(() => {
  const s = secsLeft.value
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

const customOpen = ref(false)
const customAmount = ref<number | null>(null)
const busy = ref(false)
const err = ref('')
useToastFrom(err, 'error')

/** Ennél nagyobb nyugtázott mennyiségnél második megerősítés kell (gyorsan beírt, szokatlanul nagy adag ellen). */
const CONFIRM_ABOVE = 3

async function respond(action: 'accept' | 'decline', amount?: number) {
  if (busy.value) return
  if (action === 'accept') {
    const amt = amount ?? props.pending.amount
    if (amt > CONFIRM_ABOVE) {
      const ok = await askConfirm(`Biztosan beadtál ${fmt(amt)} E-t? Ez a szokásosnál nagyobb adag.`, { confirmLabel: 'Igen, beadtam' })
      if (!ok) return
    }
  }
  busy.value = true
  err.value = ''
  try {
    const r = await $fetch<any>('/api/autopilot/respond', { method: 'POST', body: { id: props.pending.id, action, amount } })
    if (!r.ok) throw new Error(r.error)
    customOpen.value = false
    customAmount.value = null
    emit('changed')
  } catch (e: any) {
    err.value = e?.data?.error ?? e?.message ?? 'Nem sikerült.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card ap-pending" :class="pending ? 'ap-' + pending.kind : ''">
    <template v-if="pending">
      <div class="ap-pending-head">
        <h2>{{ pending.kind === 'correction' ? '💉' : '💧' }} Javaslat: {{ fmt(pending.amount) }} E {{ KIND_LABEL[pending.kind] }}</h2>
        <span class="ap-countdown" :class="{ soon: secsLeft < 120 }">{{ countdown }} múlva lejár</span>
      </div>
      <dl class="facts ap-context">
        <div><dt>Most</dt><dd>{{ fmt(context?.now?.v) }} mmol/L {{ context?.now?.arrow }}</dd></div>
        <div><dt>Aktív inzulin</dt><dd>{{ fmt(context?.iob) }} E</dd></div>
        <div><dt>Aktív CH</dt><dd>{{ fmt(context?.cob, 0) }} g</dd></div>
      </dl>
      <p class="muted small">
        A becsült vércukor az aktív inzulin/szénhidrát hatása után kb. {{ fmt(context?.eventual) }} mmol/L.
        <template v-if="lastDecision">Előző javaslat: {{ new Date(lastDecision.ts * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) }} · {{ fmt(lastDecision.decidedAmount ?? lastDecision.amount) }} E · {{ STATUS_LABEL[lastDecision.status] }}.</template>
      </p>
      <template v-if="!readOnly">
        <div class="btn-row">
          <button type="button" :disabled="busy" @click="respond('accept')">✔ Beadtam {{ fmt(pending.amount) }} E</button>
          <button type="button" class="ghost" :disabled="busy" @click="respond('decline')">✖ Kihagyom</button>
        </div>
        <button v-if="!customOpen" type="button" class="link-btn" @click="customOpen = true">Más mennyiséget adtam be</button>
        <div v-else class="ap-custom">
          <input v-model.number="customAmount" type="number" step="0.5" min="0.1" max="100" placeholder="E">
          <button type="button" :disabled="busy || !customAmount" @click="respond('accept', customAmount!)">Beadtam</button>
          <button type="button" class="ghost" @click="customOpen = false">Mégse</button>
        </div>
      </template>
    </template>
    <p v-else class="muted">
      Nincs függő javaslat.
      <template v-if="lastDecision">Legutóbb: {{ new Date(lastDecision.ts * 1000).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }) }} · {{ fmt(lastDecision.decidedAmount ?? lastDecision.amount) }} E {{ KIND_LABEL[lastDecision.kind] }} · {{ STATUS_LABEL[lastDecision.status] }}.</template>
    </p>
  </section>
</template>

<style scoped>
.ap-pending.ap-correction { border-color: var(--status-warning); }
.ap-pending.ap-basal_micro { border-color: var(--accent); }
.ap-pending-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ap-pending-head h2 { margin: 0; }
.ap-countdown { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-secondary); }
.ap-countdown.soon { color: var(--status-critical); }
.ap-context { margin: 10px 0; }
.link-btn { background: none; border: none; color: var(--accent); text-decoration: underline; padding: 0; cursor: pointer; font-size: 13px; }
.ap-custom { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.ap-custom input { width: 90px; }
</style>
