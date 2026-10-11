// Labor HbA1c-eredmények, mindegyik mellett a GMI a labor előtti 90 nap szenzoradataiból
// (a HbA1c nagyjából az előző 2–3 hónap átlagát tükrözi).
import { db } from '../utils/db'
import { MGDL_PER_MMOL } from '../utils/normalize'
import { startOfDayTs, addDaysYmd } from '../utils/time'

const WINDOW_DAYS = 90

export default defineEventHandler(() => {
  const rows = db().prepare('SELECT id, date, hba1c FROM lab_results ORDER BY date DESC, id DESC').all() as any[]
  const avgStmt = db().prepare("SELECT AVG(value) avg, COUNT(*) n FROM entries WHERE type = 'glucose' AND ts >= ? AND ts < ?")
  return {
    windowDays: WINDOW_DAYS,
    results: rows.map((r) => {
      const to = startOfDayTs(addDaysYmd(r.date, 1))
      const g = avgStmt.get(to - WINDOW_DAYS * 86400, to) as { avg: number | null; n: number }
      const n = Number(g.n)
      return {
        id: Number(r.id),
        date: r.date as string,
        hba1c: Number(r.hba1c),
        gmi: n ? Math.round((3.31 + 0.02392 * Number(g.avg) * MGDL_PER_MMOL) * 10) / 10 : null,
        avg: n ? Math.round(Number(g.avg) * 10) / 10 : null,
        // A 90 napból hány százaléknyi szenzoradat van (5 percenként 288 mérés naponta).
        coverage: Math.min(100, Math.round((100 * n) / (WINDOW_DAYS * 288))),
      }
    }),
  }
})
