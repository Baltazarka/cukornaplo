<script setup lang="ts">
// Megosztás: e-mailben küldött, 1 óráig érvényes, csak olvasható megtekintési link; az érvényes
// linkek listája visszavonással.
const { data: mail } = await useFetch<any>('/api/mail/settings', { key: 'mail-settings' })
const { data, refresh } = await useFetch<any>('/api/share/list', { key: 'share-list' })

const email = ref('')
const message = ref('')
const busy = ref(false)
const msg = ref('')
const err = ref('')
useToastFrom(msg, 'success')
useToastFrom(err, 'error')
const ready = computed(() => !!(mail.value?.user && mail.value?.hasPass))

const hm = (ts: number) => new Date(ts * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })

async function send() {
  busy.value = true
  msg.value = ''
  err.value = ''
  try {
    const r: any = await $fetch('/api/share/send', { method: 'POST', body: { email: email.value, message: message.value } })
    msg.value = `Elküldve: ${email.value}. A link ${hm(r.expiresAt)}-ig érvényes.`
    email.value = ''
    message.value = ''
    await refresh()
  } catch (e: any) {
    err.value = e?.data?.error ?? 'A küldés nem sikerült.'
  } finally {
    busy.value = false
  }
}
async function revoke(s: any) {
  if (!confirm(`Visszavonod a ${s.email} címre küldött linket? Aki most nézi, azonnal kiesik.`)) return
  await $fetch('/api/share/revoke', { method: 'POST', body: { id: s.id } })
  await refresh()
}
</script>

<template>
  <section class="card" id="megosztas">
    <h2>Megosztás e-mailben</h2>
    <p class="muted small">
      A címzett kap egy linket, amivel <b>1 óráig</b> megnézheti a naplót (napi nézet, időszakos nézet, riport). Csak olvasni tud,
      semmit nem módosíthat, a beállításokat nem látja. A linket bármikor visszavonhatod.
    </p>
    <p v-if="!ready" class="notice small">Előbb állítsd be fent az e-mail-küldést (Gmail-cím és alkalmazásjelszó).</p>
    <form class="share-form" @submit.prevent="send">
      <label>Címzett e-mail-címe
        <input v-model="email" type="email" required placeholder="orvos@example.com" :disabled="!ready">
      </label>
      <label><span>Üzenet <span class="muted">(nem kötelező)</span></span>
        <input v-model="message" type="text" maxlength="500" placeholder="pl. A múlt heti értékeim a kontrollhoz" :disabled="!ready">
      </label>
      <div class="btn-row">
        <button type="submit" :disabled="!ready || busy">Link küldése</button>
      </div>
    </form>

    <template v-if="data?.shares?.length">
      <h3 class="share-h">Érvényes linkek</h3>
      <table class="table">
        <thead><tr><th>Címzett</th><th class="num">Küldve</th><th class="num">Lejár</th><th>Megnyitva</th><th><span class="sr-only">Visszavonás</span></th></tr></thead>
        <tbody>
          <tr v-for="s in data.shares" :key="s.id">
            <td>{{ s.email }}</td>
            <td class="num">{{ hm(s.createdAt) }}</td>
            <td class="num">{{ hm(s.expiresAt) }}</td>
            <td>{{ s.usedAt ? `igen, ${hm(s.usedAt)}` : 'még nem' }}</td>
            <td class="act"><button type="button" class="ghost sm" @click="revoke(s)">Visszavonás</button></td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
