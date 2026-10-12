// A widget kinézetének mentése. Üres törzs (reset: true) az alapértékekre állítja vissza.
export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  if (b.reset === true) {
    saveSettings({ widget_config: null })
    return { ok: true, config: sanitizeWidgetConfig(null) }
  }
  const config = sanitizeWidgetConfig(b.config)
  saveSettings({ widget_config: config })
  return { ok: true, config }
})
