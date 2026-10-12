// Az előrejelzés pontossága visszatesztelve a saját adataidon (tárolt, éjszaka újraszámolt eredmény): az elmúlt napokban
// fél óránként kiszámolja, mit jósolt volna 15 / 30 / 60 percre, és összeveti a ténylegesen mért szenzorértékkel
// (átlagos abszolút hiba, mmol/L), módszerenként, külön aktív inzulin / szénhidrát mellett és anélkül.
// A válasz tartalmazza a most érvényes automatikus módszerválasztást is.
import { accuracyCached } from '../utils/jobs'
import { readComputed } from '../utils/computed'
import { CHOICE_KEY } from '../utils/predict'

export default defineEventHandler((event) => {
  const q = Number(getQuery(event).days)
  const days = [7, 14, 30].includes(q) ? q : 14
  const r = accuracyCached(days)
  return { ...r.data, computedAt: r.at, choice: readComputed(CHOICE_KEY)?.data ?? null }
})
