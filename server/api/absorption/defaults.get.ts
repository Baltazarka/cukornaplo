import { defaultAbsorbRate, BUILTIN_ABSORB_RATE, ABSORB_RATE_LIMITS } from '../../utils/absorption'

export default defineEventHandler(() => ({ values: defaultAbsorbRate(), builtin: BUILTIN_ABSORB_RATE, limits: ABSORB_RATE_LIMITS }))
