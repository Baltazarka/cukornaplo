// Kézi import: beillesztett sorok vagy feltöltött fájl (.txt/.csv/.json).
import { parseTextLines, parseJsonPayload, recordIngest, setBasalDose, type Parsed } from '../utils/normalize'
import { storeRows } from '../utils/db'
import { markDirty } from '../utils/computed'

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

  // A bázisadag-egyezés (típus nélküli adag = bázis) importnál is érvényes.
  setBasalDose(setting('basal_dose', null) === null ? null : Number(setting('basal_dose')))
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
  if (inserted > 0) markDirty()
  recordIngest('kézi import', inserted, duplicates, parsed.errors)
  return {
    ok: true,
    inserted,
    duplicates,
    rejected: parsed.errors.length,
    errors: parsed.errors.slice(0, 20),
  }
})
