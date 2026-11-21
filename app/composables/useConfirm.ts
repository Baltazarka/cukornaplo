// Saját megerősítő ablak a böngésző confirm() helyett.
// Használat: if (!(await askConfirm('Biztos törlöd?', { confirmLabel: 'Törlés', danger: true }))) return
export interface ConfirmOptions {
  title?: string
  /** A megerősítő gomb felirata (alapból „Igen”). */
  confirmLabel?: string
  cancelLabel?: string
  /** Veszélyes (törlő) művelet: piros megerősítő gomb, és a fókusz a „Mégse” gombon marad. */
  danger?: boolean
  /** Jelszómező is van az ablakban (az `askPassword` használja). */
  password?: boolean
}

export interface ConfirmState extends ConfirmOptions {
  open: boolean
  text: string
  resolve: ((v: boolean) => void) | null
  /** A jelszómezőbe írt szöveg. */
  input: string
}

export function useConfirmState() {
  return useState<ConfirmState>('confirm', () => ({ open: false, text: '', resolve: null, input: '' }))
}

/** Megerősítést kér; igazzal tér vissza, ha a felhasználó jóváhagyta. */
export function askConfirm(text: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const st = useConfirmState()
  // Ha már nyitva van egy kérdés, azt elutasítottnak vesszük.
  st.value.resolve?.(false)
  return new Promise<boolean>((resolve) => {
    st.value = { ...opts, open: true, text, resolve, input: '' }
  })
}

/** Megerősítés jelszóval: a beírt jelszót adja vissza, mégse esetén null-t. */
export async function askPassword(text: string, opts: ConfirmOptions = {}): Promise<string | null> {
  const ok = await askConfirm(text, { ...opts, password: true })
  return ok ? useConfirmState().value.input : null
}
