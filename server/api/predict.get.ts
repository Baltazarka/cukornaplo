// Vércukor-előrejelzés (csak a tulajdonosnak): a főoldali figyelmeztetéshez egy pont,
// a napi grafikonhoz (?series=1..6 óra) a teljes várható görbe.
import { predictGlucose, predictSeries } from '../utils/predict'
import { notifySettings } from '../utils/notify'

export default defineEventHandler((event) => {
  const hours = Number(getQuery(event).series)
  return {
    prediction: predictGlucose(notifySettings().hypoHorizon),
    ...(Number.isFinite(hours) && hours >= 1 && hours <= 6 ? { series: predictSeries(Math.floor(hours)) } : {}),
  }
})
