// E-mail-beállítások a felülethez (a jelszó nélkül).
import { mailSettings } from '../../utils/mail'

export default defineEventHandler(() => {
  const { pass, ...rest } = mailSettings()
  return { ...rest, hasPass: !!pass }
})
