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
        <div class="tp-cards">
        <section class="tp-card">
          <h3>Korrekció</h3>
          <div class="therapy-fields">
            <label class="tf-row">
              <span class="tf-label">Napi max korrekciós javaslat</span>
              <span class="tf-input"><input v-model.number="form.dailyMaxUnits" type="number" step="0.5" min="0.5" max="50"> E</span>
            </label>
            <p class="tf-hint">Ennyi egység korrekciót fogadhatsz el <b>összesen, naponta</b> — nem az egyszeri adag felső határa (azt a terápia maximális dózisának fele korlátozza, kódba égetve).</p>
            <label class="tf-row">
              <span class="tf-label">Legkisebb mennyiség, amiről szól</span>
              <span class="tf-input"><input v-model.number="form.minUnits" type="number" step="0.5" min="0.5" max="5"> E</span>
            </label>
            <p class="tf-hint">Ennél kisebb javasolt adagról nem küld push-t (nem éri meg vele foglalkozni).</p>
            <label class="tf-row">
              <span class="tf-label">Aktív inzulin fölött nem javasol</span>
              <span class="tf-input"><input v-model.number="form.maxIob" type="number" step="0.5" min="0.5" max="5"> E</span>
            </label>
            <p class="tf-hint">Ha ennél több inzulin van még hatásban (IOB), biztonsági okból nem javasol újabb adagot.</p>
            <label class="tf-row">
              <span class="tf-label">Lejárati idő</span>
              <select v-model.number="form.expireMin">
                <option :value="10">10 perc</option>
                <option :value="15">15 perc</option>
                <option :value="20">20 perc</option>
                <option :value="30">30 perc</option>
              </select>
            </label>
            <p class="tf-hint">Ha ennyi időn belül nem nyugtázod a javaslatot, magától lejár (nem marad örökre függőben).</p>
          </div>
        </section>

        <section class="tp-card">
          <h3>Nyugtázás utáni várakozás</h3>
          <div class="therapy-fields">
            <label class="tf-row">
              <span class="tf-label">Cooldown elfogadás után</span>
              <select v-model.number="form.cooldownAcceptMin">
                <option :value="15">15 perc</option>
                <option :value="30">30 perc</option>
                <option :value="60">60 perc</option>
              </select>
            </label>
            <p class="tf-hint">Egy beadott korrekció után ennyi ideig nem javasol újat (amíg az inzulin elkezd hatni).</p>
            <label class="tf-row">
              <span class="tf-label">Cooldown kihagyás után</span>
              <select v-model.number="form.cooldownDeclineMin">
                <option :value="30">30 perc</option>
                <option :value="60">60 perc</option>
                <option :value="120">120 perc</option>
              </select>
            </label>
            <p class="tf-hint">Ha "Kihagyom"-ot nyomsz, ennyi ideig nem kérdez rá újra ugyanarra.</p>
            <label class="tf-row">
              <span class="tf-label">Mikro-kiegészítés is (nem csak korrekció)</span>
              <input v-model="form.basalMicroEnabled" type="checkbox" class="switch" role="switch">
            </label>
            <p class="tf-hint">
              Bekapcsolva, tartósan magas, az aktív inzulinnal/szénhidráttal nem magyarázható trendnél egy apró,
              <b>nem visszavonható</b> kiegészítő adagot is javasolhat (a bázis pótlásaként), mint egy valódi pumpa
              ideiglenes bázis-emelése — csak itt nyugtáznod kell.
            </p>
            <label v-if="form.basalMicroEnabled" class="tf-row tf-sub">
              <span class="tf-label">Napi max mikro-kiegészítés</span>
              <span class="tf-input"><input v-model.number="form.basalMicroDailyMaxUnits" type="number" step="0.5" min="0" max="30"> E</span>
            </label>
            <label v-if="form.basalMicroEnabled" class="tf-row tf-sub">
              <span class="tf-label">Egy javaslat a teljes szükséglet ekkora hányada</span>
              <select v-model.number="form.basalMicroPercent">
                <option :value="10">10%</option>
                <option :value="20">20%</option>
                <option :value="30">30%</option>
                <option :value="40">40%</option>
                <option :value="50">50%</option>
              </select>
            </label>
            <p v-if="form.basalMicroEnabled" class="tf-hint tf-sub">
              Mint egy valódi pumpa SMB-je: nem fix 1 lépés, hanem a teljes (korrekcióval nem fedezett) szükséglet
              ekkora része, a toll lépésére lefelé kerekítve — minél nagyobb a trend, annál nagyobb a javaslat.
            </p>
          </div>
        </section>
        </div>

        <p class="muted small ap-hard-note">
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
summary { cursor: pointer; margin-bottom: 10px; }
.ap-hard-note { margin-top: 4px; }
</style>
