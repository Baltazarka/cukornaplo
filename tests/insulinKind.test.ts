// Az inzulinadagok besorolása (étkezési / korrekció / bázis): minden összeg (napi, heti, riport, elemzés) erre épül.
import test from 'node:test'
import assert from 'node:assert/strict'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from '../server/utils/insulinKind.ts'

const T = 1_800_000_000

test('CH nélkül korrekció, CH-val a közelben étkezési', () => {
  assert.equal(insulinKind(T, null, []).kind, 'correction')
  assert.equal(insulinKind(T, null, [T]).kind, 'meal')
  assert.equal(insulinKind(T, null, [T]).auto, true)
})

test('az ablak pontos határai: előtte 30 percig, utána (előbólus) 60 percig a CH még étkezési', () => {
  assert.equal(MEAL_WINDOW_SEC, 30 * 60)
  assert.equal(PREBOLUS_SEC, 60 * 60)
  assert.equal(insulinKind(T, null, [T - 30 * 60]).kind, 'meal') // CH 30 perccel a bólus előtt: még étkezési
  assert.equal(insulinKind(T, null, [T - 30 * 60 - 1]).kind, 'correction')
  assert.equal(insulinKind(T, null, [T + 60 * 60]).kind, 'meal') // a CH 60 perccel a bólus után: előbólus
  assert.equal(insulinKind(T, null, [T + 60 * 60 + 1]).kind, 'correction')
})

test('a kézi jelölés (étkezési / korrekció / bázis) mindig felülírja a becslést', () => {
  assert.deepEqual(insulinKind(T, 'correction', [T]), { kind: 'correction', auto: false, noCarbs: false })
  assert.deepEqual(insulinKind(T, 'meal', []), { kind: 'meal', auto: false, noCarbs: false })
  assert.deepEqual(insulinKind(T, 'basal', [T]), { kind: 'basal', auto: false, noCarbs: false })
})

test('bázis csak a bázisnak jelölt adag: a mennyiség és a CH nem számít; az általános „bolus” jelölés becsült', () => {
  assert.equal(insulinKind(T, null, [], 52).kind, 'correction')
  assert.equal(insulinKind(T, 'bolus', [T]).kind, 'meal')
  assert.equal(insulinKind(T, 'bolus', []).kind, 'correction')
})
