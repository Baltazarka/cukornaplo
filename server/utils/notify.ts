// Push értesítések: hipó-veszély, szénhidrát-javaslat (alacsony vércukor előtt) és inzulinjavaslat
// (magas vércukornál). A beállítások a settings.json `notify`, az állapot (utolsó küldések) a
// `notify_state` kulcson. A háttérciklus: server/plugins/notifier.ts.
import { sendPush, listSubscriptions, type PushPayload } from './push'
import { predictGlucose, type Prediction } from './predict'
import { fmt1 } from './digest'
import { clDevice } from './carelink'
import { hoursLeftText, SENSOR_ENDING_HOURS, TRANSMITTER_LOW } from '#shared/utils/device'
import { sgText } from '#shared/utils/glucose'
import { latestGlucose } from './digest'
import { therapy, segmentAt, blendAt } from './therapy'
import { db } from './db'
import { hmInTz } from './time'
import { insulinGivenAfterMeal } from './fpuRecent'
import { targetRange } from './range'
import { RANGE_VERY_LOW } from './stats'
import { rapidDoses, iobAt } from './iob'
import { calcBolus } from '#shared/utils/bolus'

export interface NotifySettings {
  /** Hipó-veszély értesítés. */
  hypoPush: boolean
  /** „Vegyél be X g szénhidrátot” értesítés, ha alacsony vércukor várható. */
  carbsPush: boolean
  /** „Adj be X E inzulint” értesítés magas vércukornál. */
  insulinPush: boolean
  /** Előrejelzési távolság a hipóhoz, perc (15–60). */
  hypoHorizon: number
  /** Ennél kisebb inzulinjavaslatról nem szól, E. */
  insulinMin: number
  /** Ennyi percenként ismétli az értesítést, amíg a helyzet fennáll (15 / 30 / 60). */
  repeatMin: number
  /** Szenzor lejárata (12 órával előtte) és alacsony transzmittertöltés. */
  devicePush: boolean
  /** Zsíros étel után emlékeztető a zsír-fehérje plusz-javaslatra (a bóluskalkulátorból). */
  fpuPush: boolean
}

interface NotifyState {
  lastHypo?: number
  /** Az utolsó hipó-értesítéskori legrosszabb érték (most vagy a várható mélypont); a hipó elmúltával törlődik. */
  lastHypoV?: number
  lastCarbs?: number
  lastInsulin?: number
  /** A szenzor lejárata, amelyről már szóltunk (szenzoronként egyszer). */
  sensorWarnedEnd?: number
  lastBattery?: number
  lastError?: string
}

const DEFAULTS: NotifySettings = { hypoPush: true, carbsPush: true, insulinPush: false, hypoHorizon: 30, insulinMin: 1, repeatMin: 15, devicePush: true, fpuPush: true }

export function notifySettings(): NotifySettings {
  return { ...DEFAULTS, ...(setting<Partial<NotifySettings>>('notify', null) ?? {}) }
}

export function notifyState(): NotifyState {
  return setting<NotifyState>('notify_state', null) ?? {}
}

function saveState(changes: Partial<NotifyState>) {
  saveSettings({ notify_state: { ...notifyState(), ...changes } })
}

export function validateNotify(b: any): NotifySettings {
  const horizon = Number(b?.hypoHorizon)
  const min = Number(b?.insulinMin)
  return {
    hypoPush: b?.hypoPush === true,
    carbsPush: b?.carbsPush === true,
    insulinPush: b?.insulinPush === true,
    hypoHorizon: Number.isInteger(horizon) && horizon >= 15 && horizon <= 60 ? horizon : DEFAULTS.hypoHorizon,
    insulinMin: Number.isFinite(min) && min >= 0.5 && min <= 10 ? Math.round(min * 2) / 2 : DEFAULTS.insulinMin,
    repeatMin: [15, 30, 60].includes(Number(b?.repeatMin)) ? Number(b.repeatMin) : DEFAULTS.repeatMin,
    devicePush: b?.devicePush === true,
    fpuPush: b?.fpuPush === true,
  }
}

// ---- az értesítések szövegei ----

const trendNow = (p: Pick<Prediction, 'now'>) => `${sgText(p.now.v)} ${p.now.arrow}`
const SAFETY = 'Számított javaslat a terápiás beállításaid alapján; beadás előtt ellenőrizd.'

export function hypoPayload(p: Prediction, extraCarbs?: number | null): PushPayload {
  const carbs = extraCarbs ? ` Vegyél be kb. ${extraCarbs} g gyors szénhidrátot.` : ''
  return p.currentLow
    ? {
        title: `⚠️ Alacsony vércukor: ${trendNow(p)}`,
        body: `Most ${trendNow(p)} mmol/L (${p.now.time}).${carbs || ' Ellenőrizd, és ha kell, vegyél be gyors szénhidrátot.'}`,
        url: '/', tag: 'hypo',
      }
    : {
        title: `⚠️ Hipó-veszély: ${fmt1(p.nadir)} várható`,
        body: `Most ${trendNow(p)} mmol/L, ${p.nadirIn || p.horizon} percen belül kb. ${fmt1(p.nadir)} mmol/L. Aktív inzulin: ${fmt1(p.iob)} E.${carbs}`,
        url: '/', tag: 'hypo',
      }
}

export function carbsPayload(p: Pick<Prediction, 'now' | 'nadir' | 'nadirIn' | 'horizon'>, grams: number): PushPayload {
  return {
    title: `🍬 Kb. ${grams} g szénhidrát kellene`,
    body: `Most ${trendNow(p)} mmol/L, ${p.nadirIn || p.horizon} percen belül kb. ${fmt1(p.nadir)} mmol/L várható. Gyors szénhidrát javasolt.`,
    url: '/', tag: 'carbs',
  }
}

export function insulinPayload(p: Pick<Prediction, 'now' | 'eventual' | 'iob'>, units: number): PushPayload {
  return {
    title: `💉 Kb. ${units.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} E inzulin javasolt`,
    body: `Most ${trendNow(p)} mmol/L, az aktív inzulin (${fmt1(p.iob)} E) után is kb. ${fmt1(p.eventual)} mmol/L marad. ${SAFETY}`,
    url: '/', tag: 'insulin',
  }
}

export function sensorPayload(endsAt: number, hoursLeft: number): PushPayload {
  const at = new Date(endsAt * 1000).toLocaleString('hu-HU', { timeZone: process.env.APP_TZ || 'Europe/Budapest', weekday: 'long', hour: '2-digit', minute: '2-digit' })
  return {
    title: `🩹 A szenzor ${hoursLeftText(hoursLeft)} múlva lejár`,
    body: `Várható lejárat: ${at}. Készítsd elő az új szenzort, és töltsd fel a transzmittert.`,
    url: '/', tag: 'sensor',
  }
}

export function batteryPayload(pct: number): PushPayload {
  return {
    title: `🔋 A transzmitter töltöttsége ${pct}%`,
    body: 'Töltsd fel a transzmittert (legkésőbb a következő szenzorcserénél).',
    url: '/', tag: 'battery',
  }
}

/** Mintaadatok a tesztgombokhoz (nem függnek az aktuális vércukortól). */
const sampleNow = (v: number, arrow: string): Prediction['now'] => ({ ts: 0, v, time: 'most', ageMin: 0, arrow, rate: null })

export function testPayload(kind: string): PushPayload | null {
  const tagged = (x: PushPayload): PushPayload => ({ ...x, title: `[Teszt] ${x.title}`, tag: `test-${x.tag}` })
  const low = { horizon: 30, nadir: 3.1, nadirIn: 25, iob: 1.8 }
  if (kind === 'hypo') {
    return tagged(hypoPayload({
      ...low, now: sampleNow(4.4, '↘'), predicted: 3.1, currentLow: false, risk: true, low: 3.9, cob: 0, treated: false,
      eventual: 3.1, carbsNeeded: 15, insulinNeeded: null,
    }, 15))
  }
  if (kind === 'carbs') return tagged(carbsPayload({ ...low, now: sampleNow(4.4, '↘') }, 15))
  if (kind === 'insulin') return tagged(insulinPayload({ now: sampleNow(13.2, '↗'), eventual: 11.8, iob: 1.8 }, 3))
  if (kind === 'device') return tagged(sensorPayload(Math.floor(Date.now() / 1000) + 11 * 3600, 11))
  if (kind === 'fpu') return tagged(fpuPayload({ mealTs: Math.floor(Date.now() / 1000) - 90 * 60, extra: 4.5, units: 1.8, hours: 4, pct: 50 }, sampleNow(9.4, '↗'), 2))
  return null
}

// ---- ellenőrzés (percenként) ----

// ---- zsíros étel: emlékeztető a plusz-javaslatra ----

/** Egy függő emlékeztető: a bóluskalkulátorból beírt zsíros étkezés után FPU_REMIND_MIN perccel. */
export interface FpuReminder {
  mealTs: number
  /** Javasolt plusz adag, E (a beállított %-kal, 0,5 E-re lefelé kerekítve). */
  extra: number
  /** Zsír-fehérje egység. */
  units: number
  /** A zsír-fehérje hatásának hossza, óra. */
  hours: number
  /** A varsói érték hány %-a. */
  pct: number
  /** 'extra': emlékeztető a később beadandó plusz adagra; 'check': egyben adás után ellenőrzés (korai hipó). */
  mode?: 'extra' | 'check'
}
/** Ennyi perccel az étkezés után jön a plusz adag emlékeztetője (a zsír-fehérje hatása kb. ekkor kezd látszani). */
export const FPU_REMIND_MIN = 90
/** Egyben adásnál ennyi perc múlva jön az ellenőrzés (ekkor hat legerősebben az inzulin, a zsír még alig). */
export const FPU_CHECK_MIN = 75
const remindMin = (r: FpuReminder) => (r.mode === 'check' ? FPU_CHECK_MIN : FPU_REMIND_MIN)
const FPU_KEY = 'fpu_reminders'

/**
 * `correction`: a bóluskalkulátor szerinti korrekció most (aktív inzulin levonva, 0,5 E-re lefelé), ha ismert. A kettő
 * átfed (a mostani emelkedés egy része már a zsír-fehérje hatása), ezért nem összeadandó.
 */
export function fpuPayload(r: FpuReminder, now: { v: number; arrow: string }, correction: number | null = null): PushPayload {
  const n = (v: number) => v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
  const corr = correction == null ? ''
    : correction >= 0.5
      ? ` Korrekció a kalkulátor szerint kb. ${n(correction)} E: a kettő átfed, ne add össze, a nagyobbat vedd figyelembe.`
      : ' Korrekció most nem kell (az aktív inzulin levonva).'
  return {
    title: `🧀 Zsíros étel ${hmInTz(r.mealTs)}-kor: most ${sgText(now.v)} ${now.arrow}`,
    body: `A zsír-fehérje (kb. ${n(r.units)} egység) miatt kb. +${n(r.extra)} E jöhet szóba (a varsói érték ${r.pct}%-a), ha a cukor emelkedik; a hatása kb. ${r.hours} óráig tart.${corr} ${SAFETY}`,
    url: '/', tag: 'fpu',
  }
}

/** Egyben adott zsír-fehérje adag után: ellenőrzés a korai hipó miatt (az inzulin már erősen hat, a zsír még alig). */
export function fpuCheckPayload(r: FpuReminder, now: { v: number; arrow: string; rate: number | null }, low: number): PushPayload {
  const falling = (now.rate ?? 0) <= -0.03
  const warn = now.v < low ? ' Alacsony: kezeld gyors szénhidráttal.'
    : falling && now.v < low + 2 ? ' Esik, és közel a céltartomány aljához: figyelj, legyen kéznél gyors CH.'
      : falling ? ' Esik: nézd meg újra 20–30 perc múlva.'
        : ''
  return {
    title: `🧀 Zsíros étel ${hmInTz(r.mealTs)}-kor: most ${sgText(now.v)} ${now.arrow}`,
    body: `Az evéskor egyben beadott plusz adag (kb. ${r.extra.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} E) most hat a legerősebben, a zsír-fehérje hatása még csak most kezdődik.${warn} A zsír hatása kb. ${r.hours} óráig tart.`,
    url: '/', tag: 'fpu',
  }
}

/** A bóluskalkulátor szerinti korrekció most (CH nélkül, aktív inzulin levonva, a napszakok közti átmenettel, mint a
 * kalkulátor alapbeállítása), a push szövegéhez. */
function correctionNow(nowTs: number, bg: number): number | null {
  const t = therapy()
  if (!t) return null
  const seg = segmentAt(t, nowTs)
  const carbTs = (db().prepare("SELECT ts FROM entries WHERE type = 'carbs' AND ts >= ?").all(nowTs - 12 * 3600) as any[]).map((r) => Number(r.ts))
  const iob = iobAt(rapidDoses(t, nowTs, nowTs + 1, carbTs), nowTs)
  const b = blendAt(t, nowTs)
  return calcBolus({ carbs: 0, bg, target: seg.target, isf: b?.isf ?? seg.isf, icr: b?.icr ?? seg.icr, iob, maxBolus: t.maxBolus }).dose
}

/** Új emlékeztető felvétele (a régieket, egy napnál idősebbeket eldobjuk; ugyanarra az étkezésre csak egy). */
export function addFpuReminder(r: FpuReminder): void {
  const now = Math.floor(Date.now() / 1000)
  const list = (setting<FpuReminder[]>(FPU_KEY, null) ?? []).filter((x) => now - x.mealTs < 86400 && x.mealTs !== r.mealTs)
  saveSettings({ [FPU_KEY]: [...list, r] })
}

/**
 * Esedékes emlékeztetők: az étkezés után FPU_REMIND_MIN perccel, ha az étkezés még a naplóban van (zsírosként), és a
 * vércukor nincs a célérték alatt (alacsony cukornál nem javaslunk plusz inzulint). Mindegyik legfeljebb egyszer megy ki.
 * Ha a szenzoradat nem friss, vagy a cukor még a cél alatt van, az emlékeztető a listában marad, és még egy órán át
 * később is kimehet; csak kiküldéskor, túl régi vagy törölt étkezésnél, illetve már beadott plusz adagnál törlődik.
 */
export async function checkFpuReminders(nowTs = Math.floor(Date.now() / 1000)): Promise<void> {
  const list = setting<FpuReminder[]>(FPU_KEY, null) ?? []
  if (!list.length) return
  const due = list.filter((r) => nowTs >= r.mealTs + remindMin(r) * 60)
  if (!due.length) return
  const s = notifySettings()
  const t = therapy()
  const enabled = s.fpuPush && !!t && listSubscriptions().length > 0
  const drop = new Set<FpuReminder>()
  const send: { payload: PushPayload; urgency: 'high' | 'normal' }[] = []
  for (const r of due) {
    // Túl régi (pl. a szerver állt), vagy ki van kapcsolva: már nem aktuális.
    if (!enabled || nowTs - r.mealTs > (remindMin(r) + 60) * 60) { drop.add(r); continue }
    const still = db().prepare("SELECT 1 FROM entries WHERE type = 'carbs' AND subtype = 'fatty' AND ts BETWEEN ? AND ? LIMIT 1").get(r.mealTs - 120, r.mealTs + 120)
    if (!still) { drop.add(r); continue }
    const now = latestGlucose(nowTs)
    // Nem friss a szenzoradat: később újra próbáljuk.
    if (!now || now.ageMin > 20) continue
    // Egyben adás után: ellenőrzés mindenképp (alacsony cukornál is), a mostani értékkel és trenddel.
    if (r.mode === 'check') {
      drop.add(r)
      send.push({ payload: fpuCheckPayload(r, now, targetRange().low), urgency: now.v < targetRange().low ? 'high' : 'normal' })
      continue
    }
    // Ha ennél az étkezésnél (30 perc múlva vagy később) már beadtál inzulint (a pluszt vagy korrekciót), nem emlékeztetünk.
    if (insulinGivenAfterMeal(r.mealTs, nowTs) >= 0.5) { drop.add(r); continue }
    // A cél alatt még várunk (később emelkedhet).
    if (now.v < segmentAt(t!, nowTs).target) continue
    drop.add(r)
    send.push({ payload: fpuPayload(r, now, correctionNow(nowTs, now.v)), urgency: 'normal' })
  }
  if (drop.size) saveSettings({ [FPU_KEY]: list.filter((r) => !drop.has(r)) })
  for (const x of send) await sendPush(x.payload, { urgency: x.urgency, ttl: 60 * 60 }).catch(() => null)
}

/** Szenzor lejárata (szenzoronként egyszer, 12 órával előtte) és alacsony transzmittertöltés (12 óránként). */
export async function checkDeviceAlerts(nowTs = Math.floor(Date.now() / 1000)): Promise<void> {
  const s = notifySettings()
  if (!s.devicePush || !listSubscriptions().length) return
  const d = clDevice(nowTs)
  if (!d) return
  const st = notifyState()
  const send = (payload: PushPayload) => sendPush(payload, { urgency: 'normal', ttl: 6 * 3600 }).catch(() => null)
  if (d.sensorEndsAt && d.sensorEndsAt > nowTs && d.sensorEndsAt - nowTs <= SENSOR_ENDING_HOURS * 3600
    // A lejárat lekérésenként pár órát ingadozhat; új szenzornál napokkal később van.
    && Math.abs(d.sensorEndsAt - (st.sensorWarnedEnd ?? 0)) > 24 * 3600) {
    saveState({ sensorWarnedEnd: d.sensorEndsAt })
    await send(sensorPayload(d.sensorEndsAt, (d.sensorEndsAt - nowTs) / 3600))
  }
  if (d.transmitterBattery != null && d.transmitterBattery <= TRANSMITTER_LOW && nowTs - (st.lastBattery ?? 0) >= 12 * 3600) {
    saveState({ lastBattery: nowTs })
    await send(batteryPayload(d.transmitterBattery))
  }
}

export async function checkAlerts(nowTs = Math.floor(Date.now() / 1000)): Promise<void> {
  const s = notifySettings()
  if (!(s.hypoPush || s.carbsPush || s.insulinPush) || !listSubscriptions().length) return
  const st = notifyState()
  // Amíg a helyzet fennáll, az értesítés a beállított időközönként (alapból negyedóránként) ismétlődik.
  const gap = s.repeatMin * 60 - 30 // a percenkénti ellenőrzés időzítési ingadozására
  const wantHypo = s.hypoPush && nowTs - (st.lastHypo ?? 0) >= gap
  const wantCarbs = s.carbsPush && nowTs - (st.lastCarbs ?? 0) >= gap
  // Az inzulinjavaslat legfeljebb óránként ismétlődik (a beadott adag hatásához idő kell).
  const wantInsulin = s.insulinPush && nowTs - (st.lastInsulin ?? 0) >= Math.max(gap, 60 * 60 - 30)
  if (!wantHypo && !wantCarbs && !wantInsulin) return

  const p = predictGlucose(s.hypoHorizon, nowTs)
  if (!p) return
  const errors: string[] = []
  const send = async (payload: PushPayload, urgency: 'high' | 'normal') => {
    const r = await sendPush(payload, { urgency, ttl: 15 * 60 }).catch((e: any) => ({ sent: 0, failed: 1, lastError: String(e?.message ?? e) }))
    if (!r.sent && r.lastError) errors.push(r.lastError)
  }

  // Ugyanarra a hipóra az ismétlés csak akkor jön az időköz után, ha romlott (≥ 0,3-del lejjebb, vagy 3,0 alatt);
  // változatlan helyzetben ritkábban (az időköz kétszerese, legalább 30 perc).
  const worst = p.risk ? Math.min(p.now.v, p.nadir) : null
  const prevV = st.lastHypoV
  if (worst == null && prevV != null) saveState({ lastHypoV: undefined })
  const worse = worst != null && (prevV == null || worst <= prevV - 0.3 || p.now.v < RANGE_VERY_LOW)
  const slowGap = Math.max(2 * s.repeatMin, 30) * 60 - 30
  const repeatOk = (last?: number) => worse || nowTs - (last ?? 0) >= slowGap

  if (p.risk && ((wantHypo && repeatOk(st.lastHypo)) || (wantCarbs && repeatOk(st.lastCarbs)))) {
    // Ha a hipó- és a szénhidrát-értesítés is be van kapcsolva, egy közös értesítés megy (a szénhidrátmennyiséggel).
    if (wantHypo) {
      saveState({ lastHypo: nowTs, lastHypoV: worst!, ...(wantCarbs ? { lastCarbs: nowTs } : {}) })
      await send(hypoPayload(p, wantCarbs ? p.carbsNeeded : null), 'high')
    } else if (p.carbsNeeded) {
      saveState({ lastCarbs: nowTs, lastHypoV: worst! })
      await send(carbsPayload(p, p.carbsNeeded), 'high')
    }
  } else if (!p.risk && wantInsulin && p.insulinNeeded && p.insulinNeeded >= s.insulinMin) {
    saveState({ lastInsulin: nowTs })
    await send(insulinPayload(p, p.insulinNeeded), 'normal')
  }
  if (errors.length) saveState({ lastError: `Push: ${errors.join('; ')}` })
  else if (notifyState().lastError) saveState({ lastError: undefined })
}
