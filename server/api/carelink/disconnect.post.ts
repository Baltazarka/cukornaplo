import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { CL_RAW_FILE } from '../../utils/carelink'

export default defineEventHandler(() => {
  saveSettings({ carelink: null })
  try {
    unlinkSync(join(dataDir(), CL_RAW_FILE))
  } catch { /* nincs ilyen fájl */ }
  return { ok: true }
})
