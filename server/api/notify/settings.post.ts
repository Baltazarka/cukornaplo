import { validateNotify } from '../../utils/notify'

export default defineEventHandler(async (event) => {
  saveSettings({ notify: validateNotify((await readBody(event)) ?? {}) })
  return { ok: true }
})
