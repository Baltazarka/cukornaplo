/** HTML-szöveg biztonságos beillesztése (pl. ECharts-buborékba): a felhasználói szöveg nem lehet HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
