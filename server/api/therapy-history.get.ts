// A terápiás beállítások változásai (legújabb elöl): mi változott, és az eredmény a változás előtti és utáni 14 napban
// (céltartományban töltött idő, alatta, átlag; csak szenzoradat, a kizárt szakaszok nélkül).
import type { Therapy, TherapySegment } from '#shared/types/therapy'
import { therapyHistory } from '../utils/therapy'
import { targetRange } from '../utils/range'
import { db } from '../utils/db'

const WINDOW_SEC = 14 * 86400
const r1 = (v: number) => Math.round(v * 10) / 10

function outcome(from: number, to: number) {
  if (to <= from) return null
  const { low, high } = targetRange()
  const r = db()
    .prepare(`SELECT COUNT(*) AS n, SUM(value >= ? AND value <= ?) AS inR, SUM(value < ?) AS below, AVG(value) AS avg
      FROM entries WHERE type = 'glucose' AND ts >= ? AND ts < ? AND excluded = 0 AND (source IS NULL OR source != 'manual')`)
    .get(low, high, low, from, to) as { n: number; inR: number; below: number; avg: number }
  if (!r.n || r.n < 288) return null // legalább kb. egy nap szenzoradat
  return { tir: Math.round((100 * r.inR) / r.n), below: r1((100 * r.below) / r.n), avg: r1(r.avg), days: r1(r.n / 288) }
}

const fmt = (v: number) => String(v).replace('.', ',')
/** Rövid leírás a változásokról (napszakonként cél / ISF / CH-arány / hatásidő, és a fő beállítások). */
function diff(prev: Therapy, next: Therapy): string[] {
  const out: string[] = []
  const segLine = (label: string, a: TherapySegment[] = [], b: TherapySegment[] = []) => {
    const byStart = new Map(a.map((s) => [s.start, s]))
    for (const s of b) {
      const o = byStart.get(s.start)
      if (!o) { out.push(`${label}${s.start}: új napszak`); continue }
      const parts: string[] = []
      if (o.target !== s.target) parts.push(`cél ${fmt(o.target)} → ${fmt(s.target)}`)
      if (o.isf !== s.isf) parts.push(`ISF ${fmt(o.isf)} → ${fmt(s.isf)}`)
      if (o.icr !== s.icr) parts.push(`CH-arány ${fmt(o.icr)} → ${fmt(s.icr)}`)
      if ((o.actionMinutes ?? null) !== (s.actionMinutes ?? null)) parts.push('hatásidő')
      if (parts.length) out.push(`${label}${s.start}: ${parts.join(', ')}`)
    }
    for (const o of a) if (!b.some((s) => s.start === o.start)) out.push(`${label}${o.start}: törölve`)
  }
  segLine('', prev.segments, next.segments)
  if (next.altEnabled || prev.altEnabled) segLine('délutános hét ', prev.altSegments, next.altSegments)
  if (prev.actionMinutes !== next.actionMinutes) out.push(`hatásidő ${prev.actionMinutes} → ${next.actionMinutes} perc`)
  if (prev.maxBolus !== next.maxBolus) out.push(`max. dózis ${fmt(prev.maxBolus)} → ${fmt(next.maxBolus)} E`)
  if ((prev.fpuPercent ?? 50) !== (next.fpuPercent ?? 50)) out.push(`zsír-fehérje ${prev.fpuPercent ?? 50}% → ${next.fpuPercent ?? 50}%`)
  if (prev.byTimeOfDay !== next.byTimeOfDay) out.push(next.byTimeOfDay ? 'napszakok bekapcsolva' : 'napszakok kikapcsolva')
  if (!!prev.altEnabled !== !!next.altEnabled) out.push(next.altEnabled ? 'délutános hét bekapcsolva' : 'délutános hét kikapcsolva')
  return out
}

export default defineEventHandler(() => {
  const list = therapyHistory()
  const now = Math.floor(Date.now() / 1000)
  const changes = list.slice(1).map((v, i) => ({
    at: v.from,
    changes: diff(list[i].therapy, v.therapy),
    before: outcome(v.from - WINDOW_SEC, v.from),
    after: outcome(v.from, Math.min(now, v.from + WINDOW_SEC)),
  })).filter((c) => c.changes.length)
  return { changes: changes.reverse() }
})
