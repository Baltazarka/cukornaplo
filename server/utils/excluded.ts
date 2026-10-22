// Kizárt szenzorszakaszok (pl. ráfekvés okozta hamis mély): a jelölt időszak szenzorértékei (`entries.excluded = 1`)
// kimaradnak a statisztikából, a hipóeseményekből, az elemzésből, az előrejelzésből és a görbéből; a napi grafikonon
// szürkén, külön látszanak. A kézi mérést nem érinti. A szakaszok az `excluded_ranges` táblában (visszavonhatók).
import { db, MANUAL_SOURCE } from './db'
import { markDirty } from './computed'

export interface ExcludedRange { id: number; from: number; to: number }

/** Legfeljebb ekkora szakasz zárható ki egyszerre (hosszabb hibánál inkább több jelölés). */
export const EXCLUDE_MAX_SEC = 12 * 3600

export function excludedBetween(from: number, to: number): ExcludedRange[] {
  return (db().prepare('SELECT id, from_ts, to_ts FROM excluded_ranges WHERE to_ts >= ? AND from_ts < ? ORDER BY from_ts').all(from, to) as any[])
    .map((r) => ({ id: Number(r.id), from: Number(r.from_ts), to: Number(r.to_ts) }))
}

/** Új kizárt szakasz; visszaadja, hány szenzorérték került ki. */
export function addExcluded(from: number, to: number): { id: number; count: number } {
  const d = db()
  const info = d.prepare('INSERT INTO excluded_ranges (from_ts, to_ts, created_at) VALUES (?, ?, ?)').run(from, to, Math.floor(Date.now() / 1000))
  const upd = d.prepare("UPDATE entries SET excluded = 1 WHERE type = 'glucose' AND (source IS NULL OR source != ?) AND ts BETWEEN ? AND ?").run(MANUAL_SOURCE, from, to)
  markDirty()
  return { id: Number(info.lastInsertRowid), count: Number(upd.changes) }
}

/** Szakasz visszavonása: az értékei újra számítanak (ha nem esnek egy másik kizárt szakaszba). */
export function removeExcluded(id: number): boolean {
  const d = db()
  const r = d.prepare('SELECT from_ts, to_ts FROM excluded_ranges WHERE id = ?').get(id) as { from_ts: number; to_ts: number } | undefined
  if (!r) return false
  d.prepare('DELETE FROM excluded_ranges WHERE id = ?').run(id)
  d.prepare(
    `UPDATE entries SET excluded = 0 WHERE type = 'glucose' AND excluded = 1 AND ts BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM excluded_ranges x WHERE entries.ts BETWEEN x.from_ts AND x.to_ts)`,
  ).run(r.from_ts, r.to_ts)
  markDirty()
  return true
}
