// A vércukor-előrejelzés tiszta számolása (hipó-riasztás és inzulinjavaslat alapja).
import test from 'node:test'
import assert from 'node:assert/strict'
import { forecast, type CoreInput } from '../server/utils/predictCore.ts'

const NOW = 1_800_000_000
/** Egyszerű, lineárisan fogyó hatásmodell: 300 perc alatt 1 → 0. */
const linear = { iob: (m: number) => Math.max(0, Math.min(1, 1 - m / 300)), activity: (m: number) => (m > 0 && m < 300 ? 1 / 300 : 0) }
/** 120 perc alatt teljesen felszívódik. */
const absorbedFrac = (_cat: unknown, minutes: number) => Math.min(1, Math.max(0, minutes / 120))
const series = (from: number, to: number) => Array.from({ length: 5 }, (_, k) => ({ ts: NOW - (4 - k) * 300, v: from + ((to - from) * k) / 4 }))
const base = (over: Partial<CoreInput> = {}): CoreInput => ({
  nowTs: NOW, latest: { ts: NOW, v: 10 }, doses: [], meals: [], absorbedFrac, pts: [], obsRate: null, isfAt: () => 2, ...over,
})

test('nincs adag, nincs étel, nincs trend: az érték marad', () => {
  const f = forecast(base())
  for (const md of ['persist', 'trend', 'residual', 'blend'] as const) assert.equal(f.atMode(30, md), 10)
  assert.equal(f.eventual, 10)
  assert.equal(f.iob, 0)
  assert.equal(f.cob, 0)
  assert.equal(f.treated, false)
  assert.equal(f.lastBolusTs, 0)
})

test('aktív inzulin lefelé viszi a becslést: 5 E, 30 perce, ISF 2 → 60 perc múlva −2, a hosszú távú érték −9', () => {
  const f = forecast(base({ latest: { ts: NOW, v: 20 }, doses: [{ ts: NOW - 30 * 60, v: 5, model: linear }] }))
  // hatás 60 percre: 5 × (iob(30) − iob(90)) × 2 = 5 × (0,9 − 0,7) × 2 = 2
  assert.ok(Math.abs(f.atMode(60, 'residual') - 18) < 1e-9)
  assert.ok(Math.abs(f.eventual - (20 - 5 * 0.9 * 2)) < 1e-9)
  assert.ok(Math.abs(f.iob - 4.5) < 1e-9)
  assert.equal(f.lastBolusTs, NOW - 30 * 60)
})

test('szénhidrát felfelé viszi, a friss ≥ 10 g kezelésnek számít, a fel nem szívódott rész a COB', () => {
  // 30 g, 60 perce (50% felszívódott), 0,5 mmol/L / g
  const f = forecast(base({ meals: [{ grams: 30, ts: NOW - 60 * 60, cat: 'x', perG: 0.5 }] }))
  assert.equal(f.cob, 15)
  assert.ok(Math.abs(f.eventual - (10 + 30 * 0.5 * 0.5)) < 1e-9)
  assert.equal(f.treated, false) // 60 perce volt: már nem „friss”
  const fresh = forecast(base({ meals: [{ grams: 15, ts: NOW - 10 * 60, cat: 'x', perG: 0.5 }] }))
  assert.equal(fresh.treated, true)
  assert.equal(forecast(base({ meals: [{ grams: 8, ts: NOW - 10 * 60, cat: 'x', perG: 0.5 }] })).treated, false) // 10 g alatt nem kezelés
})

test('esés trendje: a csillapított trend (fél meredekség, legfeljebb 15 perc) lejjebb jósol', () => {
  // 10 → 8 mmol/L 20 perc alatt = −0,1 mmol/L/perc
  const f = forecast(base({ latest: { ts: NOW, v: 8 }, pts: series(10, 8), obsRate: -0.1 }))
  assert.ok(Math.abs(f.atMode(30, 'trend') - (8 - 0.5 * 0.1 * 15)) < 1e-9)
  assert.ok(f.atMode(30, 'trend') < f.atMode(30, 'persist'))
})

test('a meredekséget korlátozza: nagyon gyors esés sem jósol 0,2 mmol/L/percnél többet', () => {
  const f = forecast(base({ latest: { ts: NOW, v: 8 }, pts: series(20, 8), obsRate: -0.6 }))
  assert.ok(Math.abs(f.atMode(30, 'trend') - (8 - 0.5 * 0.2 * 15)) < 1e-9)
})

test('az érték mindig 1,5 és 30 mmol/L között marad', () => {
  const low = forecast(base({ latest: { ts: NOW, v: 2 }, doses: [{ ts: NOW - 10 * 60, v: 30, model: linear }] }))
  assert.equal(low.eventual, 1.5)
  assert.equal(low.atMode(120, 'residual'), 1.5)
  const high = forecast(base({ latest: { ts: NOW, v: 29 }, meals: [{ grams: 400, ts: NOW, cat: 'x', perG: 0.5 }] }))
  assert.equal(high.eventual, 30)
})

test('régi mérés: a mérés és a „most” közötti inzulinhatás is beleszámít', () => {
  const fresh = forecast(base({ doses: [{ ts: NOW - 60 * 60, v: 6, model: linear }] }))
  const stale = forecast(base({ latest: { ts: NOW - 10 * 60, v: 10 }, doses: [{ ts: NOW - 60 * 60, v: 6, model: linear }] }))
  // ugyanaz a mért érték 10 perccel régebbi → a „most”-ra kevesebb marad
  assert.ok(stale.atMode(0, 'residual') < fresh.atMode(0, 'residual'))
})
