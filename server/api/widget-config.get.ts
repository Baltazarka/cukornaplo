// A widget kinézete és a mostani adatok a szerkesztő előnézetéhez (csak bejelentkezve).
import { widgetConfig, widgetData } from '../utils/widget'

export default defineEventHandler(() => {
  const config = widgetConfig()
  return { config, data: widgetData(6) }
})
