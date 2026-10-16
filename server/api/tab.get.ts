// A böngészőfül címéhez: a widget adatai görbe nélkül (legutóbbi vércukor és trend, aktív CH és inzulin, céltartomány).
// Csak bejelentkezve (a megosztási link nem éri el); a felület percenként kérdezi le (app/composables/useTabTitle.ts).
import { widgetData } from '../utils/widget'

export default defineEventHandler(() => {
  const { glucose, trend, iob, cob, range } = widgetData(1)
  return { glucose, trend, iob, cob, range }
})
