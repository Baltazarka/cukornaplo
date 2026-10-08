// Beépített inzulinkatalógus és hatásgörbe-modell.
//
// Nyilvános, géppel olvasható „hatásgörbe-adatbázis” nincs. A nyílt forrású inzulinadagoló
// rendszerek (OpenAPS / AndroidAPS / Loop) a gyors hatású inzulinokat exponenciális modellel írják
// le, amelyet két szám határoz meg: a hatás csúcsideje (inzulintípusonként) és a teljes hatásidő.
// Csúcsidők: oref0 „rapid-acting” 75 perc (NovoRapid, Humalog, Apidra), „ultra-rapid” 55 perc
// (Fiasp, Lyumjev). A `facts` mezők a gyógyszer alkalmazási előírásából (SmPC) valók.

export interface InsulinInfo {
  id: string
  name: string
  generic: string
  kind: 'bolus' | 'basal'
  /** Bólusinzulinnál: a hatás csúcsideje percben (exponenciális modell). */
  peakMinutes?: number
  /** Az alkalmazási előírás szerinti hatásprofil, ha rögzítettük. */
  facts?: { onset?: string; peak?: string; duration?: string; note?: string }
}

export const INSULINS: InsulinInfo[] = [
  {
    id: 'novorapid', name: 'NovoRapid', generic: 'aszpart', kind: 'bolus', peakMinutes: 75,
    facts: { onset: '10–20 perc', peak: '1–3 óra', duration: '3–5 óra' },
  },
  { id: 'fiasp', name: 'Fiasp', generic: 'gyorsabb hatású aszpart', kind: 'bolus', peakMinutes: 55 },
  { id: 'humalog', name: 'Humalog', generic: 'lizpro', kind: 'bolus', peakMinutes: 75 },
  { id: 'lyumjev', name: 'Lyumjev', generic: 'lizpro (ultragyors)', kind: 'bolus', peakMinutes: 55 },
  { id: 'apidra', name: 'Apidra', generic: 'glulizin', kind: 'bolus', peakMinutes: 75 },
  {
    id: 'toujeo', name: 'Toujeo', generic: 'glargin 300 E/ml', kind: 'basal',
    facts: { peak: 'nincs kifejezett csúcs', duration: '24 óránál tovább, akár 36 óra', note: 'egyensúlyi állapot 3–4 nap után' },
  },
  { id: 'lantus', name: 'Lantus / Abasaglar', generic: 'glargin 100 E/ml', kind: 'basal' },
  { id: 'tresiba', name: 'Tresiba', generic: 'degludek', kind: 'basal' },
  { id: 'levemir', name: 'Levemir', generic: 'detemir', kind: 'basal' },
]

export function insulinById(id: string | null | undefined): InsulinInfo | null {
  return INSULINS.find((i) => i.id === id) ?? null
}

/**
 * Exponenciális inzulinhatás-modell (OpenAPS oref0 / Loop). A csúcsnak a hatásidő felénél korábban
 * kell lennie; rövid hatásidőnél a csúcsot a hatásidő 40%-ára szűkítjük (`clamped`).
 */
export function insulinModel(peakMinutes: number, durationMinutes: number) {
  const td = durationMinutes
  const tp = Math.min(peakMinutes, td * 0.4)
  const tau = (tp * (1 - tp / td)) / (1 - (2 * tp) / td)
  const a = (2 * tau) / td
  const S = 1 / (1 - a + (1 + a) * Math.exp(-td / tau))
  return {
    peak: tp,
    clamped: tp < peakMinutes,
    /** Hatás a t. percben: a teljes adag hányad része hat percenként (a görbe alatti terület 1). */
    activity(t: number): number {
      if (t <= 0 || t >= td) return 0
      return (S / (tau * tau)) * t * (1 - t / td) * Math.exp(-t / tau)
    },
    /** Még aktív inzulin (IOB) aránya a t. percben, 1 → 0. */
    iob(t: number): number {
      if (t <= 0) return 1
      if (t >= td) return 0
      return 1 - S * (1 - a) * ((t * t / (tau * td * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1)
    },
  }
}
