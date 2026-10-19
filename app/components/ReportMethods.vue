<script setup lang="ts">
// A nyomtatott riport végére: a számítások rövid összefoglalója képletekkel (a részletes leírás a „Számítások” panelen).
const props = defineProps<{ low: number; high: number }>()
const f = (v: number) => v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
</script>

<template>
  <section class="report-section report-methods">
    <h2>Számítások röviden</h2>
    <div class="rm-grid">
      <div>
        <h3>Glükóz</h3>
        <pre>sávok: &lt; 3,0 · 3,0–{{ f(props.low) }} · {{ f(props.low) }}–{{ f(props.high) }} (cél) · {{ f(props.high) }}–13,9 · &gt; 13,9
CV  = SD ÷ átlag × 100%          (≤ 36% stabil)
GMI = 3,31 + 0,02392 × átlag(mg/dL),  mg/dL = mmol/L × 18,018
lefedettség = mérések ÷ (eltelt idő ÷ 5 perc)   (az első méréstől)</pre>
        <p>Dupla szenzorérték (CareLink + Health, 2,5 percen belül) csak egyszer számít. A kézi mérés a mutatókba beleszámít, a lefedettségbe és a trendbe nem.</p>
      </div>
      <div>
        <h3>Hipó, trend</h3>
        <pre>hipóesemény: ≥ 15 perc {{ f(props.low) }} alatt;  2. szint: ≥ 15 perc 3,0 alatt
vége: ≥ 15 perc újra fölötte;  éjszakai: 0–6 óra között kezdődött
sebesség = (most − ~15 perccel előbb) ÷ perc
nyilak: ≥ 0,06 / 0,11 / 0,17 mmol/L/perc = 1 / 2 / 3 nyíl</pre>
      </div>
      <div>
        <h3>Inzulin</h3>
        <pre>bázis: = bázisadag, vagy &gt; max. bólus és a bázisadag ±25%-a
étkezési: CH 30 perccel előtte – 60 percen belül;  különben korrekció
TDD = étkezési + korrekció + bázis   (naplózott adagok)
aktív inzulin = Σ adag × aktív(t)   (exponenciális modell,
                csúcs 75 perc, hatásidő a terápiából)</pre>
        <p>A napi összeg a beadás időpontja szerint számol; a be nem írt bázist nem becsüli.</p>
      </div>
      <div>
        <h3>Szénhidrát-felszívódás</h3>
        <pre>x = eltelt idő ÷ (CH ÷ g/óra)        (45 perc – 8 óra)
felszívódott(x) = 2x²             ha x &lt; 0,5
                = 1 − 2(1 − x)²   ha x ≥ 0,5
aktív CH = Σ CH × (1 − felszívódott)</pre>
        <p>Elég tiszta étkezésnél (≥ 3) a saját, tanult görbe számít, kategóriánként (normál / zsíros / gyors).</p>
      </div>
      <div>
        <h3>Bóluskalkulátor</h3>
        <pre>étkezési  = CH ÷ CH-arány
korrekció = (vércukor − célérték) ÷ ISF
aktív inzulin: a korrekcióból vonódik le; a cél alatt az
               étkezésiből is (1 mmol/L-rel alatta teljesen)
javasolt  = 0,5 E-re lefelé kerekítve, ≤ max. bólus</pre>
      </div>
      <div>
        <h3>Előrejelzés</h3>
        <pre>modell(t) = mért − Σ adag × Δaktív × ISF + Σ CH × Δfelszívódott × ISF ÷ CH-arány
trend(t)  = mért + meredekség(utolsó 20 perc) × t
becslés   = (modell · w + trend) ÷ (w + 1),  w = 0,1 · 2,5^(t ÷ 5 perc)</pre>
        <p>A mérés időpontjától számol; minden adag és étkezés a saját napszakának ISF-jével és CH-arányával.</p>
      </div>
      <div>
        <h3>Becslés a mért adatokból</h3>
        <pre>ISF, hatásidő: tiszta korrekciók esése ÷ E, illesztve
               (3 óra utáni zavarásnál a zavarásig)
               esés(t) ≈ ISF × (1 − aktív(t))
CH-arány = felszívódott CH ÷ (hatott inzulin + (végpont − kezdő) ÷ ISF)
végpont: 4–6 óra;  3 óra utáni zavarásnál a zavarásig</pre>
        <p>Napszakonként legalább 3 tiszta esemény kell, 5 a megbízhatóhoz; az eredmény a medián.</p>
      </div>
      <div>
        <h3>Bázisellenőrzés</h3>
        <pre>sodródás = vércukor-változás mmol/L/óra a böjt-időszakokban
           (étkezés után 4–6 óra és bólus hatásideje kizárva)
stabil: ±0,3 mmol/L/óra</pre>
      </div>
    </div>
  </section>
</template>

<style>
.report-methods { break-before: page; }
.rm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
.rm-grid h3 { margin: 0 0 3px; font-size: 13px; }
.rm-grid pre { margin: 0 0 3px; font-size: 10.5px; line-height: 1.35; white-space: pre-wrap; font-family: ui-monospace, Consolas, monospace; }
.rm-grid p { margin: 0; font-size: 11px; color: var(--text-muted); }
.rm-grid > div { break-inside: avoid; }
@media (max-width: 700px) { .rm-grid { grid-template-columns: 1fr; } }
</style>
