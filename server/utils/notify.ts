// Értesítések e-mailben: hipó-előjelzés és heti riport. A beállítások a settings.json `notify`,
// az állapot (utolsó küldések) a `notify_state` kulcson. A háttérciklus: server/plugins/notifier.ts.
import { sendMail, mailConfigured, mailSettings, mailLayout, mailStats, mailRangeBar, escapeHtml, EMAIL_RE } from './mail'
import { periodDigest, fmt1, fmtPct, type Digest } from './digest'
import { predictGlucose, type Prediction } from './predict'
import { sendPush, listSubscriptions } from './push'
import { addDaysYmd, todayYmd, minuteOfDayInTz } from './time'

export interface NotifySettings {
  email: string
  hypo: boolean
  /** A hipó-riasztás push értesítésként is menjen a feliratkozott eszközökre. */
  hypoPush: boolean
  /** Előrejelzési távolság, perc (15–60). */
  hypoHorizon: number
  weekly: boolean
  /** A heti riport napja: 1 = hétfő … 7 = vasárnap. */
  weeklyDay: number
  weeklyHour: number
}

interface NotifyState {
  lastHypo?: number
  lastWeekly?: string
  weeklyTry?: number
  lastError?: string
}

const DEFAULTS: NotifySettings = { email: '', hypo: false, hypoPush: true, hypoHorizon: 30, weekly: false, weeklyDay: 1, weeklyHour: 8 }
const HYPO_COOLDOWN_SEC = 60 * 60
const WEEKLY_RETRY_SEC = 30 * 60

export function notifySettings(): NotifySettings {
  return { ...DEFAULTS, ...(setting<Partial<NotifySettings>>('notify', null) ?? {}) }
}

export function notifyState(): NotifyState {
  return setting<NotifyState>('notify_state', null) ?? {}
}

function saveState(changes: Partial<NotifyState>) {
  saveSettings({ notify_state: { ...notifyState(), ...changes } })
}

export function validateNotify(b: any): { ok: true; value: NotifySettings } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const email = String(b?.email ?? '').trim()
  if (email && !EMAIL_RE.test(email)) errors.push('Érvénytelen e-mail-cím.')
  const int = (v: any, min: number, max: number, def: number) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= min && n <= max ? n : def
  }
  const value: NotifySettings = {
    email,
    hypo: b?.hypo === true,
    hypoPush: b?.hypoPush !== false,
    hypoHorizon: int(b?.hypoHorizon, 15, 60, DEFAULTS.hypoHorizon),
    weekly: b?.weekly === true,
    weeklyDay: int(b?.weeklyDay, 1, 7, DEFAULTS.weeklyDay),
    weeklyHour: int(b?.weeklyHour, 0, 23, DEFAULTS.weeklyHour),
  }
  if (value.weekly && !email) errors.push('Adj meg e-mail-címet a heti riporthoz.')
  if (value.hypo && !email && !value.hypoPush) errors.push('Adj meg e-mail-címet, vagy kapcsold be a telefonos (push) értesítést.')
  return errors.length ? { ok: false, errors } : { ok: true, value }
}

// ---- hipó-előjelzés ----

export function hypoMail(p: Prediction): { subject: string; text: string; html: string } {
  const now = `${fmt1(p.now.v)} mmol/L ${p.now.arrow}`
  const subject = p.currentLow
    ? `⚠️ Alacsony vércukor: ${now}`
    : `⚠️ Hipó-veszély: ${fmt1(p.predicted)} mmol/L várható ${p.horizon} percen belül`
  const lines = [
    `Utolsó érték: ${now} (${p.now.time}-kor${p.now.ageMin > 0 ? `, ${p.now.ageMin} perce` : ''})`,
    `Becsült érték ${p.horizon} perc múlva: ${fmt1(p.predicted)} mmol/L (a céltartomány alja: ${fmt1(p.low)})`,
    `Aktív inzulin: ${fmt1(p.iob)} E · Fel nem szívódott CH: ${p.cob} g`,
  ]
  const warn = '#d03b3b'
  const html = mailLayout({
    title: p.currentLow ? 'Alacsony a vércukrod' : 'Hipó-veszély',
    accent: warn,
    preheader: `${now} · becsült: ${fmt1(p.predicted)} mmol/L ${p.horizon} perc múlva`,
    bodyHtml: [
      mailStats([
        { label: 'Most', value: `${fmt1(p.now.v)} ${p.now.arrow}`, note: `${p.now.time}`, color: p.currentLow ? warn : undefined },
        { label: `${p.horizon} perc múlva`, value: fmt1(p.predicted), note: 'becsült, mmol/L', color: p.predicted < p.low ? warn : undefined },
      ], 2),
      mailStats([
        { label: 'Aktív inzulin', value: `${fmt1(p.iob)} E` },
        { label: 'Fel nem szívódott CH', value: `${p.cob} g` },
      ], 2),
      '<p style="margin:0 0 8px">Ellenőrizd az értéket, és ha szükséges, vegyél be gyors szénhidrátot.</p>',
    ].join('\n'),
    footerHtml: 'Ez egy becslés az inzulinadagokból, a szénhidrátból és a trendből; nem helyettesíti a szenzor és a pumpa riasztásait. A CareLink adatai akár 5–10 percet is késhetnek. Kikapcsolás: Beállítások → Értesítések.',
  })
  return { subject, text: [...lines, '', 'Ellenőrizd az értéket, és ha szükséges, vegyél be gyors szénhidrátot.', '', 'Ez egy becslés, nem helyettesíti a szenzor riasztásait.'].join('\n'), html }
}

/** A hipó-riasztás push szövege. */
export function hypoPushPayload(p: Prediction) {
  const now = `${fmt1(p.now.v)} ${p.now.arrow}`
  return {
    title: p.currentLow ? `⚠️ Alacsony vércukor: ${now}` : `⚠️ Hipó-veszély: ${fmt1(p.predicted)} várható`,
    body: p.currentLow
      ? `Most ${now} mmol/L (${p.now.time}). Ellenőrizd, és ha kell, vegyél be gyors szénhidrátot.`
      : `Most ${now} mmol/L, ${p.horizon} perc múlva kb. ${fmt1(p.predicted)} mmol/L. Aktív inzulin: ${fmt1(p.iob)} E.`,
    url: '/',
    tag: 'hypo',
  }
}

export async function checkHypoAlert(nowTs = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const s = notifySettings()
  if (!s.hypo) return false
  const useMail = !!s.email && mailConfigured()
  const usePush = s.hypoPush && listSubscriptions().length > 0
  if (!useMail && !usePush) return false
  if (nowTs - (notifyState().lastHypo ?? 0) < HYPO_COOLDOWN_SEC) return false
  const p = predictGlucose(s.hypoHorizon, nowTs)
  if (!p?.risk) return false
  // Előbb rögzítjük, hogy hibánál se küldjön percenként próbálkozva.
  saveState({ lastHypo: nowTs })
  const errors: string[] = []
  if (usePush) {
    const r = await sendPush(hypoPushPayload(p), { urgency: 'high', ttl: 15 * 60 }).catch((e: any) => ({ sent: 0, failed: 1, lastError: String(e?.message ?? e) }))
    if (!r.sent && r.lastError) errors.push(`push: ${r.lastError}`)
  }
  if (useMail) {
    try {
      const m = hypoMail(p)
      await sendMail(s.email, m.subject, m.text, m.html)
    } catch (e: any) {
      errors.push(`e-mail: ${e?.message ?? e}`)
    }
  }
  saveState({ lastError: errors.length ? `Hipó-értesítés – ${errors.join('; ')}` : undefined })
  return errors.length < (useMail ? 1 : 0) + (usePush ? 1 : 0)
}

// ---- heti riport ----

const delta = (cur: number | null | undefined, prev: number | null | undefined, unit: string, d = 1) => {
  if (cur == null || prev == null) return undefined
  const x = cur - prev
  if (Math.abs(x) < 0.5 * 10 ** -d) return 'mint az előző héten'
  return `${x > 0 ? '+' : '−'}${Math.abs(x).toLocaleString('hu-HU', { minimumFractionDigits: d, maximumFractionDigits: d })}${unit} az előző héthez`
}

export function weeklyMail(cur: Digest, prev: Digest): { subject: string; text: string; html: string } {
  const s = cur.stats
  const ps = prev.stats
  const label = (d: Digest) => `${d.start.slice(5).replace('-', '. ')}. – ${d.end.slice(5).replace('-', '. ')}.`
  const tir = s.n ? s.pct!.inRange : null
  const tbr = s.n ? s.pct!.low + s.pct!.veryLow : null
  const tar = s.n ? s.pct!.high + s.pct!.veryHigh : null
  const good = '#2e9e5b'
  const items = s.n
    ? [
        { label: 'Átlag', value: fmt1(s.avg), note: delta(s.avg, ps.n ? ps.avg : null, ' mmol/L') ?? 'mmol/L' },
        { label: 'Célban (TIR)', value: fmtPct(tir), note: delta(tir, ps.n ? ps.pct!.inRange : null, '%', 0), color: tir! >= 70 ? good : undefined },
        { label: 'GMI', value: s.gmi != null ? `${fmt1(s.gmi)}%` : '–', note: 'becsült HbA1c' },
        { label: 'Alacsony', value: fmtPct(tbr), note: `${cur.hypos} hipóesemény`, color: tbr! >= 4 ? '#d03b3b' : undefined },
        { label: 'Magas', value: fmtPct(tar), note: `a célérték fölött` },
        { label: 'Ingadozás', value: s.cv != null ? `CV ${Math.round(s.cv)}%` : '–', note: `SD ${fmt1(s.sd)}` },
        { label: 'Napi inzulin', value: cur.avgInsulin != null ? `${cur.avgInsulin.toLocaleString('hu-HU', { maximumFractionDigits: 0 })} E` : '–', note: 'naplózott átlag' },
        { label: 'Napi CH', value: cur.avgCarbs != null ? `${Math.round(cur.avgCarbs)} g` : '–', note: 'naplózott átlag' },
        { label: 'Szenzoradat', value: fmtPct(cur.coverage), note: 'lefedettség' },
      ]
    : []
  const dayRows = cur.rows
    .map((r) => `<tr>
      <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${escapeHtml(r.weekday)} <span style="color:#6b7280">${escapeHtml(r.label)}</span></td>
      <td align="right" style="padding:6px 8px;border-top:1px solid #e5e7eb">${r.avg != null ? fmt1(r.avg) : '–'}</td>
      <td align="right" style="padding:6px 8px;border-top:1px solid #e5e7eb">${r.inRange != null ? fmtPct(r.inRange) : '–'}</td>
      <td align="right" style="padding:6px 8px;border-top:1px solid #e5e7eb;${r.low ? 'color:#d03b3b' : ''}">${r.low != null ? fmtPct(r.low) : '–'}</td>
      <td align="right" style="padding:6px 8px;border-top:1px solid #e5e7eb">${r.insulin != null ? `${r.insulin.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} E` : '–'}</td>
    </tr>`)
    .join('')
  const url = mailSettings().publicUrl.trim().replace(/\/+$/, '')
  const title = `Heti összefoglaló · ${label(cur)}`
  const html = mailLayout({
    title,
    preheader: s.n ? `Átlag ${fmt1(s.avg)} mmol/L, célban ${fmtPct(tir)}.` : 'Nincs mérési adat erre a hétre.',
    bodyHtml: s.n
      ? [
          mailStats(items),
          `<div style="margin:4px 4px 12px">${mailRangeBar(s.pct!)}<div style="font-size:12px;color:#6b7280">Alacsony · <span style="color:#2e9e5b">cél (${fmt1(cur.low)}–${fmt1(cur.high)})</span> · magas</div></div>`,
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin:0 0 8px">
            <tr style="color:#6b7280;font-size:11px;text-transform:uppercase"><td style="padding:6px 8px">Nap</td><td align="right" style="padding:6px 8px">Átlag</td><td align="right" style="padding:6px 8px">Célban</td><td align="right" style="padding:6px 8px">Alacsony</td><td align="right" style="padding:6px 8px">Inzulin</td></tr>
            ${dayRows}
          </table>`,
        ].join('\n')
      : '<p style="margin:0 0 16px">Erre a hétre nem érkezett vércukor-adat.</p>',
    button: url ? { label: 'Cukornapló megnyitása', href: url } : undefined,
    footerHtml: 'Automatikus heti riport. Beállítás vagy kikapcsolás: Beállítások → Értesítések.',
  })
  const text = s.n
    ? [
        title,
        '',
        `Átlag: ${fmt1(s.avg)} mmol/L · Célban: ${fmtPct(tir)} · GMI: ${fmt1(s.gmi)}%`,
        `Alacsony: ${fmtPct(tbr)} (${cur.hypos} hipóesemény) · Magas: ${fmtPct(tar)}`,
        ...(cur.avgInsulin != null ? [`Napi inzulin: ${Math.round(cur.avgInsulin)} E`] : []),
        ...(url ? ['', url] : []),
      ].join('\n')
    : `${title}\n\nErre a hétre nem érkezett vércukor-adat.`
  return { subject: `Cukornapló – ${title}`, text, html }
}

/** Az elmúlt 7 teljes nap (tegnapig) és az előtte lévő 7 nap összefoglalója. */
export function weeklyDigests(): { cur: Digest; prev: Digest } {
  const end = addDaysYmd(todayYmd(), -1)
  return { cur: periodDigest(end, 7), prev: periodDigest(addDaysYmd(end, -7), 7) }
}

export async function sendWeekly(to: string): Promise<void> {
  const { cur, prev } = weeklyDigests()
  const m = weeklyMail(cur, prev)
  await sendMail(to, m.subject, m.text, m.html)
}

export async function checkWeekly(nowTs = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const s = notifySettings()
  if (!s.weekly || !s.email || !mailConfigured()) return false
  const today = todayYmd()
  const jsDay = new Date(`${today}T12:00:00Z`).getUTCDay()
  const isoDay = jsDay === 0 ? 7 : jsDay
  if (isoDay !== s.weeklyDay) return false
  if (Math.floor(minuteOfDayInTz(nowTs) / 60) < s.weeklyHour) return false
  const st = notifyState()
  if (st.lastWeekly === today) return false
  if (nowTs - (st.weeklyTry ?? 0) < WEEKLY_RETRY_SEC) return false
  saveState({ weeklyTry: nowTs })
  try {
    await sendWeekly(s.email)
    saveState({ lastWeekly: today, lastError: undefined })
    return true
  } catch (e: any) {
    saveState({ lastError: `Heti riport: ${e?.message ?? e}` })
    return false
  }
}
