// Cukornapló widget a Scriptable apphoz (iPhone). Kezdőképernyős (kicsi) és zárképernyős widget.
// A kinézetet (elemek, színek, méret) a Cukornapló Telefon oldalán állítod be; ezt a szkriptet nem kell módosítani.
// Telepítés: a Telefon oldalon a „Kitöltött szkript másolása” gombbal másold ide, a címet és a kulcsot kitölti.
// A KULCS az X-Token; a kitöltött szkriptet ne tedd fel sehova.
const URL_BASE = 'https://vc.baltazarka.com'
const KULCS = 'IDE_AZ_X_TOKEN'

const ALAP = {
  showTrend: true, showCob: true, showIob: true, showLine: true, showRange: true, showAge: true,
  lineHours: 3, fontSize: 38,
  colors: { inRange: '#ff7ad9', low: '#ff5d5d', high: '#ffb454', cob: '#2fbf8a', iob: '#4a8cff', bg: '#0f1115' },
}
const HALK = new Color('#8a93a3')

async function adat() {
  const req = new Request(`${URL_BASE}/api/widget`)
  req.method = 'POST'
  req.headers = { 'X-Token': KULCS }
  req.timeoutInterval = 15
  const j = await req.loadJSON()
  if (!j || !j.ok) throw new Error((j && j.error) || 'Hiba')
  j.config = Object.assign({}, ALAP, j.config, { colors: Object.assign({}, ALAP.colors, (j.config || {}).colors) })
  return j
}

function nyil(t) {
  if (!t) return ''
  if (t.dir === 0) return '→'
  const f = t.dir > 0
  return t.level === 1 ? (f ? '↗' : '↘') : t.level === 2 ? (f ? '↑' : '↓') : f ? '⇈' : '⇊'
}
const szam = (v, d) => v.toLocaleString('hu-HU', { minimumFractionDigits: d, maximumFractionDigits: d })
const iobSzoveg = (v) => (v == null ? '–' : v.toLocaleString('hu-HU', { maximumFractionDigits: 1 }))
function szin(d) {
  const c = d.config.colors
  const v = d.glucose.v
  return new Color(v < d.range.low ? c.low : v > d.range.high ? c.high : c.inRange)
}

// Trendvonal: a céltartomány sávja + a vércukorgörbe az elmúlt órákból.
function vonal(d, w, h, szinez) {
  const ctx = new DrawContext()
  ctx.size = new Size(w, h)
  ctx.opaque = false
  ctx.respectScreenScale = true
  const pts = d.series
  if (pts.length < 2) return ctx.getImage()
  const perc = d.config.lineHours * 60
  const vals = pts.map((p) => p[1])
  const lo = Math.min(d.range.low - 0.5, ...vals)
  const hi = Math.max(d.range.high + 0.5, ...vals)
  const kt = 5 // kis tartalék a jobb szélen, hogy az utolsó pont ne csússzon ki
  const x = (m) => w - kt - (m / perc) * (w - kt)
  const y = (v) => h - ((v - lo) / (hi - lo)) * h
  const sz = szinez ? szin(d) : Color.white()
  if (d.config.showRange) {
    const sav = new Path()
    sav.addRect(new Rect(0, y(d.range.high), w, y(d.range.low) - y(d.range.high)))
    ctx.addPath(sav)
    ctx.setFillColor(new Color('#ffffff', 0.1))
    ctx.fillPath()
  }
  const p = new Path()
  pts.forEach(([m, v], i) => (i === 0 ? p.move(new Point(x(m), y(v))) : p.addLine(new Point(x(m), y(v)))))
  ctx.addPath(p)
  ctx.setStrokeColor(sz)
  ctx.setLineWidth(3)
  ctx.strokePath()
  const [m0, v0] = pts[pts.length - 1]
  const dot = new Path()
  dot.addEllipse(new Rect(x(m0) - 4, y(v0) - 4, 8, 8))
  ctx.addPath(dot)
  ctx.setFillColor(sz)
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
  w.backgroundColor = new Color(ALAP.colors.bg)
  szoveg(w, 'Cukornapló', 12, HALK, true)
  szoveg(w, String(msg), 11, new Color(ALAP.colors.low), false)
  return w
}

function kicsi(d) {
  const c = d.config
  const w = new ListWidget()
  w.backgroundColor = new Color(c.colors.bg)
  w.setPadding(10, 12, 10, 12)
  const fent = w.addStack()
  fent.centerAlignContent()
  const g = fent.addStack()
  g.bottomAlignContent()
  szoveg(g, szam(d.glucose.v, 1), c.fontSize, szin(d), true)
  if (c.showTrend) szoveg(g, ' ' + nyil(d.trend), Math.round(c.fontSize * 0.74), szin(d), true)
  fent.addSpacer()
  if (c.showCob || c.showIob) {
    const jobb = fent.addStack()
    jobb.layoutVertically()
    if (c.showCob) szoveg(jobb, 'CH ' + d.cob + ' g', 14, new Color(c.colors.cob), true).rightAlignText()
    if (c.showCob && c.showIob) jobb.addSpacer(2)
    if (c.showIob) szoveg(jobb, 'B ' + iobSzoveg(d.iob) + ' E', 14, new Color(c.colors.iob), true).rightAlignText()
  }
  w.addSpacer(2)
  if (c.showLine) {
    const kep = w.addImage(vonal(d, 270, 80, true))
    kep.imageSize = new Size(128, 44)
  }
  const lab = szoveg(w, 'mmol/L' + (c.showAge ? ' · ' + d.glucose.ageMin + ' perce' : ''), 10, c.showAge && d.glucose.ageMin > 15 ? new Color(c.colors.high) : HALK, false)
  return w
}

function zar(d, tipus) {
  const c = d.config
  const w = new ListWidget()
  const nyilSz = c.showTrend ? ' ' + nyil(d.trend) : ''
  const reszek = []
  if (c.showCob) reszek.push('CH ' + d.cob + ' g')
  if (c.showIob) reszek.push('B ' + iobSzoveg(d.iob) + ' E')
  if (tipus === 'accessoryInline') {
    w.addText([szam(d.glucose.v, 1) + ' mmol/L' + nyilSz].concat(reszek).join(' · '))
    return w
  }
  if (tipus === 'accessoryCircular') {
    const s = w.addStack()
    s.layoutVertically()
    s.centerAlignContent()
    const t1 = s.addText(szam(d.glucose.v, 1))
    t1.font = Font.boldSystemFont(16)
    if (c.showTrend) {
      const t2 = s.addText(nyil(d.trend))
      t2.font = Font.boldSystemFont(14)
    }
    const t3 = s.addText('mmol/L')
    t3.font = Font.systemFont(8)
    return w
  }
  // accessoryRectangular
  const s = w.addStack()
  s.centerAlignContent()
  const bal = s.addStack()
  bal.layoutVertically()
  const t1 = bal.addText(szam(d.glucose.v, 1) + nyilSz)
  t1.font = Font.boldSystemFont(22)
  const t0 = bal.addText('mmol/L')
  t0.font = Font.systemFont(9)
  s.addSpacer()
  if (reszek.length) {
    const r = s.addStack()
    r.layoutVertically()
    for (const t of reszek) {
      const e = r.addText(t)
      e.font = Font.boldSystemFont(12)
    }
  }
  if (c.showLine) {
    const kep = w.addImage(vonal(d, 280, 50, false))
    kep.imageSize = new Size(140, 22)
  }
  return w
}

let w
let tap = URL_BASE
try {
  const d = await adat()
  if (!d.glucose) throw new Error('Nincs friss érték.')
  tap = URL_BASE + (d.tapPath || '/')
  const f = config.widgetFamily
  w = f && f.startsWith('accessory') ? zar(d, f) : kicsi(d)
  // az iOS ezt csak javaslatként kezeli (kb. 5 percre kérjük)
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000)
} catch (e) {
  w = hibaWidget(e.message || e)
}
// Koppintásra a Cukornapló oldala nyílik meg (Safariban; iOS-en a kezdőképernyős webappot linkkel nem lehet indítani).
w.url = tap
if (config.runsInWidget) Script.setWidget(w)
else await w.presentSmall()
Script.complete()
