// A bóluskalkulátor számolása: node --test tests/ (Node 22.18+).
import test from 'node:test'
import assert from 'node:assert/strict'
import { calcBolus, type BolusInput } from '../shared/utils/bolus.ts'

const base: BolusInput = { carbs: 0, bg: null, target: 6, isf: 2, icr: 10, iob: 0, maxBolus: 20 }

test('csak szénhidrát: CH ÷ arány, lefelé kerekítve 0,5-re', () => {
  const r = calcBolus({ ...base, carbs: 57 }) // 5,7 E
  assert.equal(r.carbDose, 5.7)
  assert.equal(r.dose, 5.5)
})

test('csak korrekció: (bg − cél) ÷ érzékenység', () => {
  const r = calcBolus({ ...base, bg: 12 }) // 3 E
  assert.equal(r.correction, 3)
  assert.equal(r.dose, 3)
})

test('aktív inzulin a korrekcióból vonódik le, az étkezésből nem', () => {
  const r = calcBolus({ ...base, carbs: 50, bg: 10, iob: 1.5 }) // étel 5, korr 2, iob 1,5 → 5,5
  assert.equal(r.iobUsed, 1.5)
  assert.equal(r.iobFromMeal, false)
  assert.equal(r.dose, 5.5)
})

test('több aktív inzulin, mint a korrekció, célérték fölött: az étkezési adag változatlan', () => {
  const r = calcBolus({ ...base, carbs: 50, bg: 8, iob: 5 }) // korr 1, csak 1 vonódik le
  assert.equal(r.iobUsed, 1)
  assert.equal(r.dose, 5)
})

test('célérték alatt a negatív korrekció és az aktív inzulin is csökkenti az étkezési adagot', () => {
  const r = calcBolus({ ...base, carbs: 50, bg: 4, iob: 1 }) // étel 5, korr −1, iob teljesen (2 mmol/L alatt) levonódik
  assert.equal(r.iobFromMeal, true)
  assert.equal(r.total, 3)
})

test('nincs mérés: nincs korrekció; semmi sem negatív', () => {
  assert.equal(calcBolus({ ...base, carbs: 30 }).correction, 0)
  assert.equal(calcBolus({ ...base, bg: 3, iob: 5 }).dose, 0)
})

test('a maximális dózisnál nem több, és capped jelzi', () => {
  const r = calcBolus({ ...base, carbs: 300, maxBolus: 12.3 })
  assert.equal(r.dose, 12)
  assert.equal(r.capped, true)
})

test('lebegőpontos hiba: 6,9999… nem kerekedik le', () => {
  assert.equal(calcBolus({ ...base, carbs: 70 }).dose, 7)
})

test('mentések megőrzése: az utolsó 7 marad, idegen fájlhoz nem nyúl', async () => {
  const { staleBackups } = await import('../shared/utils/backupKeep.ts')
  const names = Array.from({ length: 9 }, (_, i) => `diabetes-2026-11-0${i + 1}.sqlite`)
  assert.deepEqual(staleBackups([...names, 'x.txt', 'diabetes-2026-11-01.sqlite.tmp'], 7), names.slice(0, 2))
})

test('mentések megőrzése: a beállításfájlból is az utolsó 7 marad, a két fajta külön számít', async () => {
  const { staleBackups } = await import('../shared/utils/backupKeep.ts')
  const days = Array.from({ length: 9 }, (_, i) => `2026-11-0${i + 1}`)
  const files = [...days.map((d) => `diabetes-${d}.sqlite`), ...days.slice(0, 3).map((d) => `settings-${d}.json`)]
  assert.deepEqual(staleBackups(files, 7).sort(), ['diabetes-2026-11-01.sqlite', 'diabetes-2026-11-02.sqlite'])
})

test('inzulinjavaslat: a szükséglet fele, a toll lépésére lefelé kerekítve, a maximális bólusig', async () => {
  const { suggestInsulin } = await import('../shared/utils/suggest.ts')
  const base = { target: 6, isf: 1, maxBolus: 30, step: 1 }
  assert.deepEqual(suggestInsulin({ ...base, eventual: 19 }), { units: 6, full: 13 }) // 13 E szükséglet → 6,5 → 6
  assert.equal(suggestInsulin({ ...base, eventual: 19, step: 0.5 })?.units, 6.5)
  assert.equal(suggestInsulin({ ...base, eventual: 19, maxBolus: 4.5 })?.units, 4)
  assert.equal(suggestInsulin({ ...base, eventual: 7.8 }), null) // 1,8 E szükséglet → 0,9 < 1 egész
  assert.equal(suggestInsulin({ ...base, eventual: 5 }), null)
})

test('push-feliratkozás: csak az ismert push-szolgáltatók https címe, belső cím és más port nem', async () => {
  const { pushEndpointAllowed: ok } = await import('../shared/utils/pushHosts.ts')
  assert.equal(ok('https://web.push.apple.com/abc'), true)
  assert.equal(ok('https://fcm.googleapis.com/fcm/send/abc'), true)
  assert.equal(ok('https://updates.push.services.mozilla.com/wpush/v2/abc'), true)
  assert.equal(ok('https://wns2-par02p.notify.windows.com/?token=abc'), true)
  assert.equal(ok('http://web.push.apple.com/abc'), false)
  assert.equal(ok('https://192.168.1.1/abc'), false)
  assert.equal(ok('https://evil.example.com/web.push.apple.com'), false)
  assert.equal(ok('https://web.push.apple.com.evil.com/abc'), false)
  assert.equal(ok('https://web.push.apple.com:8443/abc'), false)
  assert.equal(ok('nem url'), false)
})

test('terápia-előzmény: a mentés időbélyege nem számít, minden más változás igen', async () => {
  const { sameTherapy } = await import('../shared/utils/sameTherapy.ts')
  const t = { mealMode: 'carbs' as const, maxBolus: 30, actionMinutes: 240, byTimeOfDay: false, segments: [{ start: '00:00', target: 5.5, isf: 0.5, icr: 2 }], source: 'manual' as const, updatedAt: 1 }
  assert.equal(sameTherapy(t, { ...t, updatedAt: 999 }), true)
  assert.equal(sameTherapy(t, { ...t, maxBolus: 25 }), false)
  assert.equal(sameTherapy(t, { ...t, segments: [{ ...t.segments[0], isf: 0.6 }] }), false)
  assert.equal(sameTherapy(t, null), false)
})

test('érvénytelen bemenet nem ad NaN vagy negatív adagot', () => {
  const ok = { carbs: 60, bg: 10, target: 6, isf: 2, icr: 10, iob: 1, maxBolus: 20 }
  for (const bad of [{ target: NaN }, { iob: NaN }, { bg: NaN }, { step: 0 }, { step: NaN }, { maxBolus: -1 }, { maxBolus: NaN }, { carbs: NaN }, { icr: NaN }, { isf: NaN }]) {
    const r = calcBolus({ ...ok, ...bad } as BolusInput)
    assert.ok(Number.isFinite(r.dose) && r.dose >= 0, JSON.stringify(bad) + ' → ' + r.dose)
  }
  assert.equal(calcBolus({ ...ok, maxBolus: -1 }).dose, 0)
  assert.equal(calcBolus({ ...ok, step: 0 }).dose, calcBolus({ ...ok }).dose) // az érvénytelen lépésköz helyett 0,5
})

test('javaslat és zsír-fehérje: érvénytelen ISF, maximum, százalék és mennyiség nem ad értelmetlen adagot', async () => {
  const { suggestInsulin } = await import('../shared/utils/suggest.ts')
  const { fpuSuggestion, fpuUnits } = await import('../shared/utils/fpu.ts')
  assert.equal(suggestInsulin({ eventual: 12, target: 6, isf: 0, maxBolus: 10, step: 1 }), null)
  assert.equal(suggestInsulin({ eventual: 12, target: 6, isf: 2, maxBolus: NaN, step: 1 }), null)
  assert.equal(suggestInsulin({ eventual: 12, target: 6, isf: 2, maxBolus: 10, step: 0 }), null)
  assert.ok((fpuSuggestion(30, 30, 5, -50) ?? { extra: 0 }).extra >= 0)
  assert.equal(fpuSuggestion(30, 30, 5, 150)?.extra, fpuSuggestion(30, 30, 5, 100)?.extra)
  assert.equal(fpuUnits(Infinity, 0), fpuUnits(300, 0))
})
