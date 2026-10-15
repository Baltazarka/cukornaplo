// Szénhidrát-bejegyzés zsír- és fehérjetartalma (g) utólag: { id, fat?, protein? } (üres = nincs megadva).
// A zsír-fehérje javaslat kiértékeléséhez és a saját % becsléséhez kell (server/utils/analysis.ts).
import { markDirty } from '../utils/computed'
import { db } from '../utils/db'
import { MACRO_MAX_G } from '#shared/utils/fpu'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  const macro = (v: unknown): number | null | 'bad' => {
    if (v == null || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= MACRO_MAX_G ? Math.round(n * 10) / 10 : 'bad'
  }
  const fat = macro(body.fat)
  const protein = macro(body.protein)
  if (!Number.isInteger(id) || fat === 'bad' || protein === 'bad') {
    setResponseStatus(event, 400)
    return { ok: false, error: `Érvénytelen adat (a zsír és a fehérje 0–${MACRO_MAX_G} g lehet).` }
  }
  const info = db().prepare("UPDATE entries SET fat = ?, protein = ? WHERE id = ? AND type = 'carbs'").run(fat, protein, id)
  if (Number(info.changes) === 0) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'Nincs ilyen szénhidrát-bejegyzés.' }
  }
  markDirty()
  return { ok: true }
})
