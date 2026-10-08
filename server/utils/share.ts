// Ideiglenes, csak olvasható megtekintési link: véletlen token (csak a hash-e tárolódik),
// e-mailben kiküldve, 1 óráig érvényes, bármikor visszavonható.
import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { db } from './db'
import { authSession } from './auth'

export const SHARE_TTL_SEC = 3600

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export function createShare(email: string): { token: string; id: number; expiresAt: number } {
  const token = randomBytes(32).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const info = db().prepare('INSERT INTO share_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hash(token), email, now, now + SHARE_TTL_SEC)
  return { token, id: Number(info.lastInsertRowid), expiresAt: now + SHARE_TTL_SEC }
}

/** Érvényes (nem lejárt, nem visszavont) megosztás a token alapján. */
export function findShare(token: string): { id: number; email: string; expiresAt: number } | null {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
  const row = db().prepare('SELECT id, email, expires_at, revoked FROM share_tokens WHERE token_hash = ?').get(hash(token)) as any
  const now = Math.floor(Date.now() / 1000)
  if (!row || row.revoked || Number(row.expires_at) <= now) return null
  return { id: Number(row.id), email: String(row.email), expiresAt: Number(row.expires_at) }
}

/** A kérés egy érvényes megtekintői munkamenetből jön-e (különben null). */
export async function viewerOf(event: H3Event): Promise<{ id: number; email: string; expiresAt: number } | null> {
  const v = (await authSession(event)).data.viewer
  if (!v?.id) return null
  const row = db().prepare('SELECT email, expires_at, revoked FROM share_tokens WHERE id = ?').get(v.id) as any
  const now = Math.floor(Date.now() / 1000)
  if (!row || row.revoked || Number(row.expires_at) <= now) return null
  return { id: v.id, email: String(row.email), expiresAt: Number(row.expires_at) }
}

export function activeShares() {
  const now = Math.floor(Date.now() / 1000)
  db().prepare('DELETE FROM share_tokens WHERE expires_at < ?').run(now - 7 * 24 * 3600)
  return (db().prepare('SELECT id, email, created_at, expires_at, used_at FROM share_tokens WHERE revoked = 0 AND expires_at > ? ORDER BY created_at DESC')
    .all(now) as any[]).map((r) => ({
    id: Number(r.id), email: String(r.email), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), usedAt: r.used_at ? Number(r.used_at) : null,
  }))
}
