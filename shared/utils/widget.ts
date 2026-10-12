// A telefonos (Scriptable) widget kinézete. A szerveren tárolódik, a widget minden frissítéskor lekéri,
// a Telefon oldali szerkesztő ugyanebből rajzolja az előnézetet.
export interface WidgetConfig {
  showTrend: boolean
  showCob: boolean
  showIob: boolean
  showLine: boolean
  showRange: boolean
  showAge: boolean
  /** A trendvonal hossza órában. */
  lineHours: 1 | 3 | 6
  /** A vércukorérték betűmérete (pont). */
  fontSize: number
  tap: 'home' | 'report'
  colors: { inRange: string; low: string; high: string; cob: string; iob: string; bg: string }
}

export const WIDGET_DEFAULTS: WidgetConfig = {
  showTrend: true, showCob: true, showIob: true, showLine: true, showRange: true, showAge: true,
  lineHours: 3,
  fontSize: 38,
  tap: 'home',
  colors: { inRange: '#ff7ad9', low: '#ff5d5d', high: '#ffb454', cob: '#2fbf8a', iob: '#4a8cff', bg: '#0f1115' },
}

export const WIDGET_FONT = { min: 28, max: 48 } as const
export const WIDGET_TAP_LABELS: Record<WidgetConfig['tap'], string> = { home: 'Főoldal', report: 'Riport' }
export const WIDGET_TAP_PATHS: Record<WidgetConfig['tap'], string> = { home: '/', report: '/riport' }

/** Bármilyen bemenetből érvényes beállítás: hiányzó vagy hibás mező az alapértékre áll. */
export function sanitizeWidgetConfig(raw: any): WidgetConfig {
  const r = raw && typeof raw === 'object' ? raw : {}
  const d = WIDGET_DEFAULTS
  const bool = (v: any, def: boolean) => (typeof v === 'boolean' ? v : def)
  const hex = (v: any, def: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def)
  const fs = Math.round(Number(r.fontSize))
  const c = r.colors && typeof r.colors === 'object' ? r.colors : {}
  return {
    showTrend: bool(r.showTrend, d.showTrend),
    showCob: bool(r.showCob, d.showCob),
    showIob: bool(r.showIob, d.showIob),
    showLine: bool(r.showLine, d.showLine),
    showRange: bool(r.showRange, d.showRange),
    showAge: bool(r.showAge, d.showAge),
    lineHours: r.lineHours === 1 || r.lineHours === 6 ? r.lineHours : 3,
    fontSize: Number.isFinite(fs) ? Math.min(Math.max(fs, WIDGET_FONT.min), WIDGET_FONT.max) : d.fontSize,
    tap: r.tap === 'report' ? 'report' : 'home',
    colors: {
      inRange: hex(c.inRange, d.colors.inRange), low: hex(c.low, d.colors.low), high: hex(c.high, d.colors.high),
      cob: hex(c.cob, d.colors.cob), iob: hex(c.iob, d.colors.iob), bg: hex(c.bg, d.colors.bg),
    },
  }
}

/** Trendnyíl: → stabil, ↗ ↘ lassú, ↑ ↓ közepes, ⇈ ⇊ gyors. */
export function widgetArrow(t: { dir: number; level: number } | null | undefined): string {
  if (!t) return ''
  if (t.dir === 0) return '→'
  const up = t.dir > 0
  return t.level === 1 ? (up ? '↗' : '↘') : t.level === 2 ? (up ? '↑' : '↓') : up ? '⇈' : '⇊'
}

/** Az aktív inzulin kijelzése: egy tizedes, a felesleges ",0" nélkül. */
export function widgetIob(v: number | null | undefined): string {
  return v == null ? '–' : v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
}
