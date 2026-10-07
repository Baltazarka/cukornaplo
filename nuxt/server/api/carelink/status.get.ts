// CareLink kapcsolat állapota a felülethez.
import { clState, clIsConnected } from '../../utils/carelink'

export default defineEventHandler(() => {
  const s = clState()
  return {
    connected: clIsConnected(),
    session: s.session ?? null,
    patient: s.patient ?? null,
    lastPollAt: s.last_poll_at ?? null,
    lastOkAt: s.last_ok_at ?? null,
    lastCount: s.last_count ?? null,
    lastInserted: s.last_inserted ?? null,
    lastSgAt: s.last_sg_at ?? null,
    lastError: s.last_error ?? null,
    lastErrorAt: s.last_error_at ?? null,
  }
})
