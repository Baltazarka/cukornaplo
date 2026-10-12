// Cukornapló widget a Scriptable apphoz (iPhone). Kezdőképernyős (kicsi / közepes) és zárképernyős widget.
// Telepítés: Scriptable → új szkript → ide másold, a két beállítást (URL, KULCS) töltsd ki.
// A KULCS ugyanaz, mint az Apple Parancsokban az X-Token (Beállítások → API-kulcs). Ez a fájl nem tartalmazza,
// a kitöltött szkriptet ne tedd fel sehova.
const URL_BASE = 'https://vc.baltazarka.com'
const KULCS = 'IDE_AZ_X_TOKEN'

const SZIN = { hatter: new Color('#0f1115'), cel: new Color('#ff7ad9'), alacsony: new Color('#ff5d5d'), magas: new Color('#ffb454'), ch: new Color('#2fbf8a'), ins: new Color('#4a8cff'), halk: new Color('#8a93a3') }

async function adat() {
  const req = new Request(`${URL_BASE}/api/widget`)
  req.method = 'POST'
  req.headers = { 'X-Token': KULCS }
  req.timeoutInterval = 15
  const j = await req.loadJSON()
  if (!j || !j.ok) throw new Error(j?.error || 'Hiba')
  return j
}

const NYIL = { 0: '→', 1: '↗', 2: '↑', 3: '⇈' }
function nyil(t) {
  if (!t) return ''
  if (t.dir === 0) return '→'
  const f = t.dir > 0
  return t.level === 1 ? (f ? '↗' : '↘') : t.level === 2 ? (f ? '↑' : '↓') : f ? '⇈' : '⇊'
}
const ertek = (v) => v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function szin(d) {
  const v = d.glucose.v
  return v < d.range.low ? SZIN.alacsony : v > d.range.high ? SZIN.magas : SZIN.cel
}

// Trendvonal: a céltartomány sávja + a vércukorgörbe az elmúlt 3 órából.
function vonal(d, w, h) {
  const ctx = new DrawContext()
  ctx.size = new Size(w, h)
  ctx.opaque = false
  ctx.respectScreenScale = true
  const pts = d.series
  if (pts.length < 2) return ctx.getImage()
  const perc = 180
  const vals = pts.map((p) => p[1])
  const lo = Math.min(d.range.low - 0.5, ...vals)
  const hi = Math.max(d.range.high + 0.5, ...vals)
  const x = (m) => w - (m / perc) * w
  const y = (v) => h - ((v - lo) / (hi - lo)) * h
  // céltartomány
  const sav = new Path()
  sav.addRect(new Rect(0, y(d.range.high), w, y(d.range.low) - y(d.range.high)))
  ctx.addPath(sav)
  ctx.setFillColor(new Color('#ffffff', 0.08))
  ctx.fillPath()
  // görbe
  const p = new Path()
  pts.forEach(([m, v], i) => (i === 0 ? p.move(new Point(x(m), y(v))) : p.addLine(new Point(x(m), y(v)))))
  ctx.addPath(p)
  ctx.setStrokeColor(szin(d))
  ctx.setLineWidth(3)
  ctx.strokePath()
  // utolsó pont
  const [m0, v0] = pts[pts.length - 1]
  const dot = new Path()
  dot.addEllipse(new Rect(x(m0) - 4, y(v0) - 4, 8, 8))
  ctx.addPath(dot)
  ctx.setFillColor(szin(d))
  ctx.fillPath()
  return ctx.getImage()
}

function szoveg(stack, t, meret, szin, bold) {
  const e = stack.addText(t)
  e.font = bold ? Font.boldSystemFont(meret) : Font.systemFont(meret)
  e.textColor = szin
  return e
}

function hibaWidget(msg) {
  const w = new ListWidget()
  w.backgroundColor = SZIN.hatter
  szoveg(w, 'Cukornapló', 12, SZIN.halk, true)
  szoveg(w, String(msg), 11, SZIN.alacsony, false)
  return w
}

function kicsi(d) {
  const w = new ListWidget()
  w.backgroundColor = SZIN.hatter
  w.setPadding(10, 12, 10, 12)
  const fent = w.addStack()
  fent.centerAlignContent()
  const bal = fent.addStack()
  bal.layoutVertically()
  const g = bal.addStack()
  g.bottomAlignContent()
  szoveg(g, ertek(d.glucose.v), 38, szin(d), true)
  szoveg(g, ' ' + nyil(d.trend), 28, szin(d), true)
  fent.addSpacer()
  const jobb = fent.addStack()
  jobb.layoutVertically()
  jobb.addSpacer(2)
  szoveg(jobb, 'CH ' + d.cob, 15, SZIN.ch, true).rightAlignText()
  jobb.addSpacer(2)
  szoveg(jobb, 'B ' + (d.iob == null ? '–' : ertek(d.iob).replace(',0', '')), 15, SZIN.ins, true).rightAlignText()
  w.addSpacer(2)
  const kep = w.addImage(vonal(d, 300, 80))
  kep.imageSize = new Size(136, 44)
  const k = szoveg(w, d.glucose.ageMin + ' perce', 10, d.glucose.ageMin > 15 ? SZIN.magas : SZIN.halk, false)
  return w
}

function zar(d, tipus) {
  const w = new ListWidget()
  if (tipus === 'accessoryInline') {
    w.addText(`${ertek(d.glucose.v)} ${nyil(d.trend)} · CH ${d.cob} · B ${d.iob == null ? '–' : ertek(d.iob)}`)
    return w
  }
  if (tipus === 'accessoryCircular') {
    const s = w.addStack()
    s.layoutVertically()
    s.centerAlignContent()
    const t1 = s.addText(ertek(d.glucose.v))
    t1.font = Font.boldSystemFont(16)
    const t2 = s.addText(nyil(d.trend))
    t2.font = Font.boldSystemFont(14)
    return w
  }
  // accessoryRectangular
  const s = w.addStack()
  s.centerAlignContent()
  const t1 = s.addText(`${ertek(d.glucose.v)} ${nyil(d.trend)}`)
  t1.font = Font.boldSystemFont(22)
  s.addSpacer()
  const r = s.addStack()
  r.layoutVertically()
  const c = r.addText('CH ' + d.cob); c.font = Font.boldSystemFont(12)
  const b = r.addText('B ' + (d.iob == null ? '–' : ertek(d.iob))); b.font = Font.boldSystemFont(12)
  const kep = w.addImage(vonal(d, 300, 50))
  kep.imageSize = new Size(150, 22)
  return w
}

let w
try {
  const d = await adat()
  if (!d.glucose) throw new Error('Nincs friss érték.')
  const f = config.widgetFamily
  w = f && f.startsWith('accessory') ? zar(d, f) : kicsi(d)
  // az iOS ezt csak javaslatként kezeli (kb. 5 percre kérjük)
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000)
} catch (e) {
  w = hibaWidget(e.message || e)
}
if (config.runsInWidget) Script.setWidget(w)
else await w.presentSmall()
Script.complete()
