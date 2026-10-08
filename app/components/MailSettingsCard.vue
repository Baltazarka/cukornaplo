<script setup lang="ts">
// E-mail-küldés beállítása (Gmail SMTP-n): a megosztási linkek ezen mennek ki.
const { data, refresh } = await useFetch<any>('/api/mail/settings', { key: 'mail-settings' })

const form = reactive({ host: '', port: 465, user: '', pass: '', fromName: '', publicUrl: '' })
watchEffect(() => {
  if (!data.value) return
  Object.assign(form, { host: data.value.host, port: data.value.port, user: data.value.user, fromName: data.value.fromName, publicUrl: data.value.publicUrl, pass: '' })
})

const msg = ref('')
const err = ref<string[]>([])
const busy = ref('')
async function save() {
  busy.value = 'save'
  msg.value = ''
  err.value = []
  try {
    await $fetch('/api/mail/settings', { method: 'POST', body: { ...form, secure: Number(form.port) === 465 } })
    await refresh()
    msg.value = 'Mentve.'
  } catch (e: any) {
    err.value = e?.data?.errors ?? [e?.data?.error ?? 'A mentés nem sikerült.']
  } finally {
    busy.value = ''
  }
}
async function test() {
  busy.value = 'test'
  msg.value = ''
  err.value = []
  try {
    await $fetch('/api/mail/test', { method: 'POST', body: {} })
    msg.value = `Próbalevél elküldve ide: ${data.value.user}.`
  } catch (e: any) {
    err.value = [e?.data?.error ?? 'A küldés nem sikerült.']
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <section class="card" id="email">
    <h2>E-mail (Gmail)</h2>
    <p class="muted small">
      A megosztási linkek ezen keresztül mennek ki. Gmailhez <b>alkalmazásjelszó</b> kell (nem a rendes jelszavad):
      Google-fiók → Biztonság → Kétlépcsős azonosítás bekapcsolva → Alkalmazásjelszavak → új jelszó (16 karakter).
    </p>
    <p v-if="msg" class="notice">{{ msg }}</p>
    <div v-if="err.length" class="alert"><div v-for="e in err" :key="e">{{ e }}</div></div>
    <form class="mail-form" @submit.prevent="save">
      <label>Gmail-cím (feladó)
        <input v-model="form.user" type="text" inputmode="email" autocomplete="username" placeholder="valaki@gmail.com">
      </label>
      <label>Alkalmazásjelszó
        <input v-model="form.pass" type="password" autocomplete="new-password" :placeholder="data?.hasPass ? '•••• elmentve (üresen hagyva marad)' : '16 karakteres alkalmazásjelszó'">
      </label>
      <label>Feladó neve
        <input v-model="form.fromName" type="text" maxlength="60" placeholder="pl. Dávid cukornaplója">
      </label>
      <label>Az oldal nyilvános címe <span class="muted">(a linkekhez; üresen automatikus)</span>
        <input v-model="form.publicUrl" type="text" placeholder="https://vc.baltazarka.com">
      </label>
      <details>
        <summary class="muted small">SMTP-szerver (haladó)</summary>
        <div class="mail-adv">
          <label>Szerver <input v-model="form.host" type="text"></label>
          <label>Port <input v-model.number="form.port" type="number" min="1" max="65535"></label>
        </div>
        <p class="muted small">Gmail: smtp.gmail.com, 465 (SSL). Más szolgáltatónál általában 587 (STARTTLS).</p>
      </details>
      <div class="btn-row">
        <button type="submit" :disabled="busy !== ''">Mentés</button>
        <button type="button" class="ghost" :disabled="busy !== '' || !data?.hasPass || !data?.user" @click="test">Próbalevél magamnak</button>
      </div>
    </form>
  </section>
</template>
