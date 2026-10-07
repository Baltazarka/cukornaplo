// Háttérben futó CareLink-lekérés CARELINK_INTERVAL másodpercenként (alapból 5 perc).
// A Dockerben korábban az entrypoint.sh külön PHP-folyamata végezte; itt a Nitro process-ében fut.
import { clPoll, clIsConnected } from '../utils/carelink'

export default defineNitroPlugin(() => {
  const interval = Number(process.env.CARELINK_INTERVAL ?? useRuntimeConfig().carelinkInterval)
  if (!interval || interval <= 0) return

  const tick = async () => {
    if (!clIsConnected()) return
    try {
      await clPoll()
    } catch { /* a hibát a clPoll a settings-be menti */ }
  }

  // Indulás után picit várunk, majd az első lekérés; utána ciklikusan.
  setTimeout(tick, 20_000)
  const timer = setInterval(tick, interval * 1000)
  if (typeof timer.unref === 'function') timer.unref()

  console.log(`[carelink] háttér-poller: ${interval}s`)
})
