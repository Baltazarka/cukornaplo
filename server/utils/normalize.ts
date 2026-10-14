// A lib.php adatfeldolgozó részének átírása: típus/dátum/érték értelmezése és egységesítése.
import type { Row } from './db'

/** A bázisadag (E): a típus nélkül pontosan ekkora adagként érkező inzulin bázis. null = nincs beállítva. */
let basalDose: number | null = null
export function setBasalDose(n: number | null): void {
  basalDose = n !== null && Number.isFinite(n) && n > 0 ? n : null
}
/** A terápiában beállított maximális bólus (E): a típus nélkül ennél nagyobb adagként érkező inzulin bázis. */
let maxBolus: number | null = null
export function setMaxBolus(n: number | null): void {
  maxBolus = n !== null && Number.isFinite(n) && n > 0 ? n : null
}
export const MGDL_PER_MMOL = 18.0182

/**
 * Típus nélküli adag, ami bázisnak tekintendő: a beállított bázisadag ±25%-án belül (és a maximális bólus fölött),
 * vagy bázisadag nélkül a maximális bólus másfélszeresénél nagyobb. Egy nagy étkezési bólus (pl. 26 E a 25-ös
 * maximum mellett) így nem lesz bázis, a más adaggal beadott bázis (pl. 50 E az 52 helyett) igen.
 */
export function looksBasal(v: number, basal: number | null, max: number | null): boolean {
  if (basal != null && Math.abs(v - basal) < 0.05) return true
  if (max == null) return false
  if (basal != null) return v > max && Math.abs(v - basal) <= basal * 0.25
  return v > max * 1.5
}

const TYPE_MAP: Record<string, Row['type']> = {
  glucose: 'glucose', bg: 'glucose', sg: 'glucose', 'blood glucose': 'glucose',
  blood_glucose: 'glucose', vercukor: 'glucose', vercukorszint: 'glucose', glukoz: 'glucose',
  insulin: 'insulin', inzulin: 'insulin', 'insulin delivery': 'insulin', insulin_delivery: 'insulin',
  carbs: 'carbs', carb: 'carbs', ch: 'carbs', szenhidrat: 'carbs',
  carbohydrates: 'carbs', 'dietary carbohydrates': 'carbs', dietary_carbohydrates: 'carbs',
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[őű]/gi, (c) => (c === c.toLowerCase() ? 'o' : 'O'))
}

export function normalizeType(t: string): Row['type'] | null {
  return TYPE_MAP[stripAccents(t.trim()).toLowerCase()] ?? null
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, aug: 8, sze: 9, okt: 10, nov: 11, dec: 12,
}

const APP_TZ = process.env.APP_TZ || 'Europe/Budapest'

/**
 * Egy adott zónájú faliidő → UTC unix másodperc (DST-helyesen). A zóna eltolását a tényleges időpontban kell venni,
 * nem a faliidőt UTC-nek tekintve: az átállás napján (pl. október utolsó vasárnapja 01:00–03:00) a kettő eltér,
 * ezért egy második lépésben az első becslés időpontjának eltolásával számolunk újra. Kétszer előforduló faliidőnél
 * (őszi 02:00–03:00) a későbbi (téli időszámítás szerinti), nem létezőnél (tavaszi 02:00–03:00) egy órával későbbi.
 */
export function zonedToTs(y: number, mo: number, d: number, h: number, mi: number, s: number, tz = APP_TZ): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  /** A zóna eltolása (ms) az adott UTC-időpontban. */
  const offsetAt = (ms: number) => {
    const p: Record<string, string> = {}
    for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
  }
  const first = wall - offsetAt(wall)
  const off = offsetAt(first)
  return Math.floor((wall - off) / 1000)
}

/** ISO 8601, Apple Health vagy a magyar Parancsok-dátum ("2026. 10. 07. 8:15", "2026. okt. 7. 8:15:30"). */
export function parseDate(input: string): number | null {
  let s = input.replace(/[   ]/g, ' ').trim()
  if (s === '') return null
  let ts: number | null = null

  const hu = s.match(/^(\d{4})\.\s*([^\s.]+)\.?\s*(\d{1,2})\.?,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/u)
  if (hu) {
    const mon = hu[2]
    const month = /^\d+$/.test(mon) ? +mon : (MONTHS[stripAccents(mon).toLowerCase().slice(0, 3)] ?? 0)
    if (month >= 1 && month <= 12) {
      ts = zonedToTs(+hu[1], month, +hu[3], +hu[4], +hu[5], +(hu[6] ?? 0))
    }
  }

  // Apple Health export: "YYYY-MM-DD HH:MM:SS +ZZZZ" → ISO.
  if (ts === null) {
    const ah = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/)
    if (ah) {
      const parsed = Date.parse(`${ah[1]}T${ah[2]}${ah[3]}:${ah[4]}`)
      if (!Number.isNaN(parsed)) ts = Math.floor(parsed / 1000)
    }
  }

  if (ts === null) {
    const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (!hasTz && iso) {
      ts = zonedToTs(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0))
    } else {
      const parsed = Date.parse(s)
      if (!Number.isNaN(parsed)) ts = Math.floor(parsed / 1000)
    }
  }

  if (ts === null) return null
  if (ts < 946684800 || ts > Math.floor(Date.now() / 1000) + 86400) return null
  return ts
}

export function parseNumber(input: string): number | null {
  const s = input.replace(/[  ]/g, '').replace(',', '.')
  const m = s.match(/-?\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

/** Egy bejegyzés ellenőrzése + egységesítése. Visszaad egy Row-t vagy hibaszöveget. */
export function normalizeRow(
  type: string, date: string, value: string, unit = '', source = '', subtype = '',
): Row | string {
  const t = normalizeType(type)
  if (t === null) return `ismeretlen típus: "${type}"`
  const ts = parseDate(date)
  if (ts === null) return `nem értelmezhető dátum: "${date}"`
  let v = parseNumber(value)
  if (v === null) return `nem értelmezhető érték: "${value}"`

  if (t === 'glucose') {
    const isMgdl = /mg/i.test(unit + value) || (unit === '' && v > 35)
    if (isMgdl) v = v / MGDL_PER_MMOL
    v = Math.round(v * 10) / 10
    if (v < 1 || v > 35) return `valószínűtlen glükózérték: ${value} ${unit}`
  } else if (t === 'insulin') {
    v = Math.round(v * 100) / 100
    if (v <= 0 || v > 100) return `valószínűtlen inzulinadag: ${value}`
  } else {
    v = Math.round(v * 10) / 10
    if (v <= 0 || v > 500) return `valószínűtlen CH-mennyiség: ${value}`
  }

  let sub: string | null = null
  if (t === 'insulin' && subtype !== '') {
    const st = stripAccents(subtype).toLowerCase()
    if (st.includes('bas') || st.includes('baz') || st.includes('alap') || st === '1') sub = 'basal'
    else if (st.includes('korr') || st.includes('corr')) sub = 'correction'
    else if (st.includes('etk') || st.includes('meal') || st.includes('food') || st.includes('etel')) sub = 'meal'
    else if (st.includes('bol') || st === '2') sub = 'bolus'
  }

  // A Parancsok nem küldi az adag típusát: típus nélkül a beállított bázisadaggal egyező érték = bázis, minden más bólus.
  if (t === 'insulin' && sub === null && basalDose !== null && Math.abs(v - basalDose) < 0.05) sub = 'basal'
  if (t === 'insulin' && sub === null && looksBasal(v, basalDose, maxBolus)) sub = 'basal'

  let src = source.trim() !== '' ? source.trim().slice(0, 80) : null
  // Az InPen appba beírt vércukor ujjbegyes mérés, nem szenzoradat: kézi mérésként tároljuk (a görbe, a trend,
  // a lefedettség és az elemzés csak a szenzorból számol).
  if (t === 'glucose' && src && /inpen/i.test(src)) src = 'manual'
  return { type: t, ts, value: v, subtype: sub, source: src }
}

export interface Parsed { rows: Row[]; errors: string[] }

/** Soronként: típus;dátum;érték;mértékegység;forrás;altípus (az utolsó 3 elhagyható). */
export function parseTextLines(text: string): Parsed {
  const rows: Row[] = []
  const errors: string[] = []
  text.split(/\r\n|\r|\n/).forEach((line, i) => {
    line = line.trim()
    if (line === '' || line[0] === '#') return
    const f = line.split(/[;\t|]/).map((x) => x.trim())
    if (f.length < 3) {
      errors.push(`sor ${i + 1}: kevés mező (típus;dátum;érték kell)`)
      return
    }
    const r = normalizeRow(f[0], f[1], f[2], f[3] ?? '', f[4] ?? '', f[5] ?? '')
    if (typeof r === 'string') errors.push(`sor ${i + 1}: ${r}`)
    else rows.push(r)
  })
  return { rows, errors }
}

/** JSON bemenet: {data:"sorok"}, {entries:[...]}, vagy Health Auto Export {data:{metrics:[...]}}. */
export function parseJsonPayload(json: any): Parsed {
  if (typeof json?.data === 'string') return parseTextLines(json.data)
  const rows: Row[] = []
  const errors: string[] = []
  const add = (r: Row | string) => (typeof r === 'string' ? errors.push(r) : rows.push(r))

  if (Array.isArray(json?.entries)) {
    for (const e of json.entries) {
      if (e && typeof e === 'object') {
        add(normalizeRow(String(e.type ?? ''), String(e.date ?? ''), String(e.value ?? ''),
          String(e.unit ?? ''), String(e.source ?? ''), String(e.subtype ?? '')))
      }
    }
  }

  const metrics = json?.data?.metrics
  if (Array.isArray(metrics)) {
    for (const m of metrics) {
      const type = normalizeType(String(m?.name ?? ''))
      if (type === null || !Array.isArray(m?.data)) continue
      for (const d of m.data) {
        const val = d.qty ?? d.Avg ?? null
        add(normalizeRow(type, String(d.date ?? ''), String(val), String(m.units ?? ''),
          String(d.source ?? 'Health Auto Export'), String(d.reason ?? '')))
      }
    }
  }
  return { rows, errors }
}

export function recordIngest(
  via: string, inserted: number, duplicates: number, errors: string[],
  received: number | null = null, firstLine: string | null = null,
): void {
  saveSettings({
    last_ingest: {
      at: Math.floor(Date.now() / 1000), via, received, first_line: firstLine,
      inserted, duplicates, errors: errors.slice(0, 5),
    },
  })
}
