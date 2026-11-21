// A gyors hatású inzulin hatásgörbéje (az aktív inzulin számolás alapja).
import test from 'node:test'
import assert from 'node:assert/strict'
import { insulinModel } from '../shared/utils/insulins.ts'

test('az aktív inzulin aránya 1-ről 0-ra csökken, soha nem nő', () => {
  const m = insulinModel(75, 300)
  assert.equal(m.iob(0), 1)
  assert.equal(m.iob(300), 0)
  let prev = 1
  for (let t = 5; t <= 300; t += 5) {
    const v = m.iob(t)
    assert.ok(v <= prev + 1e-9 && v >= 0, `t=${t}: ${v} > ${prev}`)
    prev = v
  }
})

test('a hatás görbe alatti területe 1 (az egész adag hat), a csúcs a megadott perc körül', () => {
  const m = insulinModel(75, 300)
  let sum = 0
  let peakT = 0
  let peak = 0
  for (let t = 0; t < 300; t++) {
    const a = m.activity(t + 0.5)
    sum += a
    if (a > peak) { peak = a; peakT = t }
  }
  assert.ok(Math.abs(sum - 1) < 0.01, `terület ${sum}`)
  assert.ok(Math.abs(peakT - 75) <= 3, `csúcs ${peakT}`)
})

test('rövid hatásidőnél a csúcs a hatásidő 40%-ára szűkül', () => {
  const m = insulinModel(75, 120)
  assert.equal(m.clamped, true)
  assert.equal(m.peak, 48)
})
