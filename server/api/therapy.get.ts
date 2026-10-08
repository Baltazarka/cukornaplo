// Terápiás beállítások a főoldali kártyához és a szerkesztőhöz.
import { therapy, THERAPY_LIMITS } from '../utils/therapy'

export default defineEventHandler(() => ({ therapy: therapy(), limits: THERAPY_LIMITS }))
