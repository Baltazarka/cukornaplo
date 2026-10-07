import { clSave, clPoll } from '../../utils/carelink'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  clSave({ patient: String(body.patient ?? '') })
  const poll = await clPoll()
  return { ok: poll.ok, poll }
})
