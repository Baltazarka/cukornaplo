// Terápiás beállítások (az InPen app „Inzulinbeállítások” képernyőjének megfelelője), a settings.json
// `therapy` kulcsa alatt. Egyelőre kézzel állítható; a `source` mező jelzi, ha később számítás vagy
// varázsló állítja be.
import type { ShiftKind, ShiftSchedule, Therapy, TherapySegment } from '#shared/types/therapy'
import { insulinById } from '#shared/utils/insulins'
import { shiftOf, profileFor } from '#shared/utils/shift'
import { sameTherapy } from '#shared/utils/sameTherapy'
import { zonedToTs } from './normalize'
import { minuteOfDayInTz, ymdInTz } from './time'

export const THERAPY_LIMITS = {
  maxBolus: { min: 0.5, max: 50 },
  actionMinutes: { min: 120, max: 480, step: 15 },
  target: { min: 3.9, max: 13.9 },
  isf: { min: 0.1, max: 20 },
  icr: { min: 0.5, max: 150 },
  fpuPercent: { min: 0, max: 100, step: 10 },
  segments: 12,
} as const

/** A zsír-fehérje javaslat alapértelmezése: a varsói érték fele (a teljes érték sokaknál későbbi hipót okoz). */
export const DEFAULT_FPU_PERCENT = 50

/** A váltott műszak beosztása (settings.json `shift`), vagy null. */
export function shiftSchedule(): ShiftSchedule | null {
  const s = setting<ShiftSchedule>('shift', null)
  return s?.enabled ? s : null
}

/** Az adott nap (YYYY-MM-DD) műszakja, ha van beosztás. */
export function shiftOn(ymd: string): ShiftKind | null {
  return shiftOf(shiftSchedule(), ymd)
}

/** Az adott napon érvényes terápiás profil ('alt' = a délutános hétre beállított). */
export function profileOn(t: Therapy, ymd: string): 'base' | 'alt' {
  return profileFor(t, shiftOn(ymd))
}

/** A terápiás beállítás egy korábbi állapota: `from`-tól (unix mp) érvényes. */
export interface TherapyVersion { from: number; therapy: Therapy }
const HISTORY_MAX = 100

/** A beállítások előzménye időrendben (settings `therapy_history`). */
export function therapyHistory(): TherapyVersion[] {
  return setting<TherapyVersion[]>('therapy_history', []) ?? []
}

/**
 * Mentéskor az új beállítás bekerül az előzménybe. Az első mentéskor a korábbi (addig érvényes) beállítás is,
 * kezdettől érvényesként: így a régebbi események a régi értékekkel számolhatók.
 */
export function recordTherapy(next: Therapy, prev: Therapy | null): void {
  const list = [...therapyHistory()]
  // Változatlan mentés (pl. újra a „Mentés”): nem kerül az előzménybe, különben a százas korlát kiszorítaná a valódi
  // régi változatokat, és az elemzés a régi eseményeket későbbi értékekkel értékelné.
  if (sameTherapy(next, list.length ? list[list.length - 1].therapy : prev)) return
  if (!list.length && prev) list.push({ from: 0, therapy: prev })
  list.push({ from: Math.floor(Date.now() / 1000), therapy: next })
  saveSettings({ therapy_history: list.slice(-HISTORY_MAX) })
}

/**
 * Az adott időpontban érvényes beállítás az előzményből (előzmény nélkül a mostani). Az elemzés ezzel számol, hogy
 * egy módosítás után a régi események ne az új értékekkel értékelődjenek.
 */
export function therapyAt(ts: number): Therapy | null {
  const list = therapyHistory()
  if (!list.length) return therapy()
  let v = list[0].therapy
  for (const x of list) if (x.from <= ts) v = x.therapy
  return v
}

export function therapy(): Therapy | null {
  const t = setting<Therapy>('therapy', null)
  return t && Array.isArray(t.segments) && t.segments.length ? t : null
}

export function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

const round = (v: number, dec: number) => Math.round(v * 10 ** dec) / 10 ** dec

/**
 * A beküldött adatok ellenőrzése. Hiba esetén magyar nyelvű üzenetek listája, különben a
 * normalizált beállítás (napszakok időrendben).
 */
export function validateTherapy(body: any): { ok: true; therapy: Therapy } | { ok: false; errors: string[] } {
  const L = THERAPY_LIMITS
  const errors: string[] = []
  const inRange = (v: unknown, lim: { min: number; max: number }) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= lim.min && n <= lim.max ? n : null
  }
  const num = (v: number) => v.toLocaleString('hu-HU')

  const maxBolus = inRange(body?.maxBolus, L.maxBolus)
  if (maxBolus == null) errors.push(`A maximális dózis ${num(L.maxBolus.min)} és ${num(L.maxBolus.max)} E között lehet.`)
  const actionMinutes = inRange(body?.actionMinutes, L.actionMinutes)
  if (actionMinutes == null || actionMinutes % L.actionMinutes.step !== 0) {
    errors.push('Az inzulinhatás időtartama 2 és 8 óra között lehet, negyedórás lépésekben.')
  }
  const byTimeOfDay = body?.byTimeOfDay === true
  // Zsír-fehérje javaslat (varsói érték %-a): üresen az alapértelmezett 50%.
  let fpuPercent = DEFAULT_FPU_PERCENT
  if (body?.fpuPercent != null && body.fpuPercent !== '') {
    const f = inRange(body.fpuPercent, L.fpuPercent)
    if (f == null || f % L.fpuPercent.step !== 0) errors.push('A zsír-fehérje javaslat 0 és 100% között lehet, 10%-os lépésekben.')
    else fpuPercent = f
  }
  const insulin = (v: unknown, kind: 'bolus' | 'basal') => {
    if (v == null || v === '') return null
    const info = insulinById(String(v))
    if (info?.kind !== kind) errors.push(kind === 'bolus' ? 'Ismeretlen bólusinzulin.' : 'Ismeretlen bázisinzulin.')
    return info?.kind === kind ? info.id : null
  }
  const bolusInsulin = insulin(body?.bolusInsulin, 'bolus')
  const basalInsulin = insulin(body?.basalInsulin, 'basal')

  const segments = parseSegments(body?.segments, '', errors)
  // Váltott műszak: a délutános hét külön napszakbeállítása (csak bekapcsolva ellenőrizzük és mentjük).
  const altEnabled = body?.altEnabled === true
  const altSegments = altEnabled ? parseSegments(body?.altSegments, 'Délutános hét, ', errors) : undefined
  // A bázis automatikus beírása (időpont és adag).
  // Kikapcsolva (`enabled: false`) is megmarad az időpont és az adag, hogy a visszakapcsolásnál ne kelljen újra megadni.
  let basalAuto: Therapy['basalAuto']
  const ba = body?.basalAuto
  const baTime = String(ba?.time ?? '')
  const baUnits = Math.round(Number(ba?.units) * 10) / 10
  const baTimeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(baTime)
  const baUnitsOk = Number.isFinite(baUnits) && baUnits >= 1 && baUnits <= 100
  if (ba?.enabled === true) {
    if (!baTimeOk) errors.push('A bázis beadásának időpontja érvénytelen.')
    if (!baUnitsOk) errors.push('A bázisadag 1 és 100 E között lehet.')
    basalAuto = { time: baTime, units: baUnits }
  } else if (baTimeOk && baUnitsOk) {
    basalAuto = { time: baTime, units: baUnits, enabled: false }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    therapy: {
      mealMode: 'carbs',
      bolusInsulin,
      basalInsulin,
      maxBolus: round(maxBolus!, 1),
      actionMinutes: actionMinutes!,
      fpuPercent,
      fpuTiming: body?.fpuTiming === 'together' ? 'together' : 'later',
      byTimeOfDay,
      segments,
      ...(altEnabled ? { altEnabled: true, altSegments, freeProfile: body?.freeProfile === 'alt' ? 'alt' : 'base' } : {}),
      ...(basalAuto ? { basalAuto } : {}),
      source: 'manual',
      updatedAt: Math.floor(Date.now() / 1000),
    },
  }
}

/** Napszaklista ellenőrzése és normalizálása (időrendben); a hibák az `errors`-ba kerülnek. */
function parseSegments(input: unknown, prefix: string, errors: string[]): TherapySegment[] {
  const L = THERAPY_LIMITS
  const inRange = (v: unknown, lim: { min: number; max: number }) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= lim.min && n <= lim.max ? n : null
  }
  const num = (v: number) => v.toLocaleString('hu-HU')
  const raw: any[] = Array.isArray(input) ? input : []
  if (!raw.length) errors.push(`${prefix}Legalább egy napszak kell.`)
  if (raw.length > L.segments) errors.push(`${prefix}Legfeljebb ${L.segments} napszak adható meg.`)
  // Ki kapcsolt napszakbeállításnál is minden napszakot megőrzünk (visszakapcsolva meglegyenek),
  // de csak az első érvényes, egész nap.
  const segments: TherapySegment[] = []
  raw.slice(0, L.segments).forEach((s, i) => {
    const start = String(s?.start ?? '')
    const label = `${prefix}${i + 1}. napszak`
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) errors.push(`${label}: érvénytelen kezdő időpont.`)
    const target = inRange(s?.target, L.target)
    const isf = inRange(s?.isf, L.isf)
    const icr = inRange(s?.icr, L.icr)
    if (target == null) errors.push(`${label}: a célérték ${num(L.target.min)} és ${num(L.target.max)} mmol/L között lehet.`)
    if (isf == null) errors.push(`${label}: az érzékenységi tényező ${num(L.isf.min)} és ${num(L.isf.max)} mmol/L/E között lehet.`)
    if (icr == null) errors.push(`${label}: a CH-arány ${num(L.icr.min)} és ${num(L.icr.max)} g/E között lehet.`)
    // Napszakra jellemző hatásidő (opcionális): üresen a közös érték érvényes.
    let segAction: number | undefined
    if (s?.actionMinutes != null && s.actionMinutes !== '') {
      const a = inRange(s.actionMinutes, L.actionMinutes)
      if (a == null || a % L.actionMinutes.step !== 0) errors.push(`${label}: a hatásidő 2 és 8 óra között lehet, negyedórás lépésekben.`)
      else segAction = a
    }
    if (target != null && isf != null && icr != null) {
      segments.push({
        start, target: round(target, 1), isf: round(isf, 2), icr: round(icr, 2),
        ...(segAction != null ? { actionMinutes: segAction } : {}),
      })
    }
  })
  segments.sort((a, b) => hmToMin(a.start) - hmToMin(b.start))
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start === segments[i - 1].start) {
      errors.push(`${prefix}Két napszak kezdődik ${segments[i].start}-kor.`)
      break
    }
  }
  return segments
}

const hmMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/**
 * Az érvényes napszakok időrendben (kikapcsolt napszakbeállításnál csak az első, egész nap). Időponttal (`ts`) vagy
 * nappal (`ymd`) a váltott műszak szerinti profil (délutános héten a külön beállítás), anélkül az alap.
 */
export function activeSegments(t: Therapy, at?: number | string): TherapySegment[] {
  const ymd = typeof at === 'number' ? ymdInTz(at) : at
  const segs = ymd != null && profileOn(t, ymd) === 'alt' && t.altSegments?.length ? t.altSegments : t.segments
  if (t.byTimeOfDay) return segs
  // Kikapcsolt napszakbeállításnál az első napszak értékei egész nap, a közös hatásidővel (a napszak elrejtett saját
  // hatásideje nem érvényes).
  const { actionMinutes: _hidden, ...first } = segs[0]
  return [{ ...first, start: '00:00' }]
}

/**
 * Az adott időpontban érvényes napszak (az utolsó éjfélen át az elsőig tart), a műszak szerinti profilból.
 * `base`: mindig az alap profil (az elemzés napszak-csoportosításához).
 */
export function segmentAt(t: Therapy, ts: number, base = false): TherapySegment {
  const segs = activeSegments(t, base ? undefined : ts)
  const m = minuteOfDayInTz(ts)
  let seg = segs[segs.length - 1]
  for (const s of segs) if (hmMin(s.start) <= m) seg = s
  return seg
}

/**
 * Átmenet a napszakok között (a bóluskalkulátor alapbeállítása): a CH-arány és az érzékenység a napszak kezdetén a
 * beállított érték, onnan a következő napszak kezdetéig arányosan halad a következő értékéig. Pl. 06:00-kor 2 g/E,
 * 12:00-kor 4 g/E → 09:00-kor 3 g/E. Az utolsó napszak éjfélen át az elsőig tart. Egy napszaknál null.
 */
export function blendAt(t: Therapy, ts: number): { frac: number; icr: number; isf: number; next: TherapySegment } | null {
  const segs = activeSegments(t, ts)
  const seg = segmentAt(t, ts)
  const idx = segs.indexOf(seg)
  if (segs.length < 2 || idx < 0) return null
  const next = segs[(idx + 1) % segs.length]
  const len = (hmMin(next.start) - hmMin(seg.start) + 1440) % 1440 || 1440
  const frac = ((minuteOfDayInTz(ts) - hmMin(seg.start) + 1440) % 1440) / len
  const mix = (a: number, b: number) => Math.round((a + (b - a) * frac) * 100) / 100
  return { frac: Math.round(frac * 100) / 100, icr: mix(seg.icr, next.icr), isf: mix(seg.isf, next.isf), next }
}

/** Egy bólus hatásideje percben: a beadás napszakáé, ha ott külön meg van adva. */
export function actionMinutesAt(t: Therapy, ts: number): number {
  // Napszakbeállítás nélkül a közös hatásidő érvényes (a rejtett, napszakonkénti érték nem írhatja felül).
  if (!t.byTimeOfDay) return t.actionMinutes
  return segmentAt(t, ts).actionMinutes ?? t.actionMinutes
}

/**
 * A napszakok egy adott napra (YYYY-MM-DD) vetítve, unix másodpercben. Az éjfél és az első
 * kezdet közötti szakasz az utolsó napszakhoz tartozik.
 */
export function daySegments(t: Therapy, ymd: string) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const segs = activeSegments(t, ymd)
  const at = (min: number) => zonedToTs(y, mo, d, Math.floor(min / 60), min % 60, 0)
  const cuts = segs.map((s, i) => ({ seg: s, index: i, from: hmMin(s.start) }))
  const out: { from: number; to: number; index: number; start: string; end: string; target: number; isf: number; icr: number; actionMinutes: number }[] = []
  const push = (c: (typeof cuts)[number], fromMin: number, toMin: number) => {
    if (toMin <= fromMin) return
    out.push({
      from: at(fromMin),
      // Date.UTC kezeli a hónap végi túlcsordulást (d + 1).
      to: toMin >= 1440 ? zonedToTs(y, mo, d + 1, 0, 0, 0) : at(toMin),
      index: c.index,
      start: c.seg.start,
      end: segs[(c.index + 1) % segs.length].start,
      target: c.seg.target, isf: c.seg.isf, icr: c.seg.icr,
      actionMinutes: c.seg.actionMinutes ?? t.actionMinutes,
    })
  }
  push(cuts[cuts.length - 1], 0, cuts[0].from)
  cuts.forEach((c, i) => push(c, c.from, i + 1 < cuts.length ? cuts[i + 1].from : 1440))
  return out
}
