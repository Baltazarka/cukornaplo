// Napi mentés (lásd utils/backup.ts): indulás után egy perccel, majd óránként ellenőrzi, van-e mai másolat.
import { backupDaily } from '../utils/backup'

export default defineNitroPlugin(() => {
  const run = () => {
    try {
      if (backupDaily()) console.log('[mentés] napi másolat kész')
    } catch (e) {
      console.error('[mentés]', e)
    }
  }
  setTimeout(run, 60_000)
  const timer = setInterval(run, 3600_000)
  if (typeof timer.unref === 'function') timer.unref()
})
