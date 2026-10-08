// Új API-kulcs. A telefonon (Health Auto Export / Parancsok) is át kell írni!
export default defineEventHandler(() => {
  const token = newToken()
  saveSettings({ api_token: token })
  return { ok: true, token }
})
