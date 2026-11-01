// A Terápia oldal közös időszaka (nap): a becslés, a bázisellenőrzés és a „még kell” tipp ugyanarra számol.
// A választás ebben a böngészőben megmarad.
export const ANALYSIS_PERIODS = [7, 14, 30, 60, 90]
const KEY = 'cukornaplo.analysisDays'

export function useAnalysisDays() {
  const days = useState('analysisDays', () => 14)
  onMounted(() => {
    try {
      const v = Number(localStorage.getItem(KEY))
      if (ANALYSIS_PERIODS.includes(v)) days.value = v
    } catch { /* nincs tároló */ }
  })
  function setDays(d: number) {
    days.value = d
    try { localStorage.setItem(KEY, String(d)) } catch { /* nincs tároló */ }
  }
  return { days, setDays }
}
