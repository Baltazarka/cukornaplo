// E-mail-beállítások mentése. A jelszót csak akkor írja felül, ha újat adtak meg.
import { mailSettings, EMAIL_RE } from '../../utils/mail'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const cur = mailSettings()
  const host = String(b.host ?? cur.host).trim()
  const port = Number(b.port ?? cur.port)
  const user = String(b.user ?? cur.user).trim()
  const publicUrl = String(b.publicUrl ?? cur.publicUrl).trim()
  const errors: string[] = []
  if (!/^[a-z0-9.-]+$/i.test(host)) errors.push('Érvénytelen SMTP-szerver.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('Érvénytelen port.')
  if (user && !EMAIL_RE.test(user)) errors.push('A felhasználónév egy e-mail-cím legyen (a Gmail-címed).')
  if (publicUrl && !/^https?:\/\/[^\s/]+(\/.*)?$/i.test(publicUrl)) errors.push('A nyilvános cím http(s)://… formájú legyen.')
  if (errors.length) {
    setResponseStatus(event, 400)
    return { ok: false, errors }
  }
  const pass = typeof b.pass === 'string' && b.pass.trim() !== '' ? b.pass.replace(/\s+/g, '') : cur.pass
  saveSettings({
    mail: {
      host, port, secure: b.secure ?? port === 465, user, pass: b.clearPass ? '' : pass,
      fromName: String(b.fromName ?? cur.fromName).trim().slice(0, 60) || 'Cukornapló',
      publicUrl: publicUrl.replace(/\/+$/, ''),
    },
  })
  return { ok: true }
})
