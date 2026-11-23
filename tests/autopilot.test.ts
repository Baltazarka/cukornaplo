// Az Autopilot tiszta döntési magja (nincs DB/óra-függés): server/utils/autopilot.ts decideAutopilot().
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideAutopilot, type DecideInput, type AutopilotSettings } from '../server/utils/autopilotCore.ts'

const settings: AutopilotSettings = {
  enabled: true,
  basalMicroEnabled: false,
  dailyMaxUnits: 4,
  basalMicroDailyMaxUnits: 2,
  cooldownAcceptMin: 30,
  cooldownDeclineMin: 60,
  expireMin: 15,
  maxIob: 3,
  minUnits: 0.5,
}

const base = (over: Partial<DecideInput> = {}): DecideInput => ({
  settings,
  hasPending: false,
  secSinceAccepted: null,
  secSinceDeclined: null,
  todayCorrectionUnits: 0,
  todayBasalMicroUnits: 0,
  maxBolus: 10,
  prediction: { risk: false, iob: 0, insulinNeeded: null },
  sustainedHigh: false,
  doseStep: 1,
  ...over,
})

test('stabil vércukor (nincs insulinNeeded) → nincs javaslat', () => {
  assert.equal(decideAutopilot(base()), null)
})

test('cél fölötti, alacsony IOB → korrekciós javaslat', () => {
  const d = decideAutopilot(base({ prediction: { risk: false, iob: 0.5, insulinNeeded: 2 } }))
  assert.deepEqual(d, { kind: 'correction', amount: 2 })
})

test('magas IOB mellett sosem javasol, még ha lenne is insulinNeeded', () => {
  const d = decideAutopilot(base({ prediction: { risk: false, iob: 3.5, insulinNeeded: 2 } }))
  assert.equal(d, null)
})

test('hipó-kockázatnál sosem javasol, a korlát mindent felülír', () => {
  const d = decideAutopilot(base({ prediction: { risk: true, iob: 0, insulinNeeded: 2 } }))
  assert.equal(d, null)
})

test('a javaslat sosem nagyobb, mint a maxBolus fele', () => {
  const d = decideAutopilot(base({ maxBolus: 6, prediction: { risk: false, iob: 0, insulinNeeded: 10 } }))
  assert.deepEqual(d, { kind: 'correction', amount: 3 })
})

test('napi max elérve → nincs több korrekciós javaslat', () => {
  const d = decideAutopilot(base({ todayCorrectionUnits: 4, prediction: { risk: false, iob: 0, insulinNeeded: 2 } }))
  assert.equal(d, null)
})

test('van még függő javaslat → nem generál újat', () => {
  const d = decideAutopilot(base({ hasPending: true, prediction: { risk: false, iob: 0, insulinNeeded: 2 } }))
  assert.equal(d, null)
})

test('elfogadás utáni cooldown alatt nincs új javaslat', () => {
  const d = decideAutopilot(base({ secSinceAccepted: 10 * 60, prediction: { risk: false, iob: 0, insulinNeeded: 2 } }))
  assert.equal(d, null)
})

test('elutasítás utáni (hosszabb) cooldown alatt nincs új javaslat', () => {
  const d = decideAutopilot(base({ secSinceDeclined: 40 * 60, prediction: { risk: false, iob: 0, insulinNeeded: 2 } }))
  assert.equal(d, null)
})

test('cooldown lejárta után újra javasolhat', () => {
  const d = decideAutopilot(base({ secSinceAccepted: 31 * 60, prediction: { risk: false, iob: 0, insulinNeeded: 2 } }))
  assert.deepEqual(d, { kind: 'correction', amount: 2 })
})

test('mikro-bázis: kikapcsolva alapból, sustainedHigh esetén sem javasol', () => {
  const d = decideAutopilot(base({ sustainedHigh: true }))
  assert.equal(d, null)
})

test('mikro-bázis: bekapcsolva és sustainedHigh → 1 toll-lépésnyi javaslat', () => {
  const s = { ...settings, basalMicroEnabled: true }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, doseStep: 0.5 }))
  assert.deepEqual(d, { kind: 'basal_micro', amount: 0.5 })
})

test('mikro-bázis: napi max elérve → nincs több', () => {
  const s = { ...settings, basalMicroEnabled: true }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, todayBasalMicroUnits: 2 }))
  assert.equal(d, null)
})

test('korrekció elsőbbséget élvez a mikro-bázissal szemben, ha mindkettő feltétele teljesül', () => {
  const s = { ...settings, basalMicroEnabled: true }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, prediction: { risk: false, iob: 0, insulinNeeded: 2 } }))
  assert.deepEqual(d, { kind: 'correction', amount: 2 })
})
