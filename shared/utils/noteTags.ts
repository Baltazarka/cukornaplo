// Jegyzet-címkék (a naplóban, a napi grafikonon és a riportban). A sorrend a megjelenítési sorrend.
export const NOTE_TAGS = [
  { id: 'sport', label: 'Sport' },
  { id: 'betegseg', label: 'Betegség' },
  { id: 'alkohol', label: 'Alkohol' },
  { id: 'stressz', label: 'Stressz' },
  { id: 'menstruacio', label: 'Menstruáció' },
  { id: 'hipo', label: 'Hipó kezelése' },
  { id: 'szenzor', label: 'Szenzorcsere' },
  { id: 'toll', label: 'Új toll / patron' },
  { id: 'egyeb', label: 'Egyéb' },
] as const

export type NoteTag = (typeof NOTE_TAGS)[number]['id']

export function noteTagLabel(id: string): string {
  return NOTE_TAGS.find((t) => t.id === id)?.label ?? id
}
