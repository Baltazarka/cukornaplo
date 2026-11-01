// Előre kiszámolt eredmények tárolása (SQLite computed_cache). A nehéz elemzések (tiszta étkezések / korrekciók,
// előrejelzés-teszt) nem minden oldalbetöltéskor futnak le: a szerver éjszaka számolja újra őket, az oldal az utolsó
// kész eredményt olvassa a számolás időpontjával. Ha az eredmény régebbi a megadott ideinél, a régit adjuk vissza,
// és a háttérben újraszámoljuk (stale-while-revalidate). Az első kérésnél, ha még nincs eredmény, helyben számolunk.
import { db } from './db'

export interface Computed<T> {
  data: T
  /** A számolás időpontja (unix mp). */
  at: number
}

/**
 * A számolás (algoritmus) változata: ha a kód változik, és a tárolt eredmény régebbi változatú, nem használjuk
 * (újraszámolódik). Az elemzéseket / előrejelzés-tesztet érintő kódváltoztatásnál növeld.
 */
export const COMPUTE_VERSION = 17

const inflight = new Set<string>()
const DIRTY_KEY = 'meta:dirty'

export function readComputed<T>(key: string): Computed<T> | null {
  const row = db().prepare('SELECT at, json FROM computed_cache WHERE key = ?').get(key) as { at: number; json: string } | undefined
  if (!row) return null
  try {
    const o = JSON.parse(row.json) as { __v?: number; data?: T }
    if (o?.__v !== COMPUTE_VERSION) return null // régi kódverzióval készült: nem használjuk
    return { data: o.data as T, at: Number(row.at) }
  } catch {
    return null
  }
}

/**
 * Jelzi, hogy a mért adat / jelölés megváltozott (kézi bejegyzés, törlés, típusátállítás, import stb.): az ennél
 * régebbi tárolt eredmények a következő olvasáskor a háttérben újraszámolódnak (addig a régit adjuk).
 * Az új szenzormérések nem érvénytelenítenek: azok a napi / éjszakai frissítéssel kerülnek be.
 */
export function markDirty(): void {
  db().prepare('INSERT OR REPLACE INTO computed_cache (key, at, json) VALUES (?, ?, ?)').run(DIRTY_KEY, Math.floor(Date.now() / 1000), '{}')
}

export function dirtyAt(): number {
  const row = db().prepare('SELECT at FROM computed_cache WHERE key = ?').get(DIRTY_KEY) as { at: number } | undefined
  return row ? Number(row.at) : 0
}

export function storeComputed<T>(key: string, data: T): Computed<T> {
  const at = Math.floor(Date.now() / 1000)
  db().prepare('INSERT OR REPLACE INTO computed_cache (key, at, json) VALUES (?, ?, ?)').run(key, at, JSON.stringify({ __v: COMPUTE_VERSION, data }))
  return { data, at }
}

/** Törli a tárolt eredményeket (előtaggal csak az azzal kezdődőket): adat vagy beállítás változása után. */
export function clearComputed(prefix = ''): void {
  // Az éjszakai jelző és az adatváltozás-jelző megmarad (különben az éjszakai számolás újra lefutna).
  db().prepare("DELETE FROM computed_cache WHERE key LIKE ? AND key NOT IN ('nightly', 'meta:dirty')").run(prefix.replace(/[%_]/g, '') + '%')
}

/** Azonnali (szinkron) számolás és tárolás. */
export function computeNow<T>(key: string, fn: () => T): Computed<T> {
  return storeComputed(key, fn())
}

/** A tárolt eredmény; régi eredménynél háttérszámolás indul, hiányzónál helyben számol. */
export function getComputed<T>(key: string, ttlSec: number, fn: () => T): Computed<T> {
  const row = readComputed<T>(key)
  if (!row) return computeNow(key, fn)
  const now = Math.floor(Date.now() / 1000)
  if ((now - row.at > ttlSec || row.at < dirtyAt()) && !inflight.has(key)) {
    inflight.add(key)
    setTimeout(() => {
      try {
        computeNow(key, fn)
      } catch (e) {
        console.error('[computed]', key, e)
      } finally {
        inflight.delete(key)
      }
    }, 50)
  }
  return row
}
