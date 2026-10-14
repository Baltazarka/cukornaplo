// Guardian szenzor- és transzmitterállapot: a CareLink válaszból kiolvasott adatok és magyar szövegeik
// (főoldali állapotsor, push értesítések). Kiolvasás: server/utils/carelink.ts clExtractDevice.

export interface DeviceStatus {
  /** A lekérés ideje (unix mp). */
  at: number
  sensorState: string | null
  /** A szenzorból hátralévő órák (CareLink `sensorDurationHours`). */
  sensorHoursLeft: number | null
  /** A szenzor várható lejárata (unix mp), a lekérés idejéből és a hátralévő órákból. */
  sensorEndsAt: number | null
  /** A transzmitter töltöttsége, %. */
  transmitterBattery: number | null
  /** A telefon eléri-e a transzmittert. */
  sensorInRange: boolean | null
  lastAlarm: { kind: string; ts: number | null } | null
}

/** Ennél kevesebb töltésnél figyelmeztet a transzmitterre (%). */
export const TRANSMITTER_LOW = 20
/** Ennyivel a szenzor lejárata előtt figyelmeztet (óra). */
export const SENSOR_ENDING_HOURS = 12

// A CareLink `sensorState` értékei; a normál állapotokról (NORMAL, UNKNOWN stb.) nem szólunk.
const SENSOR_STATES: Record<string, string> = {
  WARM_UP: 'A szenzor bemelegszik',
  CHANGE_SENSOR: 'Szenzorcsere szükséges',
  SENSOR_END_OF_LIFE: 'A szenzor lejárt',
  CALIBRATION_REQUIRED: 'Kalibrálás szükséges',
  CALIBRATING: 'Kalibrálás folyamatban',
  SENSOR_DISCONNECTED: 'A szenzor nem kapcsolódik',
  NO_DATA_FROM_PUMP: 'Nincs adat a transzmittertől',
  SENSOR_ERROR: 'Szenzorhiba',
  SG_BELOW_40_MGDL: 'A szenzor mérési tartománya alatt (2,2 mmol/L alatt)',
  SG_ABOVE_400_MGDL: 'A szenzor mérési tartománya fölött (22,2 mmol/L fölött)',
}
const QUIET_STATES = new Set(['NORMAL', 'UNKNOWN', 'NO_ERROR_MESSAGE', 'DELIVERY_SUSPEND'])

/** A szenzorállapot szövege, ha nem normál (különben null). */
export function sensorStateText(state: string | null): string | null {
  if (!state || QUIET_STATES.has(state)) return null
  return SENSOR_STATES[state] ?? `Szenzorállapot: ${state.toLowerCase().replace(/_/g, ' ')}`
}

// A Guardian app riasztásai (`lastAlarm.kind`), az ismeretlenek a nyers névvel.
const ALARMS: Record<string, string> = {
  'alert.receiver.battery.low': 'a telefon akkumulátora lemerülőben',
  'alert.transmitter.battery.low': 'a transzmitter töltöttsége alacsony',
  'alert.sensor.expired': 'a szenzor lejárt',
  'alert.sensor.change': 'szenzorcsere',
  'alert.sg.low': 'alacsony vércukor',
  'alert.sg.high': 'magas vércukor',
  'alert.sg.urgent.low': 'sürgős alacsony vércukor',
}
export function alarmText(kind: string): string {
  return ALARMS[kind] ?? kind.replace(/^alert\./, '').replace(/[._]/g, ' ')
}

/** „3 nap 19 óra” / „7 óra” formában a hátralévő idő. */
export function hoursLeftText(h: number): string {
  const d = Math.floor(h / 24)
  const r = Math.round(h % 24)
  return d > 0 ? (r > 0 ? `${d} nap ${r} óra` : `${d} nap`) : `${Math.max(1, r)} óra`
}
