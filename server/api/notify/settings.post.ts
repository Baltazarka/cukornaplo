import { validateNotify } from '../../utils/notify'

export default defineEventHandler(async (event) => {
  const v = validateNotify((await readBody(event)) ?? {})
  if (!v.ok) {
    setResponseStatus(event, 400)
    return { ok: false, errors: v.errors }
  }
  saveSettings({ notify: v.value })
  return { ok: true }
})
