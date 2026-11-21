// A CareLink válasz értelmezése. Az időzóna-javítás miatt már kétszer / eltolva került be egy nap görbéje (2026-10-22).
import test from 'node:test'
import assert from 'node:assert/strict'
import { clTimeShift, clExtractGlucose, clParseTime } from '../server/utils/carelinkParse.ts'

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0) / 1000 // 2026-11-18 13:00 Budapesten (UTC+1)
// A készülék faliórája (zóna nélkül) `deltaSec`-kel jár a szerveridő mögött.
const pd = (deltaSec: number, serverAgoSec = 0) => ({
  lastMedicalDeviceDataUpdateServerTime: (NOW - serverAgoSec) * 1000,
  medicalDeviceTimeAsString: new Date((NOW - serverAgoSec - deltaSec + 3600) * 1000).toISOString().slice(0, 19).replace('T', ' '),
})

test('pontosan egész órás eltérés friss feltöltésnél: eltol', () => {
  assert.equal(clTimeShift(pd(3600), NOW), 3600)
  assert.equal(clTimeShift(pd(-3600), NOW), -3600)
})

test('nincs eltérés, vagy nem egész órás (szenzorkimaradás): nem tol', () => {
  assert.equal(clTimeShift(pd(0), NOW), 0)
  assert.equal(clTimeShift(pd(45 * 60), NOW), 0)
})

test('régi (20 percnél öregebb) szerveridő: nem tol, akkor sem, ha egész óra', () => {
  assert.equal(clTimeShift(pd(3600, 30 * 60), NOW), 0)
})

test('hiányzó szerveridő: nem tol', () => {
  assert.equal(clTimeShift({ medicalDeviceTimeAsString: '2026-11-18 12:00:00' }, NOW), 0)
})

test('időpont értelmezése: zóna nélkül Budapest, zónával az megadott, szám másodperc vagy ezredmásodperc', () => {
  assert.equal(clParseTime('2026-11-18T13:00:00'), NOW)
  assert.equal(clParseTime('2026-11-18T12:00:00Z'), NOW)
  assert.equal(clParseTime(NOW * 1000), NOW)
  assert.equal(clParseTime(NOW), NOW)
  assert.equal(clParseTime(''), null)
})

test('glükóz sorok: mg/dL → mmol/L, érvénytelen és jövőbeli kimarad', () => {
  const now = Math.floor(Date.now() / 1000)
  const iso = (t: number) => new Date(t * 1000).toISOString()
  const rows = clExtractGlucose({ patientData: { sgs: [
    { sg: 180, datetime: iso(now - 600) },
    { sg: 0, datetime: iso(now - 300) },
    { sg: 100, datetime: iso(now + 7200) },
    { sg: 'x', datetime: iso(now - 900) },
  ] } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, 10)
  assert.equal(rows[0].source, 'CareLink')
})
