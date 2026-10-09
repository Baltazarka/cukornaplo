// Web Push értesítések (iPhone: kezdőképernyőre tett PWA, iOS 16.4+). A VAPID-kulcspár az első
// használatkor jön létre, és a settings.json `vapid` kulcsán marad; a kulcs cseréje után minden
// eszközön újra engedélyezni kell az értesítést.
import webpush from 'web-push'
import { db } from './db'
import { mailSettings } from './mail'

interface Vapid { publicKey: string; privateKey: string }

function vapid(): Vapid {
  let v = setting<Vapid>('vapid', null)
  if (!v?.publicKey || !v?.privateKey) {
    v = webpush.generateVAPIDKeys()
    saveSettings({ vapid: v })
  }
  return v
}

export function vapidPublicKey(): string {
  return vapid().publicKey
}

/** A VAPID „subject”: https címe az oldalnak, vagy a feladó e-mail-címe. */
function subject(): string {
  const url = mailSettings().publicUrl.trim()
  if (/^https:\/\//i.test(url)) return url
  const mail = setting<{ email?: string }>('notify', null)?.email || mailSettings().user
  return `mailto:${mail || 'admin@example.com'}`
}

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

export function validSubscription(b: any): b is PushSub {
  return typeof b?.endpoint === 'string' && /^https:\/\//.test(b.endpoint) && b.endpoint.length < 1000
    && typeof b?.keys?.p256dh === 'string' && typeof b?.keys?.auth === 'string'
}

export function saveSubscription(sub: PushSub, name: string): void {
  db().prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, name, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, name = excluded.name`)
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, name, Math.floor(Date.now() / 1000))
}

export function removeSubscription(endpoint: string): void {
  db().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
}

export function listSubscriptions(): { endpoint: string; name: string; createdAt: number }[] {
  const rows = db().prepare('SELECT endpoint, name, created_at FROM push_subscriptions ORDER BY created_at').all() as any[]
  return rows.map((r) => ({ endpoint: String(r.endpoint), name: String(r.name), createdAt: Number(r.created_at) }))
}

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

/** Minden feliratkozott eszközre küld; a lejárt (404 / 410) előfizetéseket törli. Visszaadja a sikeres és hibás küldések számát. */
export async function sendPush(payload: PushPayload, opts: { urgency?: 'very-low' | 'low' | 'normal' | 'high'; ttl?: number } = {}): Promise<{ sent: number; failed: number; lastError?: string }> {
  const rows = db().prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as any[]
  if (!rows.length) return { sent: 0, failed: 0 }
  const v = vapid()
  const options = { vapidDetails: { subject: subject(), publicKey: v.publicKey, privateKey: v.privateKey }, TTL: opts.ttl ?? 600, urgency: opts.urgency ?? 'high' }
  let sent = 0
  let failed = 0
  let lastError: string | undefined
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(payload), options)
      sent++
    } catch (e: any) {
      failed++
      if (e?.statusCode === 404 || e?.statusCode === 410) removeSubscription(r.endpoint)
      else lastError = `${e?.statusCode ?? ''} ${e?.body ?? e?.message ?? e}`.trim()
    }
  }))
  return { sent, failed, lastError }
}
