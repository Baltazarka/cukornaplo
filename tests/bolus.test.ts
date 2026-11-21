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
