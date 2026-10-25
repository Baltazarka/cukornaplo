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

/** Műszak egy adott napon. */
export type ShiftKind = 'morning' | 'afternoon' | 'free'

/** Váltott műszak beosztása (settings.json `shift`): az `anchor` hete `anchorShift`, onnan hetente váltakozik. */
export interface ShiftSchedule {
  enabled: boolean
  /** Egy nap a megjelölt hétből (YYYY-MM-DD). */
  anchor: string
  anchorShift: 'morning' | 'afternoon'
  /** Szombat és vasárnap szabadnap. */
  weekendFree: boolean
  /** Kézzel átállított napok (pl. szabadság, csere). */
  overrides: Record<string, ShiftKind>
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
  /**
   * A zsír-fehérje plusz adag időzítése: 'later' = később, ha a cukor emelkedik (1,5 órás emlékeztető a plusz adagra),
   * 'together' = egyben, evéskor az étkezési bólussal (75 perces ellenőrző emlékeztető a korai hipó miatt). Hiányzó: 'later'.
   */
  fpuTiming?: 'later' | 'together'
  /** Napszakbeállítások: ki kapcsolva csak az első napszak értékei érvényesek, egész nap. */
  byTimeOfDay: boolean
  /** Az alap napszakbeállítás (váltott műszaknál a délelőttös hétre és minden más napra). */
  segments: TherapySegment[]
  /** Váltott műszak: külön napszakbeállítás a délutános hétre (a műszakbeosztás szerint, shared/utils/shift.ts). */
  altEnabled?: boolean
  altSegments?: TherapySegment[]
  /** Szabadnapon melyik beállítás érvényes ('base' = alap, 'alt' = délutános). Hiányzó: alap. */
  freeProfile?: 'base' | 'alt'
  /**
   * A bázis automatikus beírása: naponta `time`-kor (HH:MM) `units` E bázis kerül a naplóba (push értesítéssel), ha
   * aznap még nincs bázis beírva (server/utils/basalAuto.ts). Hiányzó: kikapcsolva.
   */
  basalAuto?: { time: string; units: number }
  /** Egyelőre mindig kézi; később számítás vagy varázsló is beállíthatja. */
  source: 'manual'
  updatedAt: number
}
