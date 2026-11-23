// Az Autopilot tiszta döntési magja (nincs DB/óra-függés): server/utils/autopilot.ts decideAutopilot().
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideAutopilot, type DecideInput, type AutopilotSettings } from '../server/utils/autopilotCore.ts'

const settings: AutopilotSettings = {
  enabled: true,
  basalMicroEnabled: false,
  dailyMaxUnits: 4,
  basalMicroDailyMaxUnits: 2,
  basalMicroPercent: 40,
  cooldownAcceptMin: 30,
  cooldownDeclineMin: 60,
  expireMin: 15,
  maxIob: 3,
  minUnits: 0.5,
}

const base = (over: Partial<DecideInput> = {}): DecideInput => ({
  settings,
  hasPending: false,
  secSinceAcceptedCorrection: null,
  secSinceDeclinedCorrection: null,
  todayCorrectionUnits: 0,
  todayBasalMicroUnits: 0,
  maxBolus: 10,
  prediction: { risk: false, iob: 0, insulinNeeded: null, insulinFull: null, glucoseJumpSuspect: false },
  sustainedHigh: false,
  doseStep: 1,
  ...over,
})

test('stabil vércukor (nincs insulinNeeded) → nincs javaslat', () => {
  assert.equal(decideAutopilot(base()), null)
})

test('cél fölötti, alacsony IOB → korrekciós javaslat', () => {
  const d = decideAutopilot(base({ prediction: { risk: false, iob: 0.5, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'correction', amount: 2 })
})

test('magas IOB mellett sosem javasol, még ha lenne is insulinNeeded', () => {
  const d = decideAutopilot(base({ prediction: { risk: false, iob: 3.5, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.equal(d, null)
})

test('hipó-kockázatnál sosem javasol, a korlát mindent felülír', () => {
  const d = decideAutopilot(base({ prediction: { risk: true, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.equal(d, null)
})

test('irreális szenzor-ugrásnál sosem javasol (a korlát ezt is felülírja)', () => {
  const d = decideAutopilot(base({ prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: true } }))
  assert.equal(d, null)
})

test('a javaslat sosem nagyobb, mint a maxBolus fele', () => {
  const d = decideAutopilot(base({ maxBolus: 6, prediction: { risk: false, iob: 0, insulinNeeded: 10, insulinFull: 10, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'correction', amount: 3 })
})

test('a javaslat az aktív inzulin plafonja felé közeledve fokozatosan csökken (nem hirtelen vágja el)', () => {
  // maxIob=3, iob=2.5 → még csak 0,5 E "hely" maradt, holott a szükséglet (insulinNeeded, maxBolus-fél, napi keret) ennél több lenne.
  const d = decideAutopilot(base({ prediction: { risk: false, iob: 2.5, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'correction', amount: 0.5 })
})

test('napi max elérve → nincs több korrekciós javaslat', () => {
  const d = decideAutopilot(base({ todayCorrectionUnits: 4, prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.equal(d, null)
})

test('a korrekció sem lépheti túl a napi hátralévő keretet, még ha a szükséglet nagyobb is', () => {
  // dailyMaxUnits=4, todayCorrectionUnits=3 → csak 1 E maradt, az insulinNeeded=2 nem mehet e fölé.
  const d = decideAutopilot(base({ todayCorrectionUnits: 3, prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'correction', amount: 1 })
})

test('van még függő javaslat → nem generál újat', () => {
  const d = decideAutopilot(base({ hasPending: true, prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.equal(d, null)
})

test('elfogadott korrekció utáni cooldown alatt nincs új korrekciós javaslat', () => {
  const d = decideAutopilot(base({ secSinceAcceptedCorrection: 10 * 60, prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.equal(d, null)
})

test('elutasított korrekció utáni (hosszabb) cooldown alatt nincs új korrekciós javaslat', () => {
  const d = decideAutopilot(base({ secSinceDeclinedCorrection: 40 * 60, prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.equal(d, null)
})

test('cooldown lejárta után újra javasolhat', () => {
  const d = decideAutopilot(base({ secSinceAcceptedCorrection: 31 * 60, prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'correction', amount: 2 })
})

test('a korrekció cooldownja a mikro-kiegészítést NEM fékezi (annak nincs saját cooldownja)', () => {
  const s = { ...settings, basalMicroEnabled: true }
  const d = decideAutopilot(base({ settings: s, secSinceAcceptedCorrection: 5 * 60, sustainedHigh: true, doseStep: 0.5, prediction: { risk: false, iob: 0, insulinNeeded: null, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'basal_micro', amount: 0.5 })
})

test('mikro-bázis: kikapcsolva alapból, sustainedHigh esetén sem javasol', () => {
  const d = decideAutopilot(base({ sustainedHigh: true }))
  assert.equal(d, null)
})

test('mikro-bázis: bekapcsolva, sustainedHigh és van szükséglet → a szükséglet arányos hányada', () => {
  const s = { ...settings, basalMicroEnabled: true }
  // insulinFull=2, 40% = 0,8, a toll lépésére (0,5) lefelé kerekítve = 0,5.
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, doseStep: 0.5, prediction: { risk: false, iob: 0, insulinNeeded: null, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'basal_micro', amount: 0.5 })
})

test('mikro-bázis: nagyobb szükségletnél nagyobb javaslat, mint egy valódi pumpa SMB-je', () => {
  const s = { ...settings, basalMicroEnabled: true, basalMicroPercent: 40 }
  // insulinFull=5, 40% = 2,0 (nem éri el sem a maxBolus-negyedet (2,5), sem a napi mikro-keretet).
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, prediction: { risk: false, iob: 0, insulinNeeded: null, insulinFull: 5, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'basal_micro', amount: 2 })
})

test('mikro-bázis: a maxBolus-hoz kötött sapka szigorúbb, mint a korrekcióé', () => {
  // maxBolus=10 → korrekciónál a sapka 5 E lenne (fele), mikrónál csak 2,5 E (negyede).
  const s = { ...settings, basalMicroEnabled: true, basalMicroPercent: 50, basalMicroDailyMaxUnits: 10 }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, doseStep: 0.5, prediction: { risk: false, iob: 0, insulinNeeded: null, insulinFull: 20, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'basal_micro', amount: 2.5 })
})

test('mikro-bázis: a napi hátralévő mikro-keret fölé sosem megy, még ha a szükséglet nagyobb is', () => {
  const s = { ...settings, basalMicroEnabled: true, basalMicroDailyMaxUnits: 2 }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, doseStep: 0.5, todayBasalMicroUnits: 1.5, prediction: { risk: false, iob: 0, insulinNeeded: null, insulinFull: 20, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'basal_micro', amount: 0.5 })
})

test('mikro-bázis: nincs insulinFull (pl. éppen esik/friss bólus) → nem javasol', () => {
  const s = { ...settings, basalMicroEnabled: true }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true }))
  assert.equal(d, null)
})

test('mikro-bázis: napi max elérve → nincs több', () => {
  const s = { ...settings, basalMicroEnabled: true }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, todayBasalMicroUnits: 2, prediction: { risk: false, iob: 0, insulinNeeded: null, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.equal(d, null)
})

test('korrekció elsőbbséget élvez a mikro-bázissal szemben, ha mindkettő feltétele teljesül', () => {
  const s = { ...settings, basalMicroEnabled: true }
  const d = decideAutopilot(base({ settings: s, sustainedHigh: true, prediction: { risk: false, iob: 0, insulinNeeded: 2, insulinFull: 2, glucoseJumpSuspect: false } }))
  assert.deepEqual(d, { kind: 'correction', amount: 2 })
})
