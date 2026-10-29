// A vércukor-audit bemenete: az utolsó N nap adata és napi statisztika egy letöltött másolatból.
//   node .claude/skills/cukor-audit/dump.mjs <export.sqlite> <kimeneti mappa (scratchpad)> [napok=2] [összevetés napjai=7]
// Kimenet: adat.txt (beállítások titkok nélkül, inzulin/CH, jegyzetek, push napló, kizárt szakaszok, 5 perces vércukor)
// és stats.txt (napi átlag/SD/CV/TIR/hipó, napi bólus/bázis/CH, a két időszak összesítve). A kimenet egészségügyi adat:
// csak a scratchpadbe kerüljön, és az audit végén töröld.
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync, mkdirSync } from 'node:fs'

const [db, out, daysArg = '2', cmpArg = '7'] = process.argv.slice(2)
if (!db || !out) { console.error('Használat: node dump.mjs <export.sqlite> <kimeneti mappa> [napok] [összevetés napjai]'); process.exit(1) }
const days = Number(daysArg), cmpDays = Number(cmpArg)
mkdirSync(out, { recursive: true })
const d = new DatabaseSync(db, { readOnly: true })
const TZ = 'Europe/Budapest'
const fmt = (ts) => new Date(ts * 1000).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16)
// Helyi éjfél (DST-helyesen): a dátum 12:00-ja UTC-ben, onnan vissza a helyi óra:perc.
const midnight = (ymd) => {
  const noon = Date.parse(`${ymd}T12:00:00Z`) / 1000
  const [h, m] = new Date(noon * 1000).toLocaleTimeString('sv-SE', { timeZone: TZ }).split(':').map(Number)
  return noon - (h * 3600 + m * 60)
}
const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
const ymdOff = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const lastTs = Number(d.prepare("SELECT MAX(ts) m FROM entries WHERE type='glucose'").get().m)
const endYmd = new Date(lastTs * 1000).toLocaleDateString('sv-SE', { timeZone: TZ })
const fromYmd = ymdOff(endYmd, -(days - 1) - (endYmd === today ? 1 : 0))
const from = midnight(fromYmd)
const cmpFrom = midnight(ymdOff(fromYmd, -cmpDays))
const ctx = from - 12 * 3600

let s = `# Audit: ${fromYmd} 00:00 – ${fmt(lastTs)} (${TZ})\n\n## Beállítások (titkok nélkül)\n`
for (const r of d.prepare('SELECT key, json FROM export_settings').all()) {
  if (/password|secret|key|token|carelink|push|vapid|setup|mail|subscri/i.test(r.key)) continue
  s += `${r.key}: ${r.json}\n`
}
s += '\nMegjegyzés: a therapy.segments `icr` értéke gramm CH / egység (bólus = CH ÷ icr), az `isf` mmol/L / egység.\n'
s += '\n## Inzulin és CH (idő, típus, érték, subtype, source, zsír, fehérje) – az előző nap délutánjától\n'
for (const r of d.prepare("SELECT * FROM entries WHERE type!='glucose' AND ts>=? ORDER BY ts").all(ctx))
  s += `${fmt(r.ts)}\t${r.type}\t${r.value}\t${r.subtype ?? ''}\t${r.source ?? ''}\t${r.fat ?? ''}\t${r.protein ?? ''}\n`
s += '\n## Jegyzetek\n'
for (const r of d.prepare('SELECT * FROM notes WHERE ts>=? ORDER BY ts').all(ctx)) s += `${fmt(r.ts)}\t${r.tags}\t${r.text}\n`
s += '\n## Push napló\n'
for (const r of d.prepare('SELECT * FROM push_log WHERE ts>=? ORDER BY ts').all(ctx)) s += `${fmt(r.ts)}\t${r.title}\t${r.body}\n`
s += '\n## Kizárt szenzorszakaszok\n'
for (const r of d.prepare('SELECT * FROM excluded_ranges WHERE to_ts>=?').all(cmpFrom)) s += `${fmt(r.from_ts)} – ${fmt(r.to_ts)}\n`
s += '\n## Vércukor (mmol/L, forrás, KIZÁRT jelölés)\n'
for (const r of d.prepare("SELECT ts,value,source,excluded FROM entries WHERE type='glucose' AND ts>=? ORDER BY ts").all(ctx))
  s += `${fmt(r.ts)}\t${r.value}\t${r.source ?? ''}${r.excluded ? '\tKIZÁRT' : ''}\n`
writeFileSync(`${out}/adat.txt`, s)

const stat = (a, b) => {
  const v = d.prepare("SELECT value FROM entries WHERE type='glucose' AND excluded=0 AND IFNULL(source,'')!='manual' AND ts>=? AND ts<?").all(a, b).map((r) => r.value)
  if (!v.length) return 'nincs adat'
  const n = v.length, avg = v.reduce((x, y) => x + y, 0) / n
  const sd = Math.sqrt(v.reduce((x, y) => x + (y - avg) ** 2, 0) / n)
  const p = (f) => ((v.filter(f).length / n) * 100).toFixed(1)
  return `n=${n} átlag=${avg.toFixed(1)} SD=${sd.toFixed(1)} CV=${((sd / avg) * 100).toFixed(0)}% TIR(3,9–10)=${p((x) => x >= 3.9 && x <= 10)}% <3,9=${p((x) => x < 3.9)}% <3,0=${p((x) => x < 3)}% >10=${p((x) => x > 10)}% >13,9=${p((x) => x > 13.9)}%`
}
const q = (w, a, b) => d.prepare(`SELECT ROUND(SUM(value),1) s, COUNT(*) n FROM entries WHERE ${w} AND ts>=? AND ts<?`).get(a, b)
let c = '# Napi statisztika (szenzor, kizárt és kézi mérés nélkül)\n'
let t = ymdOff(fromYmd, -cmpDays)
while (t <= endYmd) {
  const a = midnight(t), b = midnight(ymdOff(t, 1))
  const bo = q("type='insulin' AND IFNULL(subtype,'')!='basal'", a, b), ba = q("type='insulin' AND subtype='basal'", a, b), ch = q("type='carbs'", a, b)
  c += `${t}${t === fromYmd ? ' ◀ audit kezdete' : ''}: ${stat(a, b)} | bólus ${bo.s ?? 0} E (${bo.n} db), bázis ${ba.s ?? 0} E, CH ${ch.s ?? 0} g (${ch.n} db)\n`
  t = ymdOff(t, 1)
}
c += `\nÖsszevetés (${cmpDays} nap előtte): ${stat(cmpFrom, from)}\nAudit időszak: ${stat(from, lastTs + 1)}\n`
c += '\nFigyelem: a bázis 0 E korábbi napokon jelentheti azt is, hogy nem volt naplózva (az automatikus beírás előtt).\n'
writeFileSync(`${out}/stats.txt`, c)
console.log(c)
