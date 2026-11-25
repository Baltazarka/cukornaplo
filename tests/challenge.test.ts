// A „Kihívás” kártya tiszta döntési magja: server/utils/challengeCore.ts challengeState().
import test from 'node:test'
import assert from 'node:assert/strict'
import { challengeState, type ChInput } from '../server/utils/challengeCore.ts'

const H = 3600
const T0 = 1_000_000
const base = (over: Partial<ChInput> = {}): ChInput => ({
  now: T0 + 3600,
  carbs: [],
  doses: [],
  noteTs: [],
  diaMin: () => 240,
  iobBefore: () => 0,
  iobNow: 0,
  absorbMin: () => 0,
  ...over,
})

test('nincs semmi → tiszta kiindulás', () => {
  assert.deepEqual(challengeState(base()), { kind: 'clear' })
})

test('tiszta előzményű korrekció fut a hatásidő végéig', () => {
  const s = challengeState(base({ now: T0 + H, doses: [{ ts: T0, v: 2, kind: 'correction' }], iobNow: 1.5 }))
  assert.equal(s.kind, 'correction')
  assert.ok(s.kind === 'correction')
  assert.equal(s.phase, 'running')
  assert.equal(s.until, T0 + 4 * H)
})

test('a korrekció előtti bólus (maradék IOB) → nem mér, foglalt', () => {
  const s = challengeState(base({ now: T0 + H, doses: [{ ts: T0, v: 2, kind: 'correction' }], iobBefore: () => 1, iobNow: 2 }))
  assert.equal(s.kind, 'busy')
})

test('korrekció után 1 órával evés → megszakadt, 3 óra előtt nem számít', () => {
  const s = challengeState(base({ now: T0 + 2 * H, doses: [{ ts: T0, v: 2, kind: 'correction' }], carbs: [{ ts: T0 + H, v: 20, fatty: false, fast: false }] }))
  // az étkezés előzménye nem tiszta (1 órán belül bólus volt), ezért a megszakadt korrekció látszik
  assert.ok(s.kind === 'correction' && s.phase === 'broken')
})

test('korrekció 3 óra után megszakítva rövidítve még számít (done); az új étkezés fut', () => {
  const carbs = [{ ts: T0 + 3.2 * H, v: 20, fatty: false, fast: false }]
  const doses = [{ ts: T0, v: 2, kind: 'correction' as const }]
  // az új, 3 órával későbbi étkezés előzménye (a korrekció még hat) nem tiszta, ezért a korrekció záródik le rövidítve
  const s = challengeState(base({ now: T0 + 3.5 * H, doses, carbs, absorbMin: () => 0, iobBefore: () => 0 }))
  assert.ok(s.kind === 'meal' && s.phase === 'running')
  const c = challengeState(base({ now: T0 + 3.5 * H, doses, carbs, noteTs: [T0 + 3.1 * H] }))
  assert.ok(c.kind === 'correction' && c.phase === 'done' && c.until === T0 + 3.1 * H)
})

test('tiszta étkezés fut 4 óráig', () => {
  const s = challengeState(base({ now: T0 + H, carbs: [{ ts: T0, v: 40, fatty: false, fast: false }], doses: [{ ts: T0, v: 4, kind: 'meal' }], iobNow: 3 }))
  assert.ok(s.kind === 'meal' && s.phase === 'running' && s.until === T0 + 4 * H)
})

test('étkezés után korrekció → az étkezés megszakadt (3 óra előtt)', () => {
  const s = challengeState(base({
    now: T0 + 2 * H,
    carbs: [{ ts: T0, v: 40, fatty: false, fast: false }],
    doses: [{ ts: T0, v: 4, kind: 'meal' }, { ts: T0 + 1.5 * H, v: 1, kind: 'correction' }],
  }))
  assert.ok(s.kind === 'meal' && s.phase === 'broken')
})

test('aktív inzulin vagy felszívódó CH, de nincs tiszta mérés → foglalt', () => {
  const s = challengeState(base({ now: T0 + 6 * H, iobNow: 0.8 }))
  assert.equal(s.kind, 'busy')
})

test('régi lezárt mérés (2 óránál régebben ért véget) már nem látszik', () => {
  const s = challengeState(base({ now: T0 + 8 * H, doses: [{ ts: T0, v: 2, kind: 'correction' }] }))
  assert.deepEqual(s, { kind: 'clear' })
})
