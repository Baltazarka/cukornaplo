<script setup lang="ts">
// Terápiás beállítások kézi szerkesztése (célérték, ISF, CH-arány, hatásidő napszakonként).
import type { Therapy, TherapySegment } from '#shared/types/therapy'

const { data } = await useFetch<{ therapy: Therapy | null; shift: any }>('/api/therapy', { key: 'therapy' })

type EditSegment = { start: string; target: number | ''; isf: number | ''; icr: number | ''; actionMinutes: number | ''; key: number }
let nextKey = 0
const toEdit = (s: Partial<TherapySegment>): EditSegment => ({
  start: s.start ?? '00:00', target: s.target ?? '', isf: s.isf ?? '', icr: s.icr ?? '', actionMinutes: s.actionMinutes ?? '', key: nextKey++,
})

const t = data.value?.therapy
const bolusInsulin = ref<string>(t?.bolusInsulin ?? '')
const basalInsulin = ref<string>(t?.basalInsulin ?? '')
const bolusOptions = INSULINS.filter((i) => i.kind === 'bolus')
const basalOptions = INSULINS.filter((i) => i.kind === 'basal')
const bolusInfo = computed(() => insulinById(bolusInsulin.value))
const basalInfo = computed(() => insulinById(basalInsulin.value))
const maxBolus = ref<number | ''>(t?.maxBolus ?? '')
// A bázis automatikus beírása: naponta a megadott időpontban a naplóba kerül (push értesítéssel).
const basalAutoOn = ref<boolean>(!!t?.basalAuto)
const basalAutoTime = ref<string>(t?.basalAuto?.time ?? '07:00')
const basalAutoUnits = ref<number | ''>(t?.basalAuto?.units ?? '')
const actionMinutes = ref<number>(t?.actionMinutes ?? 240)
const fpuPercent = ref<number>(t?.fpuPercent ?? 50)
const fpuTiming = ref<'later' | 'together'>(t?.fpuTiming ?? 'later')
const fpuOptions = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const byTimeOfDay = ref<boolean>(t?.byTimeOfDay ?? true)
const segments = ref<EditSegment[]>(t ? t.segments.map(toEdit) : [toEdit({ start: '06:00' })])
// Váltott műszak: külön napszakbeállítás a délutános hétre (bekapcsoláskor az alap másolatával indul).
const altEnabled = ref<boolean>(!!t?.altEnabled)
const altSegments = ref<EditSegment[]>(t?.altSegments?.length ? t.altSegments.map(toEdit) : [])
const freeProfile = ref<'base' | 'alt'>(t?.freeProfile ?? 'base')
watch(altEnabled, (on) => {
  if (on && !altSegments.value.length) altSegments.value = segments.value.map(({ key, ...s }) => toEdit({ ...s, target: s.target || undefined, isf: s.isf || undefined, icr: s.icr || undefined, actionMinutes: s.actionMinutes || undefined }))
})
const shiftOn = computed(() => !!data.value?.shift?.enabled)
const newKey = () => nextKey++
const baseEd = ref<{ add: () => void } | null>(null)
const altEd = ref<{ add: () => void } | null>(null)

// 2:00–8:00 negyedórás lépésekben, ahogy az InPen is kínálja.
const actionOptions = Array.from({ length: (480 - 120) / 15 + 1 }, (_, i) => 120 + i * 15)

// Kikapcsolt napszakbeállításnál csak a legkorábban kezdődő napszak érvényes (a többi megmarad).
const visible = computed(() =>
  byTimeOfDay.value ? segments.value : [...segments.value].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start)).slice(0, 1),
)

// Tájékoztatás a napi összinzulinból (TDD, az utolsó 30 nap átlaga, bázissal): az ökölszabályok szerinti kiinduló
// értékek (ISF ≈ 100 ÷ TDD mmol/L/E, CH-arány ≈ 500 ÷ TDD g/E). Nem tiltás és nem javaslat: a szabály csak kiindulópont,
// a beállítás a diabetológus döntése. Csak akkor emeljük ki, ha az ISF több mint kétszeresen eltér a szabálytól.
const { data: period } = await useFetch<any>('/api/agp', { query: { days: 30 }, key: 'agp-30-tdd' })
const tdd = computed(() => {
  const t = period.value?.totals
  return t && t.penDays >= 3 && t.insulinPerDay > 0 ? (t.insulinPerDay as number) : null
})
const rule = computed(() => (tdd.value ? { isf: 100 / tdd.value, icr: 500 / tdd.value } : null))
const isfOff = computed(() => {
  if (!rule.value) return []
  return visible.value
    .filter((s) => Number(s.isf) > 0 && (Number(s.isf) > rule.value!.isf * 2 || Number(s.isf) < rule.value!.isf / 2))
    .map((s) => s.start)
})
const hu = (v: number, dec = 1) => v.toLocaleString('hu-HU', { maximumFractionDigits: dec })

// A becslés melletti tipphez: napszakonként mennyi tiszta korrekció / étkezés hiányzik még a megbízható (5) becsléshez,
// az utolsó 14 napból (a becslés kártya alapértelmezett időszaka, ugyanaz a lekérés).
const { data: ana } = await useFetch<any>('/api/analysis', { query: { days: 14 }, key: 'analysis-14' })
const need = computed<{ label: string; corr: number; meal: number }[]>(() =>
  (ana.value?.segments ?? []).map((s: any) => ({
    label: `${s.start}–${s.end}`,
    corr: Math.max(0, 5 - s.counts.cleanCorrections),
    meal: Math.max(0, 5 - s.counts.cleanMeals),
  })),
)


// A becslések átvétele a szerkesztőbe (napszak-kezdet szerint párosítva); menteni külön kell.
const applied = ref('')
function applyEstimates(values: { start: string; isf?: number; icr?: number; actionMinutes?: number }[]) {
  const sorted = [...segments.value].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start))
  const changed: string[] = []
  for (const v of values) {
    const row = byTimeOfDay.value ? segments.value.find((s) => s.start === v.start) : sorted[0]
    if (!row) continue
    const parts: string[] = []
    if (v.isf != null) { row.isf = v.isf; parts.push('ISF') }
    if (v.icr != null) { row.icr = v.icr; parts.push('CH-arány') }
    // Napszakok nélkül a közös hatásidő érvényes (a napszak saját mezőjét a szerver ilyenkor nem használja).
    if (v.actionMinutes != null) {
      if (byTimeOfDay.value) row.actionMinutes = v.actionMinutes
      else actionMinutes.value = v.actionMinutes
      parts.push('hatásidő')
    }
    if (parts.length) changed.push(`${row.start}: ${parts.join(', ')}`)
  }
  applied.value = '' // az ismételt, azonos üzenet is jelenjen meg
  applied.value = changed.length ? `Beírtam a becsléseket (${changed.join('; ')}). Nézd át, és ha jó, mentsd.` : ''
  if (changed.length) document.querySelector('.therapy-edit-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// A saját zsír-fehérje % átvétele a szerkesztőbe (menteni külön kell).
function applyFpu(pct: number) {
  fpuPercent.value = pct
  applied.value = ''
  applied.value = `A zsír-fehérje javaslatot ${pct}%-ra állítottam. Nézd át, és ha jó, mentsd.`
  document.querySelector('.fpu-select')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const errors = ref<string[]>([])
useToastFrom(applied, 'info')
useToastFrom(errors, 'error')
const saving = ref(false)
async function save() {
  saving.value = true
  errors.value = []
  try {
    await $fetch('/api/therapy', {
      method: 'POST',
      body: {
        bolusInsulin: bolusInsulin.value || null,
        basalInsulin: basalInsulin.value || null,
        basalAuto: { enabled: basalAutoOn.value, time: basalAutoTime.value, units: basalAutoUnits.value },
        maxBolus: maxBolus.value,
        actionMinutes: actionMinutes.value,
        fpuPercent: fpuPercent.value,
        fpuTiming: fpuTiming.value,
        byTimeOfDay: byTimeOfDay.value,
        segments: segments.value.map(({ start, target, isf, icr, actionMinutes }) => ({ start, target, isf, icr, actionMinutes: actionMinutes || null })),
        altEnabled: altEnabled.value,
        altSegments: altSegments.value.map(({ start, target, isf, icr, actionMinutes }) => ({ start, target, isf, icr, actionMinutes: actionMinutes || null })),
        freeProfile: freeProfile.value,
      },
    })
    await refreshNuxtData('therapy')
    await navigateTo('/')
  } catch (e: any) {
    errors.value = e?.data?.errors ?? ['A mentés nem sikerült.']
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="therapy-page">
    <h1 class="tp-title">Terápia</h1>
    <!-- Minden beállítás-csoport külön kártyán; a Mentés közös, alul végig látszik. -->
    <form class="therapy-edit tp-edit" @submit.prevent="save">
      <div class="tp-row">
      <div class="tp-cards n3">
      <section class="card tp-card">
      <h2>Bólus</h2>
      <div class="therapy-fields">
        <label class="tf-row">
          <span class="tf-label">Bólusinzulin</span>
          <select v-model="bolusInsulin">
            <option value="">Nincs megadva</option>
            <option v-for="i in bolusOptions" :key="i.id" :value="i.id">{{ i.name }} ({{ i.generic }})</option>
          </select>
        </label>
        <label class="tf-row">
          <span class="tf-label">Kiszámított maximális dózis</span>
          <span class="tf-input"><input v-model.number="maxBolus" type="number" step="0.5" min="0.5" max="50" required> E</span>
        </label>
        <label class="tf-row">
          <span class="tf-label">Inzulinhatás időtartama</span>
          <select v-model.number="actionMinutes">
            <option v-for="m in actionOptions" :key="m" :value="m">{{ actionLabel(m) }}</option>
          </select>
        </label>
        <div v-if="bolusInfo?.peakMinutes" class="tf-curve">
          <ClientOnly><InsulinCurve :peak-minutes="bolusInfo.peakMinutes" :duration-minutes="actionMinutes" :height="150" /></ClientOnly>
          <details class="more">
            <summary>A görbéről</summary>
            <p class="muted small">
              Az OpenAPS / Loop exponenciális modelljével készül: a csúcs ideje az inzulin típusától függ
              ({{ bolusInfo.name }}: {{ actionLabel(bolusInfo.peakMinutes) }}), a hossza a fenti hatásidő.
              <template v-if="bolusInfo.facts">Alkalmazási előírás: hatáskezdet {{ bolusInfo.facts.onset }}, legerősebb hatás {{ bolusInfo.facts.peak }}, hatástartam {{ bolusInfo.facts.duration }}.</template>
            </p>
          </details>
        </div>
      </div>

      </section>

      <section class="card tp-card">
      <h2>Bázis</h2>
      <div class="therapy-fields">
        <label class="tf-row">
          <span class="tf-label">Bázisinzulin</span>
          <select v-model="basalInsulin">
            <option value="">Nincs megadva</option>
            <option v-for="i in basalOptions" :key="i.id" :value="i.id">{{ i.name }} ({{ i.generic }})</option>
          </select>
        </label>
        <p v-if="basalInfo?.facts" class="tf-hint">
          {{ basalInfo.name }}: {{ [basalInfo.facts.peak, basalInfo.facts.duration].filter(Boolean).join(', ') }}.
        </p>
        <label class="tf-row">
          <span class="tf-label">Automatikus beírás a naplóba</span>
          <input v-model="basalAutoOn" type="checkbox" class="switch" role="switch">
        </label>
        <template v-if="basalAutoOn">
          <label class="tf-row tf-sub">
            <span class="tf-label">Beadás időpontja</span>
            <input v-model="basalAutoTime" type="time" required>
          </label>
          <label class="tf-row tf-sub">
            <span class="tf-label">Bázisadag</span>
            <span class="tf-input"><input v-model.number="basalAutoUnits" type="number" step="0.5" min="1" max="100" required> E</span>
          </label>
          <p class="tf-hint tf-sub">Ha aznap még nincs bázis, ekkor beírja és értesít; a kézzel beírt a helyére lép.</p>
        </template>
      </div>

      </section>

      <section class="card tp-card">
      <h2>Zsíros, fehérjedús étel</h2>
      <div class="therapy-fields">
        <label class="tf-row">
          <span class="tf-label">Zsír-fehérje javaslat</span>
          <select v-model.number="fpuPercent" class="fpu-select">
            <option v-for="p in fpuOptions" :key="p" :value="p">{{ p === 0 ? 'nincs' : `a varsói érték ${p}%-a` }}</option>
          </select>
        </label>
        <label class="tf-row">
          <span class="tf-label">A plusz adag ideje</span>
          <select v-model="fpuTiming" :disabled="!fpuPercent">
            <option value="later">később (emlékeztető 1,5 ó múlva)</option>
            <option value="together">egyben, evéskor</option>
          </select>
        </label>
        <details class="more tf-more">
          <summary>Hogyan működik?</summary>
          <p class="muted small">
            Zsíros / fehérjedús étkezésnél a bóluskalkulátor a számolt adag alatt tájékoztatásul kiírja, mennyi plusz inzulin
            jönne ki a zsír és a fehérje grammjából (1 zsír-fehérje egység = 100 kcal zsírból és fehérjéből ≈ 10 g CH), és
            mikorra. A teljes érték sokaknál későbbi hipót okoz; a szorzót a diabetológussal egyeztesd.
            <b>Egyben</b> adva a zsír hatása még nem kezdődött el, amikor az inzulin a legerősebb (1–1,5 óra): korai hipó lehet,
            ezért ilyenkor 75 perc múlva ellenőrző emlékeztető jön. <b>Később</b> adva 1,5 óra múlva emlékeztet a plusz adagra.
          </p>
        </details>
      </div>

      </section>
      </div>
      <TpTip>
        <ul>
          <li>Ezekhez méri a becsléseket: töltsd ki úgy, ahogy a diabetológussal egyeztetted.</li>
          <li><b>Bázis:</b> kapcsold be az automatikus beírást, vagy írd be minden nap; a napi összinzulin ebből jön.</li>
          <li><b>Zsíros étel:</b> a naplóban jelöld 🧀 zsírosnak, és írd be a zsír és a fehérje grammját.</li>
        </ul>
      </TpTip>
      </div>

      <div class="tp-row">
      <section class="card tp-card">
      <h2>Napszakok</h2>
      <div class="therapy-fields">
        <label class="tf-row">
          <span class="tf-label">Napszakonként eltérő értékek</span>
          <input v-model="byTimeOfDay" type="checkbox" class="switch" role="switch">
        </label>
      </div>
      <div class="seg-block">
        <div v-if="altEnabled || byTimeOfDay" class="seg-head">
          <h3 class="seg-profile-h">{{ altEnabled ? 'Délelőttös hét és minden más nap' : 'Napszakok' }}</h3>
          <button v-if="byTimeOfDay" type="button" class="ghost sm" :disabled="segments.length >= 12" @click="baseEd?.add()">+ Napszak</button>
        </div>
        <SegmentsEditor ref="baseEd" :segments="segments" :by-time-of-day="byTimeOfDay" :action-minutes="actionMinutes" :action-options="actionOptions" :new-key="newKey" />
      </div>
      <p v-if="rule" class="tf-calc small">
        Kiinduló érték a napi összinzulinból (<span class="calc">{{ hu(tdd!, 0) }} E</span>, 30 nap átlaga):
        ISF ≈ <span class="calc">{{ hu(rule.isf) }}</span> mmol/L/E · CH-arány ≈ <span class="calc">{{ hu(rule.icr) }}</span> g/E
        <span class="muted">(100 ÷ TDD, 500 ÷ TDD; csak kiindulópont)</span>
      </p>
      <p v-if="isfOff.length" class="notice small" role="note">
        <b>Egyeztesd:</b> az ISF{{ byTimeOfDay ? ` (${isfOff.join(', ')})` : '' }} több mint kétszeresen eltér a napi összinzulinodból számolt kiinduló értéktől.
        Az előrejelzés és a javaslatok erre épülnek, ezért érdemes a diabetológussal átbeszélni.
      </p>
      <details class="more">
        <summary>Tudnivalók a napszakokról</summary>
        <p v-if="byTimeOfDay" class="muted small">Minden napszak a következő kezdetéig tart, az utolsó éjfélen át az elsőig. Mentéskor időrendbe kerülnek.
          Ha egy napszakhoz külön inzulinhatás-időt adsz meg, a napi grafikonon az abban beadott bólusok hatásgörbéje ezzel rajzolódik; „közös” esetén a fenti érték érvényes.</p>
        <p v-else class="muted small">Kikapcsolva ezek az értékek egész nap érvényesek. A többi napszakot megőrzöm, visszakapcsolva újra látszanak.</p>
      </details>

      <!-- Váltott műszak: külön értékek a délutános hétre (a műszakbeosztás lent, a „Váltott műszak” kártyán). -->
      <div class="therapy-fields">
        <label class="tf-row">
          <span class="tf-label">Külön értékek a délutános hétre</span>
          <input v-model="altEnabled" type="checkbox" class="switch" role="switch">
        </label>
      </div>
      <template v-if="altEnabled">
        <p v-if="!shiftOn" class="notice small" role="note">Ehhez add meg lent, a „Váltott műszak” kártyán, milyen műszakos ez a hét; addig az alap beállítás érvényes minden nap.</p>
        <div class="seg-block">
          <div class="seg-head">
            <h3 class="seg-profile-h">Délutános hét</h3>
            <button v-if="byTimeOfDay" type="button" class="ghost sm" :disabled="altSegments.length >= 12" @click="altEd?.add()">+ Napszak</button>
          </div>
          <SegmentsEditor ref="altEd" :segments="altSegments" :by-time-of-day="byTimeOfDay" :action-minutes="actionMinutes" :action-options="actionOptions" :new-key="newKey" />
        </div>
        <div class="therapy-fields">
          <label class="tf-row">
            <span class="tf-label">Szabadnapon érvényes</span>
            <select v-model="freeProfile">
              <option value="base">a délelőttös hét értékei</option>
              <option value="alt">a délutános hét értékei</option>
            </select>
          </label>
          <p class="tf-hint">A délutános héten ezek érvényesek; az elemzés az alap napszakok szerint csoportosít.</p>
        </div>
      </template>

      </section>
      <TpTip>
        <ul>
          <li>Az elemzés ezek szerint csoportosít: olyan napszakokat adj meg, amikor tényleg mást kell adnod (pl. reggel, napközben, este, éjjel).</li>
          <li>A becslés napszakonként külön gyűlik, ezért a túl sok, rövid napszak lassan telik meg.</li>
          <li>Váltott műszaknál kapcsold be a délutános hetet, és lent jelöld meg a beosztást.</li>
        </ul>
      </TpTip>
      </div>

      <div class="btn-row therapy-save">
        <span class="spacer" />
        <NuxtLink to="/" class="btn ghost">Mégse</NuxtLink>
        <button type="submit" :disabled="saving">Mentés</button>
      </div>
    </form>
    <div class="tp-row">
      <ShiftCard />
      <TpTip>
        <ul>
          <li>Csak akkor kell, ha hetente váltakozó műszakban dolgozol.</li>
          <li>Jelöld meg, milyen ez a hét; onnan magától vált. Az eltérő napot a főoldalon, a nap fejlécénél írd át.</li>
        </ul>
      </TpTip>
    </div>

    <h2 class="tp-title">Az adataidból számolva</h2>
    <div class="tp-row">
      <AnalysisCard @apply="applyEstimates" />
      <TpTip>
        <p v-if="need.some((n) => n.corr || n.meal)" class="muted small">Még kell a megbízható becsléshez (14 nap):</p>
        <ul v-if="need.length" class="tip-need">
          <li v-for="n in need" :key="n.label">
            <b>{{ n.label }}</b>:
            <template v-if="!n.corr && !n.meal">megvan ✓</template>
            <template v-else>{{ [n.corr ? `${n.corr} korrekció` : '', n.meal ? `${n.meal} étkezés` : ''].filter(Boolean).join(', ') }}</template>
          </li>
        </ul>
        <ul>
          <li><b>Tiszta korrekció</b> (érzékenység, hatásidő): ha étkezésen kívül magas vagy, add be és írd be a bólust, utána a hatásidő végéig (kb. 4 óra) ne egyél és ne adj más bólust.</li>
          <li><b>Tiszta étkezés</b> (CH-arány): írd be a CH-t és a bólust; előtte 1 órával és utána 4 óráig ne egyél, ne adj más bólust, és ne hipóból indulj.</li>
          <li>Sportnál, betegségnél, alkoholnál írj jegyzetet: ezeket kihagyja. A ráfekvést jelöld kizártnak.</li>
        </ul>
      </TpTip>
    </div>
    <div class="tp-row">
      <div class="tp-cards">
        <FpuCard @apply="applyFpu" />
        <!-- Üres végdátum: a szerver a mai napig számol. -->
        <BasalCheck class="analysis-card" end="" :days="30" selectable />
      </div>
      <TpTip>
        <ul>
          <li><b>Zsír-fehérje %:</b> zsíros ételnél jelöld 🧀 zsírosnak, írd be a CH, a zsír és a fehérje grammját, és utána legalább 3–4 óráig ne egyél mást.</li>
          <li><b>Bázis:</b> legyenek 3 óránál hosszabb szakaszok étel és bólus nélkül (pl. éjjel, kihagyott étkezésnél); napszakonként legalább 3 napról kell ilyen.</li>
        </ul>
      </TpTip>
    </div>
    <div class="tp-row">
      <AbsorptionCard />
      <TpTip>
        <ul>
          <li>A tiszta étkezésekből tanul (lásd a becslésnél): írd be a CH-t, és utána ne egyél mást.</li>
          <li>Gyors CH-nál (pl. hipókezelés, szőlőcukor) jelöld ⚡ gyorsnak; zsírosnál 🧀-t.</li>
        </ul>
      </TpTip>
    </div>
    <div class="tp-row">
      <PredictAccuracyCard />
      <TpTip>
        <ul>
          <li>Ehhez nem kell tenned semmit: a szenzoradatokból magától számol.</li>
          <li>Minél pontosabban írod be a CH-t és a bólust (időponttal), annál pontosabb az előrejelzés.</li>
        </ul>
      </TpTip>
    </div>
  </main>
</template>
