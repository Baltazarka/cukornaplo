// Push értesítések: hipó-veszély, szénhidrát-javaslat (alacsony vércukor előtt) és inzulinjavaslat
// (magas vércukornál). A beállítások a settings.json `notify`, az állapot (utolsó küldések) a
// `notify_state` kulcson. A háttérciklus: server/plugins/notifier.ts.
import { sendPush, listSubscriptions, type PushPayload } from './push'
import { predictGlucose, type Prediction } from './predict'
import { fmt1 } from './digest'
import { clDevice } from './carelink'
import { hoursLeftText, SENSOR_ENDING_HOURS, TRANSMITTER_LOW } from '#shared/utils/device'
import { sgText } from '#shared/utils/glucose'

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
}

interface NotifyState {
  lastHypo?: number
  lastCarbs?: number
  lastInsulin?: number
  /** A szenzor lejárata, amelyről már szóltunk (szenzoronként egyszer). */
  sensorWarnedEnd?: number
  lastBattery?: number
  lastError?: string
}

const DEFAULTS: NotifySettings = { hypoPush: true, carbsPush: true, insulinPush: false, hypoHorizon: 30, insulinMin: 1, repeatMin: 15, devicePush: true }

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
  return null
}

// ---- ellenőrzés (percenként) ----

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

  if (p.risk && (wantHypo || wantCarbs)) {
    // Ha a hipó- és a szénhidrát-értesítés is be van kapcsolva, egy közös értesítés megy (a szénhidrátmennyiséggel).
    if (wantHypo) {
      saveState({ lastHypo: nowTs, ...(wantCarbs ? { lastCarbs: nowTs } : {}) })
      await send(hypoPayload(p, wantCarbs ? p.carbsNeeded : null), 'high')
    } else if (p.carbsNeeded) {
      saveState({ lastCarbs: nowTs })
      await send(carbsPayload(p, p.carbsNeeded), 'high')
    }
  } else if (wantInsulin && p.insulinNeeded && p.insulinNeeded >= s.insulinMin) {
    saveState({ lastInsulin: nowTs })
    await send(insulinPayload(p, p.insulinNeeded), 'normal')
  }
  if (errors.length) saveState({ lastError: `Push: ${errors.join('; ')}` })
  else if (notifyState().lastError) saveState({ lastError: undefined })
}
