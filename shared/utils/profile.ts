// Személyes adatok: a cukorbetegség típusai és a TAJ-szám ellenőrzése (a szerver és a felület közös része).

export const DIABETES_TYPES = [
  { id: 't1', label: '1-es típusú' },
  { id: 't2', label: '2-es típusú' },
  { id: 'lada', label: 'LADA (felnőttkori autoimmun)' },
  { id: 'mody', label: 'MODY' },
  { id: 'gestational', label: 'Terhességi' },
  { id: 'other', label: 'Egyéb' },
] as const

export function diabetesTypeLabel(id: string | null | undefined): string {
  return DIABETES_TYPES.find((t) => t.id === id)?.label ?? ''
}

/** A TAJ-szám számjegyei (szóköz, kötőjel nélkül). */
export const tajDigits = (s: string) => String(s ?? '').replace(/[\s-]/g, '')

/**
 * TAJ-szám ellenőrzése: 9 számjegy, az utolsó a CDV-kód. Az első 8 számjegyből a páratlan
 * helyiértékűek 3-mal, a párosak 7-tel szorozva, az összeg 10-es maradéka a 9. számjegy.
 */
export function validTaj(s: string): boolean {
  const d = tajDigits(s)
  if (!/^\d{9}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * (i % 2 === 0 ? 3 : 7)
  return sum % 10 === Number(d[8])
}

/** TAJ-szám 3-as csoportokban: 123 456 789. */
export const formatTaj = (s: string) => tajDigits(s).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

/** Életkor években egy születési dátumból (YYYY-MM-DD). */
export function ageOf(birthDate: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate ?? '')
  if (!m) return null
  let age = today.getFullYear() - Number(m[1])
  if (today.getMonth() + 1 < Number(m[2]) || (today.getMonth() + 1 === Number(m[2]) && today.getDate() < Number(m[3]))) age--
  return age
}
