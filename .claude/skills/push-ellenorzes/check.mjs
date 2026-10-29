// A kiküldött push-értesítések utólagos ellenőrzése egy letöltött másolatból:
//   node .claude/skills/push-ellenorzes/check.mjs <export.sqlite> [napok=7]
// Minden pushra: a vércukor akkor, a valós mélypont / csúcs a következő órában, volt-e előtte 30 percen belül CH vagy
// inzulin, és az előző azonos típusú push óta mennyi idő telt el. Jelzések:
//   TÉVES      – hipó-veszélyt jósolt, de a következő 60 percben a céltartomány alja fölött és a jósoltnál ≥ 0,3-del feljebb maradt
//   ISMÉTLÉS   – ugyanabban az epizódban (< 45 perc az előzőtől), és nem lett 0,3-del rosszabb
//   CH UTÁN    – 30 percen belül már beírt ≥ 10 g CH után szólt (hipó/CH push)
//   KÉSŐN      – a hipó-push már a céltartomány alatti értéknél jött először az epizódban
// Csak a push szövegét és számokat ír ki; a kimenetet ne másold ki a gépről.
import { DatabaseSync } from 'node:sqlite'

const [db, daysArg = '7'] = process.argv.slice(2)
if (!db) { console.error('Használat: node check.mjs <export.sqlite> [napok]'); process.exit(1) }
const d = new DatabaseSync(db, { readOnly: true })
const fmt = (ts) => new Date(ts * 1000).toLocaleString('sv-SE', { timeZone: 'Europe/Budapest' }).slice(0, 16)
const setting = (k) => { try { return JSON.parse(d.prepare('SELECT json FROM export_settings WHERE key=?').get(k)?.json ?? 'null') } catch { return null } }
const low = Number(setting('range_low') ?? 3.9)
const last = Number(d.prepare('SELECT MAX(ts) m FROM push_log').get().m ?? 0)
const from = last - Number(daysArg) * 86400
const pushes = d.prepare('SELECT ts, tag, title, body FROM push_log WHERE ts >= ? ORDER BY ts').all(from)
const gl = d.prepare("SELECT ts, value v FROM entries WHERE type='glucose' AND excluded=0 AND IFNULL(source,'')!='manual' AND ts BETWEEN ? AND ? ORDER BY ts")
const recent = d.prepare("SELECT type, value, subtype, created_at FROM entries WHERE type IN ('carbs','insulin') AND ts BETWEEN ? AND ? ORDER BY ts")

const kind = (p) => (/Hipó|Alacsony/i.test(p.title) ? 'hipó' : /szénhidrát kellene/i.test(p.title) ? 'ch' : /inzulin/i.test(p.title) && !/Bázis/.test(p.title) ? 'inzulin' : 'egyéb')
const prev = {}
const counts = { összes: 0, TÉVES: 0, ISMÉTLÉS: 0, 'CH UTÁN': 0, KÉSŐN: 0 }
console.log(`Céltartomány alja: ${low} | időszak: ${fmt(from)} – ${fmt(last)}\n`)
for (const p of pushes) {
  const k = kind(p)
  if (k === 'egyéb') { console.log(`${fmt(p.ts)}  ${p.title}`); continue }
  counts.összes++
  const now = gl.all(p.ts - 600, p.ts).pop()?.v ?? null
  const next = gl.all(p.ts, p.ts + 3600).map((r) => r.v)
  const min = next.length ? Math.min(...next) : null, max = next.length ? Math.max(...next) : null
  const before = recent.all(p.ts - 1800, p.ts)
  const carbs = before.filter((r) => r.type === 'carbs').reduce((a, r) => a + r.value, 0)
  const flags = []
  const pr = prev[k]
  const worst = Math.min(now ?? 99, min ?? 99)
  if (k === 'hipó' || k === 'ch') {
    const predicted = Number(/kb\. (\d+,\d)/.exec(p.title + ' ' + p.body)?.[1]?.replace(',', '.'))
    if (/veszély/i.test(p.title) && min != null && min >= low && (!Number.isFinite(predicted) || min >= predicted + 0.3)) flags.push('TÉVES')
    if (carbs >= 10) flags.push('CH UTÁN')
    if (pr && p.ts - pr.ts < 45 * 60 && !(worst <= pr.worst - 0.3)) flags.push('ISMÉTLÉS')
    if ((!pr || p.ts - pr.ts >= 45 * 60) && now != null && now < low) flags.push('KÉSŐN')
    if (Number.isFinite(predicted) && min != null) flags.push(`jósolt ${predicted} / valós min ${min}`)
  }
  for (const f of flags) if (f in counts) counts[f]++
  prev[k] = { ts: p.ts, worst }
  const ctx = `VC ${now ?? '–'} → 60 perc: min ${min ?? '–'}, max ${max ?? '–'}${before.length ? ` | előtte 30 percben: ${before.map((r) => `${r.type === 'carbs' ? `${r.value} g` : `${r.value} E`}${r.subtype ? ` ${r.subtype}` : ''}${r.created_at > p.ts ? ` (utólag beírva ${fmt(r.created_at).slice(11)})` : ''}`).join(', ')}` : ''}`
  console.log(`${fmt(p.ts)}  [${k}] ${p.title}\n                  ${ctx}${flags.length ? `\n                  ⚑ ${flags.join(' · ')}` : ''}`)
}
console.log(`\nÖsszesen ${counts.összes} riasztás/javaslat; ${Object.entries(counts).filter(([k]) => k !== 'összes').map(([k, v]) => `${k}: ${v}`).join(', ')}`)
