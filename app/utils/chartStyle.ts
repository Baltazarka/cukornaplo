// Közös grafikon-segédek a napi és az időszakos (AGP) glükózgrafikonhoz.

/** CSS-változó értéke (a téma aktuális színe). */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** Átlós sraffozás (ECharts canvas-mintaként használható szín). */
export function hatchPattern(color: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const x = c.getContext('2d')!
  x.fillStyle = rgba(color, 0.18)
  x.fillRect(0, 0, 8, 8)
  x.strokeStyle = color
  x.lineWidth = 2
  x.beginPath()
  x.moveTo(-2, 2); x.lineTo(2, -2)
  x.moveTo(0, 8); x.lineTo(8, 0)
  x.moveTo(6, 10); x.lineTo(10, 6)
  x.stroke()
  return { image: c, repeat: 'repeat' }
}

/** Pontozott kitöltés (az 5–95% sávhoz). */
export function dotPattern(color: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 6
  const x = c.getContext('2d')!
  x.fillStyle = color
  x.beginPath()
  x.arc(3, 3, 1, 0, Math.PI * 2)
  x.fill()
  return { image: c, repeat: 'repeat' }
}

export interface GlucoseRange { veryLow: number; low: number; high: number; veryHigh: number }

/**
 * Tartománysávok kitöltése a két grafikonon egységesen:
 * < veryLow piros, veryLow–low sraffozott piros, célban zöld, high–veryHigh sraffozott sárga, > veryHigh narancs.
 */
export function rangeFills(r: GlucoseRange) {
  const critical = cssToken('--status-critical')
  const good = cssToken('--status-good')
  const warning = cssToken('--status-warning')
  const serious = cssToken('--status-serious')
  return {
    veryLow: { lo: 0, hi: r.veryLow, color: critical as any },
    low: { lo: r.veryLow, hi: r.low, color: hatchPattern(critical) as any },
    inRange: { lo: r.low, hi: r.high, color: rgba(good, 0.55) as any },
    high: { lo: r.high, hi: r.veryHigh, color: hatchPattern(warning) as any },
    veryHigh: { lo: r.veryHigh, hi: 40, color: serious as any },
  }
}

/** „Éjszaka” téma: a zónák színei (a napi görbén és az AGP-n egyformán). */
export function nightZoneColors() {
  return { veryLow: cssToken('--status-critical'), low: '#f2a66b', inRange: cssToken('--status-good'), high: cssToken('--status-warning'), veryHigh: cssToken('--status-serious') }
}

/** „Éjszaka” téma: zónánként halvány pontozott háttér (fátyol helyett), markArea-adatként. */
export function nightZoneDots(r: GlucoseRange, alpha = 1) {
  const z = nightZoneColors()
  return ([[0, r.veryLow, z.veryLow, 0.5], [r.veryLow, r.low, z.low, 0.45], [r.low, r.high, z.inRange, 0.3], [r.high, r.veryHigh, z.high, 0.35], [r.veryHigh, 40, z.veryHigh, 0.4]] as [number, number, string, number][])
    .map(([lo, hi, color, op]) => [{ yAxis: lo, itemStyle: { color: dotPattern(rgba(color, Math.min(1, op * alpha))) as any } }, { yAxis: hi }])
}
