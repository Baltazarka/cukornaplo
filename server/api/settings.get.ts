// A Beállítások/Adatok oldal összesített adatai.
import { db } from '../utils/db'
import { targetRange } from '../utils/range'
import { clState, clIsConnected } from '../utils/carelink'

export default defineEventHandler(() => {
  const counts: Record<string, { count: number; first: number | null; last: number | null }> = {
    glucose: { count: 0, first: null, last: null },
    insulin: { count: 0, first: null, last: null },
    carbs: { count: 0, first: null, last: null },
  }
  for (const r of db().prepare('SELECT type, COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM entries GROUP BY type').all() as any[]) {
    counts[r.type] = { count: Number(r.c), first: r.mn ? Number(r.mn) : null, last: r.mx ? Number(r.mx) : null }
  }
  const cl = clState()
  return {
    token: String(setting('api_token', '') ?? ''),
    range: targetRange(),
    counts,
    last: setting('last_ingest', null),
    carelink: {
      connected: clIsConnected(),
      session: cl.session ?? null,
      patient: cl.patient ?? null,
      lastPollAt: cl.last_poll_at ?? null,
      lastOkAt: cl.last_ok_at ?? null,
      lastCount: cl.last_count ?? null,
      lastInserted: cl.last_inserted ?? null,
      lastSgAt: cl.last_sg_at ?? null,
      lastError: cl.last_error ?? null,
    },
  }
})
