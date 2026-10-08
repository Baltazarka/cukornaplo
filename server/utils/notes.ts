// Jegyzetek lekérdezése egy időszakra.
import { db } from './db'
import { hmInTz, minuteOfDayInTz, ymdInTz } from './time'

export interface Note { id: number; ts: number; time: string; minute: number; day: string; tags: string[]; text: string }

export function notesBetween(from: number, to: number): Note[] {
  return (db().prepare('SELECT id, ts, tags, text FROM notes WHERE ts >= ? AND ts < ? ORDER BY ts').all(from, to) as any[]).map((r) => {
    const ts = Number(r.ts)
    return {
      id: Number(r.id), ts, time: hmInTz(ts), minute: minuteOfDayInTz(ts), day: ymdInTz(ts),
      tags: String(r.tags || '').split(',').filter(Boolean), text: String(r.text || ''),
    }
  })
}
