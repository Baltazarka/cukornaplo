<script setup lang="ts">
// Napszakok szerkesztője (kezdet, cél, ISF, CH-arány, hatásidő): a Terápia oldalon az alap és a délutános hét
// beállításához. A kapott tömböt helyben módosítja (sorok hozzáadása / törlése is).
export type EditSegment = { start: string; target: number | ''; isf: number | ''; icr: number | ''; actionMinutes: number | ''; key: number }

const props = defineProps<{ segments: EditSegment[]; byTimeOfDay: boolean; actionMinutes: number; actionOptions: number[]; newKey: () => number }>()

// Kikapcsolt napszakbeállításnál csak a legkorábban kezdődő napszak érvényes (a többi megmarad).
const visible = computed(() =>
  props.byTimeOfDay ? props.segments : [...props.segments].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start)).slice(0, 1),
)
function add() {
  const last = [...props.segments].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start)).at(-1)!
  const m = Math.min(23 * 60 + 30, hmToMinutes(last.start) + 180)
  const start = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  props.segments.push({ start, target: last.target, isf: last.isf, icr: last.icr, actionMinutes: '', key: props.newKey() })
}
function remove(key: number) {
  const i = props.segments.findIndex((s) => s.key === key)
  if (i >= 0) props.segments.splice(i, 1)
}
defineExpose({ add })
</script>

<template>
  <div class="table-wrap">
    <table class="table therapy-edit-table">
      <thead>
        <tr>
          <th v-if="byTimeOfDay">Kezdet</th>
          <th>Glükóz célértéke <small>mmol/L</small></th>
          <th>Inzulinérzékenységi tényező <small>mmol/L/E</small></th>
          <th>Inzulin-szénhidrát arány <small>g/E</small></th>
          <th v-if="byTimeOfDay">Inzulinhatás időtartama <small>ebben a napszakban</small></th>
          <th v-if="byTimeOfDay"><span class="sr-only">Törlés</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in visible" :key="s.key">
          <td v-if="byTimeOfDay"><input v-model="s.start" type="time" step="900" required aria-label="Kezdő időpont"></td>
          <td><input v-model.number="s.target" type="number" step="0.1" min="3.9" max="13.9" required aria-label="Glükóz célértéke"></td>
          <td><input v-model.number="s.isf" type="number" step="0.05" min="0.1" max="20" required aria-label="Inzulinérzékenységi tényező"></td>
          <td><input v-model.number="s.icr" type="number" step="0.05" min="0.5" max="150" required aria-label="Inzulin-szénhidrát arány"></td>
          <td v-if="byTimeOfDay">
            <select v-model.number="s.actionMinutes" aria-label="Inzulinhatás időtartama ebben a napszakban">
              <option value="">közös ({{ actionLabel(actionMinutes) }})</option>
              <option v-for="m in actionOptions" :key="m" :value="m">{{ actionLabel(m) }}</option>
            </select>
          </td>
          <td v-if="byTimeOfDay" class="act">
            <button type="button" class="row-del" :disabled="segments.length < 2" :aria-label="`${s.start} napszak törlése`" title="Törlés" @click="remove(s.key)">×</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
