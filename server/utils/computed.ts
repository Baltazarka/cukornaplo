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

const inflight = new Set<string>()

export function readComputed<T>(key: string): Computed<T> | null {
  const row = db().prepare('SELECT at, json FROM computed_cache WHERE key = ?').get(key) as { at: number; json: string } | undefined
  if (!row) return null
  try {
    return { data: JSON.parse(row.json) as T, at: Number(row.at) }
  } catch {
    return null
  }
}

export function storeComputed<T>(key: string, data: T): Computed<T> {
  const at = Math.floor(Date.now() / 1000)
  db().prepare('INSERT OR REPLACE INTO computed_cache (key, at, json) VALUES (?, ?, ?)').run(key, at, JSON.stringify(data))
  return { data, at }
}

/** Törli a tárolt eredményeket (előtaggal csak az azzal kezdődőket): adat vagy beállítás változása után. */
export function clearComputed(prefix = ''): void {
  db().prepare('DELETE FROM computed_cache WHERE key LIKE ?').run(prefix.replace(/[%_]/g, '') + '%')
}

/** Azonnali (szinkron) számolás és tárolás. */
export function computeNow<T>(key: string, fn: () => T): Computed<T> {
  return storeComputed(key, fn())
}

/** A tárolt eredmény; régi eredménynél háttérszámolás indul, hiányzónál helyben számol. */
export function getComputed<T>(key: string, ttlSec: number, fn: () => T): Computed<T> {
  const row = readComputed<T>(key)
  if (!row) return computeNow(key, fn)
  if (Math.floor(Date.now() / 1000) - row.at > ttlSec && !inflight.has(key)) {
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
