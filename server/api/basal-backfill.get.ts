// A hiányzó bázisnapok listája (a legelső naplózott bázis óta): a Terápia oldal „Pótlás” gombjához.
import { missingBasalDays } from '../utils/basalAuto'

export default defineEventHandler(() => missingBasalDays() ?? { time: null, units: null, days: [] })
