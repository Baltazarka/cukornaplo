// Az elemzés tiszta számoló részei: ezekből jön a javasolt ISF, hatásidő és a felszívódási görbe.
import test from 'node:test'
import assert from 'node:assert/strict'
import { median, quantile, weightedMedian, isotonic, nadirDrop, fitAction, STEP } from '../server/utils/analysisMath.ts'
import { insulinModel } from '../shared/utils/insulins.ts'

test('medián és kvantilis', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(median([]), null)
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2)
})

test('súlyozott medián: a nagy súlyú érték nyer, pontos egyenlőségnél a két érték közepe', () => {
  assert.equal(weightedMedian([{ v: 1, w: 1 }, { v: 5, w: 3 }]), 5)
  assert.equal(weightedMedian([{ v: 1, w: 1 }, { v: 3, w: 1 }]), 2)
  assert.equal(weightedMedian([{ v: 4, w: 0 }]), null)
  assert.equal(weightedMedian([]), null)
})

test('monoton illesztés: soha nem csökken, a hiányzó pont kimarad', () => {
  assert.deepEqual(isotonic([0, 0.5, 0.4, 0.9], [1, 1, 1, 1]), [0, 0.45, 0.45, 0.9])
  assert.deepEqual(isotonic([0, null, 0.6, 0.5], [1, 1, 1, 3]), [0, null, 0.525, 0.525])
  const out = isotonic([0, 0.3, 0.2, 0.25, 0.1, 0.8], [1, 2, 1, 1, 1, 1]).filter((v): v is number => v != null)
  for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1] - 1e-12)
})

test('korrekció mélypontja: egy zajos pont nem mélyíti, a hiányzó pont kimarad', () => {
  assert.equal(nadirDrop([0, 1, 2, 2.1, 4.5, 2.0, 2.2]), 2.2) // nem a 4,5-ös kiugró pont, hanem a szomszédaival vett medián
  assert.equal(nadirDrop([0, 1, 2, 3, 3, 3, 2.5]), 3)
  assert.equal(nadirDrop([null, 1, null]), 1)
  assert.equal(nadirDrop([null, null]), 0)
  assert.equal(nadirDrop([]), 0)
})

/** `n` korrekció esési görbéje (mmol/L / E), pontosan az `isf` × (1 − IOB) alakkal, kis determinisztikus zajjal. */
function events(isf: number, peak: number, dia: number, noise: number, n: number) {
  let s = 7
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 - 0.5
  }
  const m = insulinModel(peak, dia)
  return Array.from({ length: n }, () => ({
    dose: 2 + Math.round(rnd() * 4 + 2),
    perUnit: Array.from({ length: 73 }, (_, i) => isf * (1 - m.iob(i * STEP)) + rnd() * noise),
  }))
}

test('hatásidő-illesztés: az ismert ISF-et, csúcsidőt és hatásidőt visszaadja, zajjal is', () => {
  const clean = fitAction(events(2, 75, 300, 0, 12), 300)!
  assert.ok(Math.abs(clean.isf - 2) < 0.05)
  assert.equal(clean.peak, 75)
  assert.equal(clean.dia, 300)
  const noisy = fitAction(events(3, 90, 300, 0.5, 12), 300)!
  assert.ok(Math.abs(noisy.isf - 3) < 0.15, `isf ${noisy.isf}`)
  assert.equal(noisy.peak, 90)
})

test('hatásidő-illesztés: a megengedett leghosszabb hatásidőnél nem illeszt hosszabbat', () => {
  const r = fitAction(events(2, 75, 360, 0, 12), 300)!
  assert.ok(r.dia <= 300)
  assert.equal(r.atLimit, true)
  assert.equal(r.unreliable, true)
})
