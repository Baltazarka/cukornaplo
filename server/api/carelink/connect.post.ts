import { clConnectWithCode, clPoll } from '../../utils/carelink'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  try {
    const session = await clConnectWithCode(String(body.code ?? ''))
    const poll = await clPoll()
    return { ok: true, session, poll }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
})
