// Kézi import: beillesztett sorok vagy feltöltött fájl (.txt/.csv/.json).
import { parseTextLines, parseJsonPayload, recordIngest, type Parsed } from '../utils/normalize'
import { storeRows } from '../utils/db'

export default defineEventHandler(async (event) => {
  let text = ''
  const ct = getHeader(event, 'content-type') ?? ''
  if (ct.includes('multipart/form-data')) {
    for (const p of (await readMultipartFormData(event)) ?? []) {
      if (p.name === 'lines' && !p.filename) text += p.data.toString('utf8') + '\n'
      else if (p.filename) text += p.data.toString('utf8') + '\n'
    }
  } else {
    const body = (await readBody(event)) ?? {}
    text = String(body.lines ?? '')
  }

  const trimmed = text.replace(/^\s+/, '')
  let parsed: Parsed
  if (trimmed !== '' && trimmed[0] === '{') {
    try {
      parsed = parseJsonPayload(JSON.parse(trimmed))
    } catch {
      parsed = parseTextLines(text)
    }
  } else {
    parsed = parseTextLines(text)
  }

  const [inserted, duplicates] = storeRows(parsed.rows)
  recordIngest('kézi import', inserted, duplicates, parsed.errors)
  return {
    ok: true,
    inserted,
    duplicates,
    rejected: parsed.errors.length,
    errors: parsed.errors.slice(0, 20),
  }
})
