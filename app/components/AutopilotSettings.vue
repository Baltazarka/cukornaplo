<script setup lang="ts">
// Autopilot beállítások: felhasználó-állítható paraméterek; néhány biztonsági korlát (hipó-tiltás, adagonkénti
// plafon, lejárat-sorozat utáni önleállás) kódba égetett, itt nem jelenik meg kapcsolóként.
const props = defineProps<{ settings: any }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const readOnly = useReadOnly()

const form = reactive({ ...props.settings })
watch(() => props.settings, (v) => Object.assign(form, v))

const busy = ref(false)
const msg = ref('')
const err = ref('')
useToastFrom(msg, 'success')
useToastFrom(err, 'error')

async function save() {
  busy.value = true
  msg.value = ''
  err.value = ''
  try {
    await $fetch('/api/autopilot/settings', { method: 'POST', body: { ...form } })
    msg.value = 'Mentve.'
    emit('changed')
  } catch (e: any) {
    err.value = e?.data?.error ?? 'A mentés nem sikerült.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card">
    <details>
      <summary><h2 class="ap-settings-h">Beállítások</h2></summary>
      <form v-if="!readOnly" class="stack" @submit.prevent="save">
        <label class="check">
          <input v-model="form.basalMicroEnabled" type="checkbox">
          Mikro-kiegészítés is (nem csak korrekció)
        </label>
        <p class="muted small">
          Ha bekapcsolod, tartósan magas, az aktív inzulinnal/szénhidráttal nem magyarázható trendnél egy apró,
          <b>nem visszavonható</b> kiegészítő adagot is javasolhat (a bázis pótlásaként), jóval ritkábban, mint a korrekció.
        </p>
        <label>Napi max korrekciós javaslat
          <input v-model.number="form.dailyMaxUnits" type="number" step="0.5" min="0.5" max="20"> E
        </label>
        <label v-if="form.basalMicroEnabled">Napi max mikro-kiegészítés
          <input v-model.number="form.basalMicroDailyMaxUnits" type="number" step="0.5" min="0" max="10"> E
        </label>
        <label>Cooldown elfogadás után
          <select v-model.number="form.cooldownAcceptMin">
            <option :value="15">15 perc</option>
            <option :value="30">30 perc</option>
            <option :value="60">60 perc</option>
          </select>
        </label>
        <label>Cooldown kihagyás után
          <select v-model.number="form.cooldownDeclineMin">
            <option :value="30">30 perc</option>
            <option :value="60">60 perc</option>
            <option :value="120">120 perc</option>
          </select>
        </label>
        <label>Legkisebb mennyiség, amiről szól
          <input v-model.number="form.minUnits" type="number" step="0.5" min="0.5" max="5"> E
        </label>
        <label>Lejárati idő
          <select v-model.number="form.expireMin">
            <option :value="10">10 perc</option>
            <option :value="15">15 perc</option>
            <option :value="20">20 perc</option>
            <option :value="30">30 perc</option>
          </select>
        </label>
        <label>Aktív inzulin fölött nem javasol
          <input v-model.number="form.maxIob" type="number" step="0.5" min="0.5" max="5"> E
        </label>
        <p class="muted small">
          Biztonsági okból néhány korlát nem állítható: hipó-veszélynél sosem javasol, egyetlen javaslat sosem lehet
          nagyobb a beállított maximális bólus felénél, és 3 egymást követő, nyugtázatlanul lejárt javaslat után az
          Autopilot magát kikapcsolja.
        </p>
        <div class="btn-row">
          <button type="submit" :disabled="busy">Mentés</button>
        </div>
      </form>
    </details>
  </section>
</template>

<style scoped>
.ap-settings-h { display: inline; }
summary { cursor: pointer; }
</style>
