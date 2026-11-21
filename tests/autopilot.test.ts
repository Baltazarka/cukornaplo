// Az Autopilot-motor döntései: node --test tests/ (Node 22.18+, a .ts-t közvetlenül futtatja, nincs új csomag).
import test from 'node:test'
import assert from 'node:assert/strict'
import { apDecide, type ApInput, type ApParams } from '../server/utils/autopilotEngine.ts'

const NOW = 1_800_000_000
const params: ApParams = { target: 5.5, isf: 0.5, icr: 2, low: 3.9, high: 10, fraction: 0.5, maxIob: 30, maxStep: 10, minStep: 0.5, spacingMin: 60 }
/** Szenzorsor 5 percenként az utolsó 30 percre: `from` → `to` egyenletesen. */
const series = (from: number, to: number, endAgoMin = 0) =>
  Array.from({ length: 7 }, (_, k) => ({ ts: NOW - endAgoMin * 60 - (6 - k) * 300, v: from + ((to - from) * k) / 6 }))
const input = (over: Partial<ApInput> = {}): ApInput => ({
  nowTs: NOW, glucose: series(12, 12), iobAt: () => 0, cobAt: () => 0, lastBolusTs: null,
  remaining: (m) => Math.max(0, 1 - m / 240), params, ...over,
})

test('magas, lapos vércukor, nincs aktív inzulin: a teljes szükséglet fele', () => {
  const d = apDecide(input())
  assert.equal(d.state, 'suggest')
  assert.equal(d.full, 13) // (12 − 5,5) ÷ 0,5
  assert.equal(d.units, 6.5)
})

test('esik a vércukor: várakozás, nincs adag', () => {
  const d = apDecide(input({ glucose: series(13, 12) }))
  assert.equal(d.state, 'hold')
  assert.equal(d.units, null)
})

test('a várható mélypont a céltartomány alatt van: nincs javaslat', () => {
  // 11 mmol/L, de 16 E aktív inzulin még 8 mmol/L-t levinne → 3 körülire
  const d = apDecide(input({ glucose: series(11, 11), iobAt: (ts) => (ts <= NOW ? 16 : 0) }))
  assert.equal(d.state, 'hold')
})

test('friss adag után várakozás', () => {
  const d = apDecide(input({ lastBolusTs: NOW - 20 * 60 }))
  assert.equal(d.state, 'wait')
})

test('a határ feletti aktív inzulin: várakozás, és kiírja, mennyit javasolna a határ nélkül', () => {
  // 20 mmol/L, 6 E aktív inzulin (3 mmol/L-t levinne), határ 5 E
  const d = apDecide(input({ glucose: series(20, 20), iobAt: (ts) => (ts <= NOW ? 6 : 0), params: { ...params, maxIob: 5 } }))
  assert.equal(d.state, 'wait')
  assert.equal(d.units, null)
  assert.match(d.reasons.join(' '), /A határ nélkül kb. 10 E/)
})

test('régi szenzorérték: nincs adat', () => {
  assert.equal(apDecide(input({ glucose: series(12, 12, 30) })).state, 'stale')
})

test('a javasolt adag mellett sem lehet a mélypont a biztonsági sáv alatt', () => {
  // A lépés a maxStep-pel korlátozva 10; közeli alsó határnál csökken, soha nem megy a sáv alá.
  const d = apDecide(input({ glucose: series(10.4, 10.4), params: { ...params, high: 9, fraction: 1, maxStep: 20, maxIob: 30 } }))
  if (d.state === 'suggest') assert.ok(Math.min(...d.curveAfter.map((c) => c[1])) >= params.low + 0.5)
})

test('egész egységes lépésköz: lefelé kerekít, és ha az aktív inzulin határáig nem fér be egy egész, nem javasol', () => {
  const whole = { ...params, minStep: 1, fraction: 0.75 }
  const a = apDecide(input({ params: whole })) // teljes 13 E, 75% = 9,75 → 9
  assert.equal(a.state, 'suggest')
  assert.equal(a.units, 9)
  // 7,5 E aktív, határ 8: 0,5 E hely van, de a legkisebb adag 1 E
  const b = apDecide(input({ glucose: series(20, 20), params: { ...whole, maxIob: 8 }, iobAt: (ts) => (ts <= NOW ? 7.5 : 0) }))
  assert.equal(b.state, 'wait')
  assert.equal(b.units, null)
  assert.match(b.reasons.join(' '), /meghaladná a beállított határt/)
})
