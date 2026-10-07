// Közös ingest-logika az api/ingest.php átírásából. Az /api/ingest és a régi /api/ingest.php is ezt hívja.
import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { parseTextLines, parseJsonPayload, recordIngest, type Parsed } from './normalize'
import { storeRows } from './db'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const splitLines = (s: string): string[] =>
  s.split(/\r\n|\r|\n/).map((x) => x.trim()).filter((x) => x.length > 0)

export async function handleIngest(event: H3Event) {
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')

  if (event.method !== 'POST') {
    setResponseStatus(event, 405)
    return { ok: false, error: 'Csak POST kérést fogadok.' }
  }

  const headers = getHeaders(event)
  const ct = headers['content-type'] ?? ''
  const fields: Record<string, string> = {}
  let fileText: string | null = null
  let rawText: string | null = null

  if (ct.includes('multipart/form-data')) {
    const parts = (await readMultipartFormData(event)) ?? []
    for (const p of parts) {
      if (p.filename) {
        if (p.name === 'data' || fileText === null) fileText = p.data.toString('utf8')
      } else if (p.name) {
        fields[p.name] = p.data.toString('utf8')
      }
    }
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    const body = (await readBody(event)) ?? {}
    for (const k of Object.keys(body)) if (typeof body[k] === 'string') fields[k] = body[k]
  } else {
    rawText = (await readRawBody(event, 'utf8')) ?? null
  }

  // Hitelesítés: X-Token fejléc vagy "token" mező. GET-ben sosem fogadjuk (naplóba kerülne).
  const token = (headers['x-token'] ?? fields.token ?? '').toString()
  const expected = String(setting('api_token', '') ?? '')
  if (expected === '' || !safeEqual(expected, token.trim())) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Hibás vagy hiányzó kulcs (X-Token).' }
  }

  const formFields = { ...fields }
  delete formFields.token

  let text: string | null = null
  if (typeof fields.dates === 'string' && typeof fields.values === 'string') {
    // Ismétlés nélküli Parancs: külön dátum- és értéklistából "típus;dátum;érték" sorok.
    const type = (fields.type?.trim() || 'glucose')
    const dates = splitLines(fields.dates)
    const values = splitLines(fields.values)
    if (dates.length !== values.length) {
      setResponseStatus(event, 400)
      return { ok: false, error: `A dátumok (${dates.length}) és az értékek (${values.length}) száma nem egyezik.` }
    }
    text = dates.map((d, i) => `${type};${d};${values[i]}`).join('\n')
    for (const k of Object.keys(formFields)) delete formFields[k]
  } else if (typeof fields.data === 'string') {
    text = fields.data
  } else if (Object.keys(formFields).length === 1) {
    text = Object.values(formFields)[0]
  } else if (fileText !== null) {
    text = fileText
  }

  let parsed: Parsed
  if (text !== null) {
    parsed = parseTextLines(text)
  } else {
    const body = rawText ?? ''
    const trimmed = body.replace(/^\s+/, '')
    if (trimmed !== '' && (trimmed[0] === '{' || trimmed[0] === '[')) {
      let json: any
      try {
        json = JSON.parse(body)
      } catch {
        setResponseStatus(event, 400)
        return { ok: false, error: 'Hibás JSON.' }
      }
      parsed = parseJsonPayload(json)
    } else {
      text = body
      parsed = parseTextLines(body)
    }
  }

  const lines = text !== null ? splitLines(text) : []
  const received = text !== null ? lines.length : parsed.rows.length + parsed.errors.length
  const firstLine = lines.length ? lines[0].slice(0, 120) : null

  const [inserted, duplicates] = storeRows(parsed.rows)
  recordIngest('api', inserted, duplicates, parsed.errors, received, firstLine)

  const response: Record<string, any> = {
    ok: true,
    received_lines: received,
    inserted,
    duplicates,
    rejected: parsed.errors.length,
    errors: parsed.errors.slice(0, 10),
  }
  if (firstLine !== null) response.first_line = firstLine
  if (received === 0) {
    const keys = Object.keys(formFields)
    response.hint = keys.length
      ? 'Üres adat érkezett. Ellenőrizd, hogy a "data" mező értéke az Egyesített szöveg legyen. Kapott mezők: ' + keys.join(', ')
      : 'Üres adat érkezett. A keresés nem talált mérést az adott időszakban, vagy a kérés törzse nem Űrlap "data" mezővel megy.'
  }
  return response
}
