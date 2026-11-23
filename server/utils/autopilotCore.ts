// Az Autopilot tiszta döntési magja: nincs DB-, óra- vagy hálózat-függés, csak a bemenetből számol.
// Ezt teszteli a tests/autopilot.test.ts (node --test, Nitro auto-import nélkül, ezért ez a fájl import-mentes,
// a predictCore.ts mintájára).

export type SuggestionKind = 'correction' | 'basal_micro'
export type SuggestionStatus = 'pending' | 'accepted' | 'declined' | 'expired'

export interface AutopilotSettings {
  enabled: boolean
  /** "Temp bázis"-szerű, csak pozitív irányú mikro-kiegészítés (külön, alapból kikapcsolt opt-in). */
  basalMicroEnabled: boolean
  /** Napi max, amit a korrekciós javaslatokban az Autopilot elfogadtathat, E. */
  dailyMaxUnits: number
  /** Napi max a mikro-kiegészítésben, E. */
  basalMicroDailyMaxUnits: number
  /** Egy mikro-javaslat ennyi százaléka a teljes (nem halvott) szükségletnek, mint egy valódi pumpa SMB-je (10-50). */
  basalMicroPercent: number
  /** Elfogadott korrekció után ennyi percig nem javasol újat (perc). */
  cooldownAcceptMin: number
  /** Elutasított javaslat után ennyi percig nem kérdez újra (perc). */
  cooldownDeclineMin: number
  /** Ennyi perc után lejár egy nyugtázatlan javaslat. */
  expireMin: number
  /** E fölötti aktív inzulinnál biztonsági okból nem javasol. */
  maxIob: number
  /** Ennél kisebb javaslatról nem szól. */
  minUnits: number
}

/** Kódba égetett, a felhasználói beállítás által nem túlléphető biztonsági korlátok. */
export const HARD = {
  minCooldownAcceptMin: 15,
  minCooldownDeclineMin: 30,
  minBasalMicroPercent: 10,
  maxBasalMicroPercent: 50,
  maxMaxIob: 5,
  minExpireMin: 5,
  maxExpireMin: 30,
  /** Ennyi egymást követő lejárt javaslat után a motor magát kikapcsolja. */
  autoDisableAfterExpired: 3,
  /** Egyetlen korrekciós javaslat sosem lehet nagyobb, mint a beállított maxBolus ekkora hányada. */
  maxBolusFraction: 0.5,
  /** Egyetlen mikro-javaslat ennél is szigorúbb (kisebb) hányada a maxBolus-nak — ez egy véglegesen beadott,
   *  kis lépés akar lenni, nem egy nagy, ritka korrekció. */
  microMaxBolusFraction: 0.25,
}

export const DEFAULTS: AutopilotSettings = {
  enabled: false,
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

const clamp = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def
}
const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step

export function validateAutopilot(b: any): AutopilotSettings {
  return {
    enabled: b?.enabled === true,
    basalMicroEnabled: b?.basalMicroEnabled === true,
    dailyMaxUnits: clamp(b?.dailyMaxUnits, 0.5, 50, DEFAULTS.dailyMaxUnits),
    basalMicroDailyMaxUnits: clamp(b?.basalMicroDailyMaxUnits, 0, 30, DEFAULTS.basalMicroDailyMaxUnits),
    basalMicroPercent: clamp(b?.basalMicroPercent, HARD.minBasalMicroPercent, HARD.maxBasalMicroPercent, DEFAULTS.basalMicroPercent),
    cooldownAcceptMin: clamp(b?.cooldownAcceptMin, HARD.minCooldownAcceptMin, 180, DEFAULTS.cooldownAcceptMin),
    cooldownDeclineMin: clamp(b?.cooldownDeclineMin, HARD.minCooldownDeclineMin, 240, DEFAULTS.cooldownDeclineMin),
    expireMin: clamp(b?.expireMin, HARD.minExpireMin, HARD.maxExpireMin, DEFAULTS.expireMin),
    maxIob: clamp(b?.maxIob, 0.5, HARD.maxMaxIob, DEFAULTS.maxIob),
    minUnits: clamp(b?.minUnits, 0.5, 5, DEFAULTS.minUnits),
  }
}

export interface DecideInput {
  settings: AutopilotSettings
  hasPending: boolean
  /** Másodperc az utolsó elfogadott KORREKCIÓ óta, vagy null — csak a korrekciós ágat fékezi (a mikrónak
   *  szándékosan nincs saját cooldownja, lásd lent). */
  secSinceAcceptedCorrection: number | null
  /** Másodperc az utolsó elutasított KORREKCIÓ óta, vagy null. */
  secSinceDeclinedCorrection: number | null
  todayCorrectionUnits: number
  todayBasalMicroUnits: number
  /** A terápia maxBolus-a (E), vagy null, ha nincs beállítva terápia. */
  maxBolus: number | null
  prediction: {
    risk: boolean; iob: number; insulinNeeded: number | null; insulinFull: number | null
    /** Irreális ugrás két egymást követő szenzormérés között (szenzorhiba gyanúja) — erre sosem javasol. */
    glucoseJumpSuspect: boolean
  }
  /** `predictSeries()` +60..+180 perces szakasza tartósan (≥80%) cél fölött, és az `eventual` is — lásd checkAutopilot. */
  sustainedHigh: boolean
  /** A toll lépésköze (E): minden javaslat (korrekció és mikro is) erre van lefelé kerekítve. */
  doseStep: number
}

export interface Decision { kind: SuggestionKind; amount: number }

export function decideAutopilot(i: DecideInput): Decision | null {
  if (!i.settings.enabled || i.hasPending) return null
  // Hipó-kockázatnál SOSEM javasol — nem konfigurálható.
  if (i.prediction.risk) return null
  // Megbízhatatlan (irreálisan ugró) adatra SOSEM javasol — nem konfigurálható.
  if (i.prediction.glucoseJumpSuspect) return null
  // Magas aktív inzulinnál sosem javasol — nem konfigurálható (a settings.maxIob-nak is van felső plafonja, lásd validateAutopilot).
  if (i.prediction.iob >= i.settings.maxIob) return null
  // Minél közelebb van az aktív inzulin a plafonhoz, annál kevesebb "hely" marad egy újabb adagnak — sima
  // lefékezés egy hirtelen igen/nem kapu helyett (a plafon fölött a fenti sor már úgyis kizár mindent).
  const iobHeadroom = i.settings.maxIob - i.prediction.iob

  const correctionCooldown =
    (i.secSinceAcceptedCorrection != null && i.secSinceAcceptedCorrection < i.settings.cooldownAcceptMin * 60) ||
    (i.secSinceDeclinedCorrection != null && i.secSinceDeclinedCorrection < i.settings.cooldownDeclineMin * 60)
  if (!correctionCooldown && i.todayCorrectionUnits < i.settings.dailyMaxUnits) {
    const full = i.prediction.insulinNeeded
    if (full != null && full >= i.settings.minUnits) {
      const cap = i.maxBolus != null ? i.maxBolus * HARD.maxBolusFraction : Infinity
      const remaining = i.settings.dailyMaxUnits - i.todayCorrectionUnits
      const amount = Math.round(Math.min(full, cap, remaining, iobHeadroom) * 10) / 10
      if (amount >= i.settings.minUnits) return { kind: 'correction', amount }
    }
  }

  // A mikro-kiegészítésnek szándékosan nincs saját cooldownja (mint egy pumpa SMB-je): minden ciklusban
  // újraszámol, a fék a napi keret, az aktív inzulin és a fenti hipó-/megbízhatósági kapuk.
  if (i.settings.basalMicroEnabled && i.sustainedHigh && i.todayBasalMicroUnits < i.settings.basalMicroDailyMaxUnits) {
    // Mint egy valódi pumpa SMB-je: a teljes (nem halvott) szükséglet egy hányada, nem fix lépés — újraszámolva
    // minden ciklusban, ahogy a trend nő vagy csökken.
    const full = i.prediction.insulinFull
    if (full != null && full > 0) {
      const cap = i.maxBolus != null ? i.maxBolus * HARD.microMaxBolusFraction : Infinity
      const remaining = i.settings.basalMicroDailyMaxUnits - i.todayBasalMicroUnits
      const amount = floorTo(Math.min(full * (i.settings.basalMicroPercent / 100), cap, remaining, iobHeadroom), i.doseStep)
      if (amount >= i.doseStep) return { kind: 'basal_micro', amount }
    }
  }
  return null
}
