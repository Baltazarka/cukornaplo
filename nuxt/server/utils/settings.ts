// Beállítások ugyanabban a settings.json-ban, amit a PHP is ír (jelszó-hash, api_token, carelink állapot).
// Atomi írás (ideiglenes fájl + átnevezés), hogy párhuzamos íráskor ne sérüljön a fájl.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Az adatmappa futásidőben: a DATA_DIR env felülírja a beégetett alapértelmezést (fontos Dockerben). */
export function dataDir(): string {
  return process.env.DATA_DIR || (useRuntimeConfig().dataDir as string)
}

function file(): string {
  return join(dataDir(), 'settings.json')
}

export function settings(): Record<string, any> {
  try {
    const data = JSON.parse(readFileSync(file(), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
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
}

export function newToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Teljes beállítás-törlés (gyári visszaállítás): üres settings.json. */
export function resetSettings(): void {
  const tmp = file() + '.tmp' + process.pid
  writeFileSync(tmp, '{}')
  renameSync(tmp, file())
}
