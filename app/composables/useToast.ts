// Felugró értesítések (toast) a weblapon: a böngésző alert() helyett és a műveletek eredményeihez.
// Használat: const toast = useToast(); toast.success('Mentve.'); toast.error('Nem sikerült.')
// Vagy meglévő üzenet-referenciákhoz: useToastFrom(msg, 'success'); useToastFrom(errList, 'error')
export type ToastKind = 'success' | 'error' | 'info'
export interface ToastItem { id: number; kind: ToastKind; text: string; ttl: number }

let seq = 0
const TTL: Record<ToastKind, number> = { success: 4000, info: 5000, error: 8000 }

export function useToasts() {
  return useState<ToastItem[]>('toasts', () => [])
}

export function useToast() {
  const items = useToasts()
  function push(kind: ToastKind, text: string) {
    const t = String(text ?? '').trim()
    if (!t || !import.meta.client) return
    // Ugyanaz az üzenet ne halmozódjon fel: a már látszót frissítjük.
    const same = items.value.find((x) => x.kind === kind && x.text === t)
    if (same) {
      same.id = ++seq
      return
    }
    items.value = [...items.value.slice(-3), { id: ++seq, kind, text: t, ttl: TTL[kind] }]
  }
  return {
    success: (t: string) => push('success', t),
    error: (t: string) => push('error', t),
    info: (t: string) => push('info', t),
    dismiss: (id: number) => { items.value = items.value.filter((x) => x.id !== id) },
  }
}

/** A komponens üzenet-referenciáját (szöveg vagy szövegtömb) figyeli, és minden nem üres értéket felugró értesítésként mutat. */
export function useToastFrom(source: Ref<string | string[]>, kind: ToastKind) {
  const toast = useToast()
  watch(source, (v) => {
    const list = Array.isArray(v) ? v : [v]
    for (const x of list) if (x) toast[kind](x)
  }, { flush: 'sync' })
}
