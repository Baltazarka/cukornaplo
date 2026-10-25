// Terápiás beállítások megjelenítési segédei (kártya és szerkesztő).

import type { Therapy, TherapySegment } from '#shared/types/therapy'

/** 225 → „3 ó 45 p”, 180 → „3 ó”, 30 → „30 p”, mint az InPen appban. */
export function actionLabel(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m} p`
  return m ? `${h} ó ${m} p` : `${h} ó`
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** A napszak vége = a következő kezdete; az utolsóé az első kezdete (éjfélen át). */
export function segmentEnd(segs: TherapySegment[], i: number): string {
  return segs[(i + 1) % segs.length].start
}

/** A megadott percben (a nap 0–1439. perce) érvényes napszak indexe (`segs`: a mai profil napszakai). */
export function activeSegment(t: Therapy, minuteOfDay: number, segs: TherapySegment[] = t.segments): number {
  if (!t.byTimeOfDay) return 0
  let idx = segs.length - 1
  segs.forEach((s, i) => { if (hmToMinutes(s.start) <= minuteOfDay) idx = i })
  return idx
}
