// Passkey (WebAuthn): Face ID / Touch ID belépés. A jelszó marad tartaléknak.
import type { H3Event } from 'h3'
import { db } from './db'

export const RP_NAME = 'Cukornapló'
// Egyfelhasználós app: a passkey-k mind ugyanahhoz a (fix) felhasználóhoz tartoznak.
export const USER_NAME = 'cukornaplo'
export const USER_ID = new TextEncoder().encode('cukornaplo-owner')

/** RP ID (gépnév) és origin a kérésből, reverse proxy / Cloudflare mögött is. */
export function rpOf(event: H3Event): { rpID: string; origin: string } {
  const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
  return { rpID: url.hostname, origin: url.origin }
}

export interface PasskeyRow {
  id: string
  public_key: Uint8Array
  counter: number
  transports: string
  name: string
  created_at: number
  last_used: number | null
}

export function listPasskeys(): PasskeyRow[] {
  return db().prepare('SELECT * FROM passkeys ORDER BY created_at').all() as unknown as PasskeyRow[]
}

export function passkeyById(id: string): PasskeyRow | undefined {
  return db().prepare('SELECT * FROM passkeys WHERE id = ?').get(id) as unknown as PasskeyRow | undefined
}

export function hasPasskey(): boolean {
  return !!db().prepare('SELECT 1 FROM passkeys LIMIT 1').get()
}

export function transportsOf(row: PasskeyRow): string[] {
  return row.transports ? row.transports.split(',') : []
}
