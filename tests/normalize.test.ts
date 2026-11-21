// A telefonról / fájlból jövő sorok értelmezése: egy rossz dátum vagy tizedes a naplóba rossz adagot írna.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTextLines, parseDate } from '../server/utils/normalize.ts'

// Budapest: 2026. október 7-én nyári idő (UTC+2).
const T = Date.UTC(2026, 9, 7, 6, 15) / 1000

test('magyar Parancsok-dátum, tizedesvessző, különféle elválasztók', () => {
  const r = parseTextLines('inzulin;2026. 10. 07. 8:15;5,5\ncarbs\t2026. okt. 7. 8:15:30\t45\nch | 2026-10-07 08:15 | 20')
  assert.deepEqual(r.errors, [])
  assert.equal(r.rows.length, 3)
  assert.deepEqual(r.rows.map((x) => [x.type, x.ts, x.value]), [
    ['insulin', T, 5.5],
    ['carbs', T + 30, 45],
    ['carbs', T, 20],
  ])
})

test('vércukor: mg/dL egység nélkül is felismerve (>35), mmol/L marad', () => {
  const r = parseTextLines('glucose;2026-10-07 08:15;180\nglucose;2026-10-07 08:20;7,2;mmol/L')
  assert.deepEqual(r.rows.map((x) => x.value), [10, 7.2])
})

test('hibás sorok: hibaüzenet, a többi sor átmegy', () => {
  const r = parseTextLines('# megjegyzés\n\nvalami;2026-10-07 08:15;5\ninzulin;nem dátum;5\ninzulin;2026-10-07 08:15;abc\ninzulin;2026-10-07 08:15;500\ninzulin;2026-10-07 08:15\ninzulin;2026-10-07 08:15;4')
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].value, 4)
  assert.equal(r.errors.length, 5)
})

test('nem létező naptári nap nem csúszik át a következő hónapra', () => {
  assert.equal(parseDate('2026-02-31 10:00'), null)
  assert.equal(parseDate('2026. 02. 31. 10:00'), null)
})

test('szám: tizedesvessző és pont, mindkét elválasztó, vezető tizedespont', async () => {
  const { parseNumber } = await import('../server/utils/normalize.ts')
  assert.equal(parseNumber('5,6'), 5.6)
  assert.equal(parseNumber('5.6'), 5.6)
  assert.equal(parseNumber('1.234,5'), 1234.5)
  assert.equal(parseNumber('1,234.5'), 1234.5)
  assert.equal(parseNumber('.5'), 0.5)
  assert.equal(parseNumber(',5'), 0.5)
  assert.equal(parseNumber('180 mg/dL'), 180)
  assert.equal(parseNumber('5,5.'), 5.5)
  assert.equal(parseNumber('-3,2'), -3.2)
  assert.equal(parseNumber('abc'), null)
})

test('dátum: érvénytelen másodperc, időzóna-eltolás és nem létező nap (zónával is) elutasítva', () => {
  assert.equal(parseDate('2026-10-07 08:15:75'), null)
  assert.equal(parseDate('2026. 10. 07. 8:15:99'), null)
  assert.equal(parseDate('2026-10-07 08:15:00 +9999'), null)
  assert.equal(parseDate('2026-10-07 08:15:00 +0260'), null)
  assert.equal(parseDate('2026-02-31T08:15:00Z'), null)
  assert.notEqual(parseDate('2026-10-07 08:15:00 +0200'), null)
  assert.notEqual(parseDate('2026-10-07T08:15:00Z'), null)
})
