// A legutolsó nyers CareLink válasz letöltése (hibakereséshez).
import { clReadRaw } from '../../utils/carelink'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="carelink_last.json"')
  return clReadRaw()
})
