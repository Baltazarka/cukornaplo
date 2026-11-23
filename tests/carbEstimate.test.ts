// Be nem írt CH becslésének tiszta számolása.
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideCarbEstimate, MAX_GRAMS } from '../server/utils/carbEstimateCore.ts'

const base = (over = {}) => ({
  startV: 6, endV: 6, coverage: 1, hasCarbsNearby: false, insulinUsed: 0, isf: 2, perG: 0.2, ...over,
})

test('nincs emelkedés: nincs becslés', () => {
  assert.equal(decideCarbEstimate(base()), null)
})

test('az inzulinnal megmagyarázott esés: nincs becslés', () => {
  // 2 E felhasznált, ISF 2 -> -4 mmol/L várt; a tényleges pont ennyit esett.
  assert.equal(decideCarbEstimate(base({ startV: 10, endV: 6, insulinUsed: 2 })), null)
})

test('CH a közelben: nincs becslés, akkor sem, ha nagy az emelkedés', () => {
  assert.equal(decideCarbEstimate(base({ startV: 6, endV: 12, hasCarbsNearby: true })), null)
})

test('alacsony lefedettség: nincs becslés', () => {
  assert.equal(decideCarbEstimate(base({ startV: 6, endV: 12, coverage: 0.5 })), null)
})

test('inzulinnal meg nem magyarázott emelkedés: becslés, 5 g-ra kerekítve', () => {
  // 2 E felhasznált (ISF 2 -> -4 várt), de a tényleges +2: többlet 6 mmol/L, perG 0.2 -> 30 g.
  const r = decideCarbEstimate(base({ startV: 6, endV: 8, insulinUsed: 2 }))
  assert.deepEqual(r, { grams: 30 })
})

test('kis többlet (a modell pontatlansága): nincs becslés', () => {
  const r = decideCarbEstimate(base({ startV: 6, endV: 6.3 }))
  assert.equal(r, null)
})

test('nagyon nagy többlet: a becslés a maximumnál levágva', () => {
  const r = decideCarbEstimate(base({ startV: 4, endV: 22 }))
  assert.equal(r?.grams, MAX_GRAMS)
})
