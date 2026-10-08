import { clAuthorizeUrl } from '../../utils/carelink'

export default defineEventHandler(async () => {
  try {
    return { ok: true, url: await clAuthorizeUrl() }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
})
