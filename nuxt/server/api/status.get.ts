// Tárolt adatok összesítése és az utolsó adatfogadás (a napi nézet / beállítás figyeli).
import { db } from '../utils/db'

export default defineEventHandler(() => {
  const counts = { glucose: 0, insulin: 0, carbs: 0 }
  const rows = db().prepare('SELECT type, COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM entries GROUP BY type').all() as any[]
  const ranges: Record<string, { count: number; first: number | null; last: number | null }> = {}
  for (const r of rows) {
    counts[r.type as keyof typeof counts] = Number(r.c)
    ranges[r.type] = { count: Number(r.c), first: r.mn ? Number(r.mn) : null, last: r.mx ? Number(r.mx) : null }
  }
  const last = setting<any>('last_ingest')
  return {
    ok: true,
    counts,
    ranges,
    total: counts.glucose + counts.insulin + counts.carbs,
    last: last
      ? {
          at: Number(last.at),
          via: last.via,
          received: last.received ?? null,
          inserted: Number(last.inserted),
          duplicates: Number(last.duplicates),
          errors: last.errors ?? [],
          firstLine: last.first_line ?? null,
        }
      : null,
  }
})
