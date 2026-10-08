// Terápiás beállítások (az InPen app „Inzulinbeállítások” képernyőjének megfelelője), a settings.json
// `therapy` kulcsa alatt. Egyelőre kézzel állítható; a `source` mező jelzi, ha később számítás vagy
// varázsló állítja be.
import type { Therapy, TherapySegment } from '#shared/types/therapy'
import { insulinById } from '#shared/utils/insulins'
import { zonedToTs } from './normalize'
import { minuteOfDayInTz } from './time'

export const THERAPY_LIMITS = {
  maxBolus: { min: 0.5, max: 50 },
  actionMinutes: { min: 120, max: 480, step: 15 },
  target: { min: 3.9, max: 13.9 },
  isf: { min: 0.1, max: 20 },
  icr: { min: 0.5, max: 150 },
  segments: 12,
} as const

export function therapy(): Therapy | null {
  const t = setting<Therapy>('therapy', null)
  return t && Array.isArray(t.segments) && t.segments.length ? t : null
}

function hmToMin(hm: string): number {
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
  const insulin = (v: unknown, kind: 'bolus' | 'basal') => {
    if (v == null || v === '') return null
    const info = insulinById(String(v))
    if (info?.kind !== kind) errors.push(kind === 'bolus' ? 'Ismeretlen bólusinzulin.' : 'Ismeretlen bázisinzulin.')
    return info?.kind === kind ? info.id : null
  }
  const bolusInsulin = insulin(body?.bolusInsulin, 'bolus')
  const basalInsulin = insulin(body?.basalInsulin, 'basal')

  const raw: any[] = Array.isArray(body?.segments) ? body.segments : []
  if (!raw.length) errors.push('Legalább egy napszak kell.')
  if (raw.length > L.segments) errors.push(`Legfeljebb ${L.segments} napszak adható meg.`)
  // Ki kapcsolt napszakbeállításnál is minden napszakot megőrzünk (visszakapcsolva meglegyenek),
  // de csak az első érvényes, egész nap.
  const segments: TherapySegment[] = []
  raw.slice(0, L.segments).forEach((s, i) => {
    const start = String(s?.start ?? '')
    const label = `${i + 1}. napszak`
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
        start, target: round(target, 1), isf: round(isf, 1), icr: round(icr, 1),
        ...(segAction != null ? { actionMinutes: segAction } : {}),
      })
    }
  })
  segments.sort((a, b) => hmToMin(a.start) - hmToMin(b.start))
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start === segments[i - 1].start) {
      errors.push(`Két napszak kezdődik ${segments[i].start}-kor.`)
      break
    }
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
      byTimeOfDay,
      segments,
      source: 'manual',
      updatedAt: Math.floor(Date.now() / 1000),
    },
  }
}

const hmMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** Az érvényes napszakok időrendben (kikapcsolt napszakbeállításnál csak az első, egész nap). */
export function activeSegments(t: Therapy): TherapySegment[] {
  return t.byTimeOfDay ? t.segments : [{ ...t.segments[0], start: '00:00' }]
}

/** Az adott időpontban érvényes napszak (az utolsó éjfélen át az elsőig tart). */
export function segmentAt(t: Therapy, ts: number): TherapySegment {
  const segs = activeSegments(t)
  const m = minuteOfDayInTz(ts)
  let seg = segs[segs.length - 1]
  for (const s of segs) if (hmMin(s.start) <= m) seg = s
  return seg
}

/** Egy bólus hatásideje percben: a beadás napszakáé, ha ott külön meg van adva. */
export function actionMinutesAt(t: Therapy, ts: number): number {
  return segmentAt(t, ts).actionMinutes ?? t.actionMinutes
}

/**
 * A napszakok egy adott napra (YYYY-MM-DD) vetítve, unix másodpercben. Az éjfél és az első
 * kezdet közötti szakasz az utolsó napszakhoz tartozik.
 */
export function daySegments(t: Therapy, ymd: string) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const segs = activeSegments(t)
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
