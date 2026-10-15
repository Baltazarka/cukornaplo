// Terápiás beállítások: célérték, érzékenységi tényező (ISF), CH-arány és hatásidő napszakonként.
// A szerver (settings.json `therapy` kulcs) és a felület közös típusa.

export interface TherapySegment {
  /** Kezdő időpont 'HH:MM'. A napszak a következő kezdetéig tart; az utolsó átnyúlik az elsőig. */
  start: string
  /** Glükóz célértéke, mmol/L. */
  target: number
  /** Inzulinérzékenységi tényező, mmol/L / E. */
  isf: number
  /** Inzulin-szénhidrát arány, g / E. */
  icr: number
  /**
   * Napszakra jellemző inzulinhatás-idő, perc (ha nincs megadva, a közös `actionMinutes` érvényes).
   * A hatásgörbe a beadás napszakának értékével rajzolódik.
   */
  actionMinutes?: number
}

export interface Therapy {
  /** Étkezésalapú terápia. Egyelőre csak a szénhidrátszámolás. */
  mealMode: 'carbs'
  /** Bólus- és bázisinzulin a katalógusból (shared/utils/insulins.ts), ha meg van adva. */
  bolusInsulin: string | null
  basalInsulin: string | null
  /** Kiszámított maximális dózis, E. */
  maxBolus: number
  /** Inzulinhatás időtartama, perc. */
  actionMinutes: number
  /**
   * Zsíros / fehérjedús étkezésnél a kalkulátor tájékoztató plusz-javaslata a varsói módszer (zsír-fehérje egység)
   * értékének hány százaléka (0 = nincs javaslat). Hiányzó érték: 50.
   */
  fpuPercent?: number
  /** Napszakbeállítások: ki kapcsolva csak az első napszak értékei érvényesek, egész nap. */
  byTimeOfDay: boolean
  segments: TherapySegment[]
  /** Egyelőre mindig kézi; később számítás vagy varázsló is beállíthatja. */
  source: 'manual'
  updatedAt: number
}
