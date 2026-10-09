// Személyes adatok (név, születési dátum, TAJ-szám, cukorbetegség típusa) a settings.json
// `profile` kulcsán. A riport fejlécébe kerülnek. A TAJ-szám a megosztási linken csak akkor
// látszik, ha a felhasználó külön engedi.

export interface Profile {
  name: string
  birthDate: string
  taj: string
  diabetesType: string
  diagnosisYear: number | null
  /** A TAJ-szám a megosztási linkkel nézőnek is látszik. */
  shareTaj: boolean
  updatedAt: number
}

export function profile(): Profile | null {
  const p = setting<Profile>('profile', null)
  return p && typeof p === 'object' ? p : null
}

/** A megtekintőnek (megosztási link) adható változat. */
export function profileForViewer(p: Profile | null): Profile | null {
  return p && { ...p, taj: p.shareTaj ? p.taj : '' }
}

export function validateProfile(body: any): { ok: true; profile: Profile } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)

  const birthDate = String(body?.birthDate ?? '').trim()
  const thisYear = new Date().getFullYear()
  const birthOk = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && Number(birthDate.slice(0, 4)) >= 1900 && birthDate <= new Date().toLocaleDateString('sv-SE')
  if (birthDate && !birthOk) errors.push('A születési dátum érvénytelen.')

  const tajRaw = String(body?.taj ?? '').trim()
  if (tajRaw && !validTaj(tajRaw)) errors.push('A TAJ-szám érvénytelen (9 számjegy, az utolsó ellenőrző számjegy nem egyezik).')

  const diabetesType = String(body?.diabetesType ?? '')
  if (diabetesType && !DIABETES_TYPES.some((t) => t.id === diabetesType)) errors.push('Ismeretlen cukorbetegség-típus.')

  let diagnosisYear: number | null = null
  if (body?.diagnosisYear !== '' && body?.diagnosisYear != null) {
    diagnosisYear = Number(body.diagnosisYear)
    const min = birthOk ? Number(birthDate.slice(0, 4)) : 1900
    if (!Number.isInteger(diagnosisYear) || diagnosisYear < min || diagnosisYear > thisYear) {
      errors.push(`A diagnózis éve ${min} és ${thisYear} között lehet.`)
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    profile: {
      name, birthDate, taj: tajRaw ? tajDigits(tajRaw) : '', diabetesType, diagnosisYear,
      shareTaj: body?.shareTaj === true, updatedAt: Math.floor(Date.now() / 1000),
    },
  }
}
