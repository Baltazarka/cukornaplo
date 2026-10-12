// Az alapértelmezett felszívódási ütem (g/óra) mentése; üres vagy hiányzó érték a gyári értékre áll vissza.
import { ABSORB_RATE_LIMITS, resetDefaultAbsorbRate, resetAbsorptionCache } from '../../utils/absorption'
import { invalidateComputed } from '../../utils/jobs'
import { resetPredictChoice } from '../../utils/predict'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const saved: Record<string, number> = {}
  const errors: string[] = []
  for (const k of ['normal', 'fatty', 'fast']) {
    if (b[k] === '' || b[k] == null) continue
    const v = Number(b[k])
    if (!Number.isFinite(v) || v < ABSORB_RATE_LIMITS.min || v > ABSORB_RATE_LIMITS.max) errors.push(`A felszívódási ütem ${ABSORB_RATE_LIMITS.min}–${ABSORB_RATE_LIMITS.max} g/óra lehet.`)
    else saved[k] = Math.round(v * 10) / 10
  }
  if (errors.length) {
    setResponseStatus(event, 400)
    return { ok: false, errors: [...new Set(errors)] }
  }
  saveSettings({ absorb_rates: Object.keys(saved).length ? saved : null, absorb_defaults: null })
  resetDefaultAbsorbRate()
  resetAbsorptionCache()
  // Az előrejelzés és a visszateszt az alapértelmezett felszívódási ütemtől függ.
  invalidateComputed('predict')
  resetPredictChoice()
  return { ok: true }
})
