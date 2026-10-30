// Választható témák (a `data-theme` attribútum értéke; a „system” = nincs attribútum, a rendszer szerint).
export const THEMES = [
  { id: 'system', label: 'Rendszer szerint', icon: '🖥️', page: '' },
  { id: 'light', label: 'Világos', icon: '☀️', page: '#f9f9f7' },
  { id: 'dark', label: 'Sötét', icon: '🌙', page: '#0d0d0d' },
  { id: 'pastel-lavender', label: 'Levendula (sötét)', icon: '🪻', page: '#17141f' },
  { id: 'pastel-mint', label: 'Menta (sötét)', icon: '🌿', page: '#111a18' },
  { id: 'pastel-peach', label: 'Barack (sötét)', icon: '🍑', page: '#1c1515' },
  { id: 'pastel-sky', label: 'Éjkék (sötét)', icon: '🌌', page: '#10151d' },
  { id: 'pastel-night', label: 'Éjszaka (új stílus)', icon: '✨', page: '#15131c' },
] as const
export type ThemeId = (typeof THEMES)[number]['id']

export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)
