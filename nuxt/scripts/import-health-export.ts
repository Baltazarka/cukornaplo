// Apple Health teljes export (export.xml) betöltése parancssorból, streamelve.
// Használat:  DATA_DIR=... node scripts/import-health-export.ts <export.xml> [kezdő dátum, pl. 2026-01-01]
// Csak a glükóz-, inzulin- és szénhidrát-rekordokat olvassa be. Node 22+ (node:sqlite, .ts natívan).
import { DatabaseSync } from 'node:sqlite'
import { createReadStream, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve, join } from 'node:path'
import { normalizeRow } from '../server/utils/normalize.ts'

const file = process.argv[2]
if (!file) {
  console.error('Használat: DATA_DIR=... node scripts/import-health-export.ts <export.xml> [kezdő dátum]')
  process.exit(1)
}
const since = process.argv[3] ? Math.floor(Date.parse(process.argv[3]) / 1000) : 0

const dataDir = process.env.DATA_DIR || resolve(import.meta.dirname!, '../../data')
mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'diabetes.sqlite'))
db.exec('PRAGMA journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('glucose','insulin','carbs')),
  ts INTEGER NOT NULL, value REAL NOT NULL, subtype TEXT, source TEXT, created_at INTEGER NOT NULL,
  UNIQUE (type, ts, value))`)
db.exec('CREATE INDEX IF NOT EXISTS entries_type_ts ON entries (type, ts)')

const TYPES: Record<string, string> = {
  HKQuantityTypeIdentifierBloodGlucose: 'glucose',
  HKQuantityTypeIdentifierInsulinDelivery: 'insulin',
  HKQuantityTypeIdentifierDietaryCarbohydrates: 'carbs',
}

const insert = db.prepare('INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
const now = Math.floor(Date.now() / 1000)
let batch: any[] = []
let seen = 0, inserted = 0, errors = 0

function flush() {
  if (!batch.length) return
  db.exec('BEGIN')
  for (const r of batch) inserted += Number(insert.run(r.type, r.ts, r.value, r.subtype, r.source, now).changes)
  db.exec('COMMIT')
  batch = []
}

function attrs(block: string): Record<string, string> {
  const open = block.match(/<Record\b([\s\S]*?)>/)
  const out: Record<string, string> = {}
  if (open) for (const m of open[1].matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

function handle(block: string) {
  const a = attrs(block)
  const type = TYPES[a.type]
  if (!type) return
  let subtype = ''
  if (type === 'insulin') {
    const m = block.match(/HKInsulinDeliveryReason"\s+value="([^"]*)"/)
    if (m) subtype = m[1] // 1 = bázis, 2 = bólus
  }
  const r = normalizeRow(type, a.startDate ?? '', a.value ?? '', a.unit ?? '', a.sourceName ?? '', subtype)
  seen++
  if (typeof r === 'string') { errors++; return }
  if (since && r.ts < since) { seen--; return } // a kezdő dátum előtti sorokat kihagyjuk
  batch.push(r)
  if (batch.length >= 2000) { flush(); process.stdout.write(`\r${seen} rekord feldolgozva…`) }
}

const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
let buf: string | null = null
for await (const line of rl) {
  const t = line.trim()
  if (buf === null) {
    if (t.startsWith('<Record ') || t.startsWith('<Record>')) {
      if (t.endsWith('/>')) handle(t)
      else buf = t
    }
  } else {
    buf += '\n' + t
    if (t.endsWith('</Record>')) { handle(buf); buf = null }
  }
}
flush()
console.log(`\rKész: ${seen} rekord, ${inserted} új, ${seen - inserted - errors} már megvolt, ${errors} hibás.`)
