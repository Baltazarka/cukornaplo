// Két terápiás beállítás ugyanaz-e (a mentés időbélyege nélkül): az előzmény csak valódi változást őriz.
import type { Therapy } from '../types/therapy'

export function sameTherapy(a: Therapy | null | undefined, b: Therapy | null | undefined): boolean {
  if (!a || !b) return false
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
}
