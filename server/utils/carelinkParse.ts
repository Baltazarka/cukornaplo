// A CareLink nyers válaszának értelmezése (tiszta függvények, nincs adatbázis és beállítás: tests/carelink.test.ts).
// Az időzóna-javítás (clTimeShift) a legtörékenyebb rész: lásd a kommentet.
import { MGDL_PER_MMOL, zonedToTs } from './normalize.ts'
import type { Row } from './db.ts'

export function clParseTime(value: any): number | null {
  if (typeof value === 'number') return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value)
  if (typeof value !== 'string' || value.trim() === '') return null
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value.trim())
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!hasTz && iso) return zonedToTs(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0))
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
}

/**
 * Időzóna-hiba javítása (xDrip-módszer): ha a készülék órája egész órával eltér a CareLink szerveridejétől, az összes
 * időpontot ennyivel toljuk. A viszonyítás a készülék feltöltéskori ideje; csak ha az hiányzik, a legutolsó szenzorérték.
 * Csak a pontosan egész órás (±10 perc) eltérés számít időzóna-hibának: szenzorkimaradás után a legutolsó érték
 * 30–90 perccel is régebbi lehet, ami kerekítve tévesen egy órás eltolásnak látszana.
 * Csak friss feltöltésnél (a szerveridő legfeljebb 20 perces): ha a telefon nem tölt fel (pl. frissítés, kikapcsolt
 * app), a régi szerveridő és a készülékidő különbsége óránként nő, és egész óránál tévesen eltolta az egész napot
 * (2026-10-22: az előző nap görbéje 1 és 2 órával eltolva még kétszer bekerült).
 */
export function clTimeShift(pd: any, now = Math.floor(Date.now() / 1000)): number {
  const serverMs = pd.lastMedicalDeviceDataUpdateServerTime ?? pd.lastConduitUpdateServerDateTime ?? null
  if (typeof serverMs !== 'number' || serverMs <= 1) return 0
  if (Math.abs(now - serverMs / 1000) > 20 * 60) return 0
  const deviceTs = clParseTime(pd.medicalDeviceTimeAsString ?? pd.sMedicalDeviceTime ?? null)
  const lastSg = pd.lastSG
  const lastTs = lastSg && typeof lastSg === 'object' ? clParseTime(lastSg.datetime ?? lastSg.timestamp ?? null) : null
  const ref = deviceTs ?? lastTs
  if (ref == null) return 0
  const delta = serverMs / 1000 - ref
  const hours = Math.round(delta / 3600)
  if (hours === 0 || Math.abs(hours) >= 26 || Math.abs(delta - hours * 3600) > 10 * 60) return 0
  return hours * 3600
}

/** A nyers CareLink válaszból glükóz sorok (mmol/L), időzóna-javítással (clTimeShift). */
export function clExtractGlucose(data: any): Row[] {
  const pd = data?.patientData && typeof data.patientData === 'object' ? data.patientData : data
  const sgs = pd?.sgs
  if (!Array.isArray(sgs)) return []

  const shift = clTimeShift(pd)

  const rows: Row[] = []
  const now = Math.floor(Date.now() / 1000)
  for (const sg of sgs) {
    if (!sg || typeof sg !== 'object') continue
    const mgdl = sg.sg
    if (typeof mgdl !== 'number' || mgdl <= 0) continue
    let ts = clParseTime(sg.datetime ?? sg.timestamp ?? null)
    if (ts === null) continue
    ts += shift
    const mmol = Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10
    if (mmol < 1 || mmol > 35 || ts > now + 600) continue
    rows.push({ type: 'glucose', ts, value: mmol, subtype: null, source: 'CareLink' })
  }
  return rows
}
