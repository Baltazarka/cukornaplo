<script setup lang="ts">
// Személyes adatok: a nyomtatható riport fejlécébe kerülnek. A TAJ-szám a megosztási linken csak
// akkor látszik, ha itt engedélyezed.
const { data, refresh } = await useFetch<any>('/api/profile', { key: 'profile' })

const form = reactive({ name: '', birthDate: '', taj: '', diabetesType: '', diagnosisYear: '' as string | number, shareTaj: false })
watchEffect(() => {
  const p = data.value?.profile
  if (!p) return
  Object.assign(form, {
    name: p.name, birthDate: p.birthDate, taj: p.taj ? formatTaj(p.taj) : '', diabetesType: p.diabetesType,
    diagnosisYear: p.diagnosisYear ?? '', shareTaj: !!p.shareTaj,
  })
})

const tajWarn = computed(() => form.taj.trim() !== '' && !validTaj(form.taj))
const thisYear = new Date().getFullYear()
const msg = ref('')
const err = ref<string[]>([])
useToastFrom(msg, 'success')
useToastFrom(err, 'error')
const busy = ref(false)
async function save() {
  busy.value = true
  msg.value = ''
  err.value = []
  try {
    await $fetch('/api/profile', { method: 'POST', body: { ...form } })
    await refresh()
    msg.value = 'Mentve. A riport fejlécében így jelenik meg.'
  } catch (e: any) {
    err.value = e?.data?.errors ?? [e?.data?.error ?? 'A mentés nem sikerült.']
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card" id="szemelyes">
    <h2>Személyes adatok</h2>
    <p class="muted small">A nyomtatható riport fejlécében jelennek meg. Mind kitöltése nem kötelező; csak ezen a szerveren tárolódnak.</p>
    <form class="profile-form" @submit.prevent="save">
      <label class="wide">Név
        <input v-model="form.name" type="text" maxlength="80" autocomplete="name" placeholder="pl. Minta Péter">
      </label>
      <label>Születési dátum
        <input v-model="form.birthDate" type="date" autocomplete="bday" min="1900-01-01">
      </label>
      <label>TAJ-szám
        <input v-model="form.taj" type="text" inputmode="numeric" maxlength="11" autocomplete="off" placeholder="123 456 789" :aria-invalid="tajWarn">
        <span v-if="tajWarn" class="err-text small">Nem érvényes TAJ-szám (az ellenőrző számjegy nem egyezik).</span>
      </label>
      <label>Cukorbetegség típusa
        <select v-model="form.diabetesType">
          <option value="">–</option>
          <option v-for="t in DIABETES_TYPES" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
      </label>
      <label>Diagnózis éve
        <input v-model="form.diagnosisYear" type="number" inputmode="numeric" min="1900" :max="thisYear" placeholder="pl. 2015">
      </label>
      <label class="check wide">
        <input v-model="form.shareTaj" type="checkbox">
        A TAJ-szám a megosztási linkkel nézőnek is látszik (pl. ha orvosnak küldöd)
      </label>
      <div class="btn-row wide">
        <button type="submit" :disabled="busy">Mentés</button>
      </div>
    </form>
  </section>
</template>
