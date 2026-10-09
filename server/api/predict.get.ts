// Vércukor-előrejelzés a főoldali figyelmeztetéshez (csak a tulajdonosnak).
import { predictGlucose } from '../utils/predict'
import { notifySettings } from '../utils/notify'

export default defineEventHandler(() => ({ prediction: predictGlucose(notifySettings().hypoHorizon) }))
