<script setup lang="ts">
// Terápia oldal: a beállítások változásai, és mellettük az eredmény a változás előtti és utáni 14 napban.
const { data } = await useFetch<any>('/api/therapy-history', { key: 'therapy-history' })
const list = computed<any[]>(() => data.value?.changes ?? [])
const when = (ts: number) => new Date(ts * 1000).toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' })
const fmt = (v: number) => v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
const out = (o: any) => (o ? `${o.tir}% céltartományban · ${fmt(o.below)}% alatta · átlag ${fmt(o.avg)}` : 'kevés adat')
</script>

<template>
  <section class="card analysis-card history-card">
    <h2>Beállítás-változások</h2>
    <p class="tp-what">Mutatja: <b>mit változtattál, és utána hogyan alakult</b> · Miből: mentésenként az előtte és utána levő 14 nap szenzoradata</p>
    <p v-if="!list.length" class="muted small">Még nincs mentett változás. Ezután minden mentés ide kerül, dátummal.</p>
    <ul v-else class="history-list">
      <li v-for="c in list" :key="c.at">
        <div class="history-head"><b>{{ when(c.at) }}</b></div>
        <ul class="history-changes"><li v-for="x in c.changes" :key="x">{{ x }}</li></ul>
        <div class="history-out small">
          <span><span class="muted">előtte:</span> {{ out(c.before) }}</span>
          <span><span class="muted">utána:</span> {{ out(c.after) }}<template v-if="c.after && c.after.days < 13"> ({{ fmt(c.after.days) }} nap)</template></span>
        </div>
      </li>
    </ul>
  </section>
</template>
