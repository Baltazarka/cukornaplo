// Melyik napon melyik műszak, és ebből melyik terápiás profil (ISF, CH-arány) érvényes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduledShift, shiftOf, profileFor, mondayOf } from '../shared/utils/shift.ts'

// A valódi beosztás: 2026-10-25 (vasárnap) a délelőttös hét, hetente váltakozik, hétvége szabad.
const sched = { enabled: true, anchor: '2026-10-25', anchorShift: 'morning' as const, weekendFree: true, overrides: {} }

test('a hét hétfője', () => {
  assert.equal(mondayOf('2026-10-25'), '2026-10-19') // vasárnap az előző hétfő hetéhez tartozik
  assert.equal(mondayOf('2026-10-26'), '2026-10-26')
  assert.equal(mondayOf('2026-11-01'), '2026-10-26')
})

test('hetente váltakozik: hétfő 10-19 délelőttös, 10-26 délutános, 11-02 délelőttös, 11-09 délutános', () => {
  assert.equal(scheduledShift(sched, '2026-10-19'), 'morning')
  assert.equal(scheduledShift(sched, '2026-10-23'), 'morning')
  assert.equal(scheduledShift(sched, '2026-10-26'), 'afternoon')
  assert.equal(scheduledShift(sched, '2026-10-30'), 'afternoon')
  assert.equal(scheduledShift(sched, '2026-11-02'), 'morning')
  assert.equal(scheduledShift(sched, '2026-11-09'), 'afternoon')
  // a beosztás előtti hetek is ugyanígy váltakoznak
  assert.equal(scheduledShift(sched, '2026-10-12'), 'afternoon')
})

test('hétvége szabadnap (ha így van beállítva), különben a hét műszakja', () => {
  assert.equal(scheduledShift(sched, '2026-10-24'), 'free') // szombat
  assert.equal(scheduledShift(sched, '2026-10-25'), 'free') // vasárnap
  assert.equal(scheduledShift({ ...sched, weekendFree: false }, '2026-10-24'), 'morning')
})

test('kézi átállítás elsőbbséget élvez; kikapcsolt vagy hiányzó beosztásnál nincs műszak', () => {
  assert.equal(shiftOf({ ...sched, overrides: { '2026-10-19': 'free' as const } }, '2026-10-19'), 'free')
  assert.equal(shiftOf({ ...sched, enabled: false }, '2026-10-19'), null)
  assert.equal(shiftOf(null, '2026-10-19'), null)
})

test('terápiás profil: délutános héten az alt, szabadnapon a beállított, különben az alap', () => {
  const t = { altEnabled: true, altSegments: [{ start: '07:00', target: 5.5, isf: 0.5, icr: 2 }], freeProfile: 'base' as const }
  assert.equal(profileFor(t, 'afternoon'), 'alt')
  assert.equal(profileFor(t, 'morning'), 'base')
  assert.equal(profileFor(t, null), 'base')
  assert.equal(profileFor(t, 'free'), 'base')
  assert.equal(profileFor({ ...t, freeProfile: 'alt' }, 'free'), 'alt')
  assert.equal(profileFor({ ...t, altEnabled: false }, 'afternoon'), 'base')
  assert.equal(profileFor({ ...t, altSegments: [] }, 'afternoon'), 'base')
})
