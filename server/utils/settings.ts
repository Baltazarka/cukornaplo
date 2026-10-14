// Beállítások ugyanabban a settings.json-ban, amit a PHP is ír (jelszó-hash, api_token, carelink állapot).
// Atomi írás (ideiglenes fájl + átnevezés), hogy párhuzamos íráskor ne sérüljön a fájl.
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Az adatmappa futásidőben: a DATA_DIR env felülírja a beégetett alapértelmezést (fontos Dockerben). */
export function dataDir(): string {
  return process.env.DATA_DIR || (useRuntimeConfig().dataDir as string)
}

function file(): string {
  return join(dataDir(), 'settings.json')
}

// A beállítások a memóriában maradnak: a számolások (pl. az előrejelzés-teszt) beállításonként, sokezerszer
// olvasnák, és a fájl minden olvasása lemezművelet + JSON-feldolgozás. Legfeljebb másodpercenként egyszer nézzük meg,
// változott-e a fájl (módosítási idő), és csak akkor olvassuk újra. A visszaadott objektumot ne módosítsd: közös.
const RECHECK_MS = 1000
let cache: { path: string; data: Record<string, any>; mtimeMs: number; checkedAt: number } | null = null

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return -1
  }
}

export function settings(): Record<string, any> {
  const path = file()
  const now = Date.now()
  if (cache && cache.path === path) {
    if (now - cache.checkedAt < RECHECK_MS) return cache.data
    if (mtimeOf(path) === cache.mtimeMs) {
      cache.checkedAt = now
      return cache.data
    }
  }
  const mtimeMs = mtimeOf(path)
  let data: Record<string, any> = {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && typeof parsed === 'object') data = parsed
  } catch { /* nincs vagy sérült fájl: üres beállítások */ }
  cache = { path, data, mtimeMs, checkedAt: now }
  return data
}

/** Írás után a memóriabeli másolat a most kiírt tartalom (a hívó objektumaitól független másolat). */
function remember(path: string, data: Record<string, any>): void {
  cache = { path, data: JSON.parse(JSON.stringify(data)), mtimeMs: mtimeOf(path), checkedAt: Date.now() }
}

export function setting<T = any>(key: string, def: T | null = null): T | null {
  const s = settings()
  return key in s ? s[key] : def
}

export function saveSettings(changes: Record<string, any>): void {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const merged = { ...settings(), ...changes }
  // null értékek törlik a kulcsot (mint a PHP array_merge után a kézi null-ozás).
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k]
  const tmp = file() + '.tmp' + process.pid
  writeFileSync(tmp, JSON.stringify(merged, null, 2))
  renameSync(tmp, file())
  remember(file(), merged)
}

export function newToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Teljes beállítás-törlés (gyári visszaállítás): üres settings.json. */
export function resetSettings(): void {
  const tmp = file() + '.tmp' + process.pid
  writeFileSync(tmp, '{}')
  renameSync(tmp, file())
  remember(file(), {})
}
