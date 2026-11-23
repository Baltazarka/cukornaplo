// Szintetikus demó-adat egy üres DATA_DIR-hez (pl. ./data-dev): NEM valódi egészségügyi adat, csak a felület
// kipróbálásához / képernyőképekhez. Használat:
//   mkdir data-dev && node scripts/seed-demo.mjs ./data-dev
// Utána: DATA_DIR=./data-dev CARELINK_INTERVAL=0 pnpm dev, jelszó: cukor1234
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('Használat: node scripts/seed-demo.mjs <adatmappa>')
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
const dbFile = join(dir, 'diabetes.sqlite')
if (existsSync(dbFile)) {
  console.error(`Már van adatbázis itt: ${dbFile} (üres mappát adj meg)`)
  process.exit(1)
}

const d = new DatabaseSync(dbFile)
d.exec(`CREATE TABLE entries (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL,
  subtype TEXT, source TEXT, created_at INTEGER NOT NULL, fat REAL, protein REAL, calc TEXT,
  excluded INTEGER NOT NULL DEFAULT 0, UNIQUE (type, ts, value)
)`)
const ins = d.prepare('INSERT INTO entries (type, ts, value, subtype, source, created_at, fat, protein) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const todayStart = now - (now % DAY) - new Date().getTimezoneOffset() * 60 // laza, a demóhoz elég
const DAYS = 10
const start = todayStart - DAYS * DAY

// Napi minta: étkezések reggel 8, délben 13, este 19; enyhe, realisztikus hullámzással.
function daySeries(dayStart) {
  const meals = [{ h: 8, carbs: 35, fatty: false }, { h: 13, carbs: 55, fatty: false }, { h: 19, carbs: 45, fatty: true }]
  let bg = 6.5 + (Math.random() - 0.5)
  for (let m = 0; m < DAY; m += 300) {
    const ts = dayStart + m
    const hour = m / 3600
    // Étkezés hatása: a következő ~2.5 órában emelkedés, utána lassú visszaesés a korrekcióval.
    let drive = (6.2 - bg) * 0.03
    for (const meal of meals) {
      const dt = hour - meal.h
      if (dt >= -0.1 && dt < 3) drive += Math.exp(-((dt - 0.6) ** 2) / 0.6) * (meal.carbs / 40)
    }
    bg = Math.max(3.8, Math.min(14, bg + drive + (Math.random() - 0.5) * 0.15))
    ins.run('glucose', ts, Math.round(bg * 10) / 10, null, 'CareLink', ts)
  }
  for (const meal of meals) {
    const mealTs = dayStart + meal.h * 3600
    ins.run('carbs', mealTs, meal.carbs, meal.fatty ? 'fatty' : null, 'manual', mealTs, meal.fatty ? 18 : null, meal.fatty ? 20 : null)
    const dose = Math.round((meal.carbs / 10) * 2) / 2
    ins.run('insulin', mealTs + 60, dose, 'meal', 'manual', mealTs + 60, null, null)
  }
  // Esti bázis (Toujeo).
  ins.run('insulin', dayStart + 21 * 3600, 14, 'basal', 'manual', dayStart + 21 * 3600, null, null)
  // Néha egy korrekció kora délután.
  if (Math.random() > 0.5) ins.run('insulin', dayStart + 16 * 3600, 2, 'correction', 'manual', dayStart + 16 * 3600, null, null)
}
for (let dayStart = start; dayStart < todayStart; dayStart += DAY) daySeries(dayStart)
// A mai nap eddig eltelt része is, hogy a főoldal ne legyen üres.
{
  const meals = [{ h: 8, carbs: 35, fatty: false }, { h: 13, carbs: 55, fatty: false }]
  let bg = 6.2
  for (let m = 0; m < now - todayStart; m += 300) {
    const ts = todayStart + m
    const hour = m / 3600
    let drive = (6.2 - bg) * 0.03
    for (const meal of meals) {
      const dt = hour - meal.h
      if (dt >= -0.1 && dt < 3) drive += Math.exp(-((dt - 0.6) ** 2) / 0.6) * (meal.carbs / 40)
    }
    bg = Math.max(3.8, Math.min(14, bg + drive + (Math.random() - 0.5) * 0.15))
    ins.run('glucose', ts, Math.round(bg * 10) / 10, null, 'CareLink', ts)
  }
  for (const meal of meals) {
    if (meal.h * 3600 > now - todayStart) continue
    const mealTs = todayStart + meal.h * 3600
    ins.run('carbs', mealTs, meal.carbs, null, 'manual', mealTs, null, null)
    ins.run('insulin', mealTs + 60, Math.round((meal.carbs / 10) * 2) / 2, 'meal', 'manual', mealTs + 60, null, null)
  }
}
// Egy jegyzet, ízelítőnek.
d.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, tags TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`)
d.prepare('INSERT INTO notes (ts, tags, text, created_at) VALUES (?, ?, ?, ?)').run(todayStart - 2 * DAY + 10 * 3600, 'sport', 'Futás, 40 perc', now)
// Laboreredmény (HbA1c), a Labor kártyához.
d.exec(`CREATE TABLE lab_results (id INTEGER PRIMARY KEY, date TEXT NOT NULL, hba1c REAL NOT NULL, created_at INTEGER NOT NULL)`)
const ymd = (ts) => new Date(ts * 1000).toISOString().slice(0, 10)
d.prepare('INSERT INTO lab_results (date, hba1c, created_at) VALUES (?, ?, ?)').run(ymd(todayStart - 100 * DAY), 7.9, now)
d.prepare('INSERT INTO lab_results (date, hba1c, created_at) VALUES (?, ?, ?)').run(ymd(todayStart - 10 * DAY), 7.2, now)
d.close()

// A jelszót az első belépéskor a /setup oldal állítja be (bcrypt-hash kell, ide nem írjuk).
const settings = {
  therapy: {
    mealMode: 'carbs', bolusInsulin: 'novorapid', basalInsulin: 'toujeo', maxBolus: 20, actionMinutes: 240,
    fpuPercent: 50, fpuTiming: 'later', byTimeOfDay: true,
    segments: [
      { start: '07:00', target: 6.0, isf: 2.5, icr: 10 },
      { start: '11:00', target: 6.0, isf: 2.2, icr: 9 },
      { start: '17:00', target: 6.0, isf: 2.5, icr: 10 },
      { start: '22:00', target: 6.5, isf: 3, icr: 12 },
    ],
    source: 'manual', updatedAt: now,
  },
  range_low: 3.9, range_high: 10,
  notify: { doseStep: 1 },
  autopilot: { enabled: true, basalMicroEnabled: false },
}
writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))

console.log(`Kész: ${DAYS} nap szintetikus adat a ${dir} mappában.`)
console.log('Indítás: DATA_DIR=' + dir + ' CARELINK_INTERVAL=0 pnpm dev')
console.log('Első belépéskor állíts be jelszót (/setup) – demóhoz pl. cukor1234.')
