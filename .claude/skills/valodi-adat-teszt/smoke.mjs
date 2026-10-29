// Füstpróba egy futó, ideiglenes Cukornapló-szerveren (valódi adatmásolattal):
//   node .claude/skills/valodi-adat-teszt/smoke.mjs [port=3994] [nap=ÉÉÉÉ-HH-NN]
// Véletlen jelszót állít be (helyi kérésnek nem kell beállító kód), bejelentkezik, és végigkéri a fontos végpontokat.
// Csak státuszt, méretet és pár kulcsmezőt ír ki – egészségügyi adatot nem.
const port = process.argv[2] || '3994'
const B = `http://127.0.0.1:${port}`
const day = process.argv[3] || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })
const pw = crypto.randomUUID()
const json = { 'content-type': 'application/json' }

let r = await fetch(`${B}/api/auth/setup`, { method: 'POST', headers: json, body: JSON.stringify({ password: pw, password2: pw }) })
if (r.status !== 200) console.log(`setup: ${r.status} (ha már van jelszó, töröld a password_hash-t a másolat settings.json-jából)`)
r = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ password: pw, remember: true }) })
if (r.status !== 200) { console.log(`login: ${r.status} – leállok`); process.exit(1) }
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const GET = [
  '/api/auth/state', '/api/version', '/api/status', '/api/settings', '/api/therapy', `/api/day?date=${day}`,
  '/api/agp?days=14', '/api/analysis?days=30', `/api/report?end=${day}&days=7`, '/api/hypo?days=14', '/api/lab',
  '/api/shifts', '/api/profile', '/api/predict', '/api/predict-accuracy', '/api/bolus-context', '/api/tab',
  '/api/notify/settings', '/api/absorption/defaults', '/api/share/list', '/api/widget-config', '/api/export',
]
let bad = 0
for (const path of GET) {
  const t = Date.now()
  const res = await fetch(B + path, { headers: { cookie } })
  const body = Buffer.from(await res.arrayBuffer())
  const ms = Date.now() - t
  let note = ''
  if (res.headers.get('content-type')?.includes('json')) {
    try {
      const j = JSON.parse(body.toString())
      if (j && j.ok === false) note = ` hiba: ${j.error ?? ''}`
    } catch { note = ' (érvénytelen JSON)' }
  }
  const ok = res.status < 400 && !note
  if (!ok) bad++
  console.log(`${ok ? 'OK ' : 'HIBA'} ${res.status} ${String(ms).padStart(5)} ms ${String(body.length).padStart(8)} B  ${path}${note}`)
}
// A widget-végpont saját X-Token-nel megy; itt csak azt nézzük, hogy nem 500.
const w = await fetch(`${B}/api/widget`, { method: 'POST' })
console.log(`${w.status >= 500 ? 'HIBA' : 'OK '} ${w.status} /api/widget (token nélkül: 401/403 várható)`)
if (w.status >= 500) bad++
console.log(bad ? `\n${bad} hibás végpont.` : '\nMinden végpont rendben.')
process.exit(bad ? 1 : 0)
