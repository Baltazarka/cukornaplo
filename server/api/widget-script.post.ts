// A widget szkriptjének törzse: a telefonon a kis betöltő (docs/scriptable-loader.txt) ezt tölti le minden
// futáskor, így a widget kódjának frissítéséhez nem kell újra bemásolni. X-Token-nel védett.
import { widgetAuthError } from '../utils/widget'

export default defineEventHandler(async (event) => {
  const denied = widgetAuthError(event)
  if (denied) return denied
  const raw = await useStorage('assets:docs').getItemRaw('scriptable-widget.txt')
  if (!raw) {
    setResponseStatus(event, 500)
    return { ok: false, error: 'A widget kódja nem található.' }
  }
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return Buffer.from(raw as any).toString('utf8')
})
