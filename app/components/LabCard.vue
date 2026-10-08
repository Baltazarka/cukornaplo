<script setup lang="ts">
// Labor HbA1c: a beírt eredmények, mindegyik mellett a GMI a labor előtti 90 nap szenzoradataiból.
// Ha a kettő tartósan eltér, az egyéni (pl. vörösvérsejt-élettartam miatti) különbség lehet.
const { data, refresh } = await useFetch<any>('/api/lab', { key: 'lab' })
const readOnly = useReadOnly()

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return '–'
  return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
/** % (NGSP) → mmol/mol (IFCC). */
const ifcc = (pct: number) => Math.round((pct - 2.15) * 10.929)
const dateLabel = (ymd: string) => ymd.replaceAll('-', '. ') + '.'

const open = ref(false)
const form = reactive({ date: new Date().toLocaleDateString('sv-SE'), hba1c: '' })
const err = ref('')
const busy = ref(false)
async function add() {
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/lab', { method: 'POST', body: { ...form } })
    form.hba1c = ''
    open.value = false
    await refresh()
  } catch (e: any) {
    err.value = e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    busy.value = false
  }
}
async function remove(r: any) {
  if (!confirm(`Törlöd a ${dateLabel(r.date)} HbA1c-eredményt (${fmt(r.hba1c)}%)?`)) return
  await $fetch('/api/lab-delete', { method: 'POST', body: { id: r.id } })
  await refresh()
}
</script>

<template>
  <section class="card lab-card">
    <div class="card-head">
      <h2>Labor HbA1c</h2>
      <button v-if="!readOnly && !open" type="button" class="ghost sm" @click="open = true">+ Eredmény</button>
    </div>

    <form v-if="open" class="lab-form" @submit.prevent="add">
      <label>Dátum <input v-model="form.date" type="date" required></label>
      <label>HbA1c <input v-model="form.hba1c" type="text" inputmode="decimal" required placeholder="pl. 6,8 vagy 51"></label>
      <div class="btn-row">
        <button type="submit" :disabled="busy">Mentés</button>
        <button type="button" class="ghost" @click="open = false">Mégse</button>
      </div>
      <p class="muted small">%-ban vagy mmol/mol-ban (20 fölötti értéket mmol/mol-nak veszünk és átváltjuk).</p>
      <p v-if="err" class="alert">{{ err }}</p>
    </form>

    <p v-if="!data?.results.length" class="muted">
      Még nincs beírt laboreredmény. Ha beírod, mellé kerül a GMI a labor előtti {{ data?.windowDays ?? 90 }} nap szenzoradataiból,
      így látod, mennyire egyezik a kettő nálad.
    </p>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Dátum</th><th class="num">HbA1c</th>
            <th class="num" :title="`GMI a labor előtti ${data.windowDays} nap szenzoradataiból`">GMI<small> előtte {{ data.windowDays }} nap</small></th>
            <th class="num">Eltérés</th><th class="num">Szenzoradat</th>
            <th v-if="!readOnly"><span class="sr-only">Törlés</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data.results" :key="r.id">
            <td>{{ dateLabel(r.date) }}</td>
            <td class="num"><b>{{ fmt(r.hba1c) }}%</b> <span class="muted">{{ ifcc(r.hba1c) }} mmol/mol</span></td>
            <td class="num">{{ r.gmi != null ? `${fmt(r.gmi)}%` : '–' }}</td>
            <td class="num">{{ r.gmi != null ? `${r.hba1c - r.gmi > 0 ? '+' : ''}${fmt(r.hba1c - r.gmi)}` : '–' }}</td>
            <td class="num" :class="{ muted: r.coverage < 70 }">{{ r.coverage }}%</td>
            <td v-if="!readOnly" class="act"><button type="button" class="row-del" title="Törlés" @click="remove(r)">×</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="data?.results.length" class="muted small">
      A GMI (becsült HbA1c) a szenzor átlagából számolt érték; a labor HbA1c-től 0,5 százalékpontos eltérés gyakori.
      Ha nálad tartósan ugyanabba az irányba tér el, azt érdemes megjegyezni. A szenzoradat 70% alatt kevésbé megbízható.
    </p>
  </section>
</template>
