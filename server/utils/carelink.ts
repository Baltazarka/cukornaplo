// CareLink (Medtronic felhő) kliens: a carelink.php átírása TypeScriptre.
// Nem hivatalos, visszafejtett API (xDrip+ CareLink Follower / carelink-python-client módszer).
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MGDL_PER_MMOL, zonedToTs } from './normalize'
import { db, storeRows, type Row } from './db'

const CL_DISCOVERY_URL = 'https://clcloud.minimed.eu/connect/carepartner/v13/discover/android/3.6'
const CL_REGION = 'EU'
const CL_USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 10; Nexus 5X Build/QQ3A.200805.001)'
export const CL_RAW_FILE = 'carelink_last.json'

function rawPath(): string {
  return join(dataDir(), CL_RAW_FILE)
}

export function clState(): Record<string, any> {
  const s = setting<Record<string, any>>('carelink')
  return s && typeof s === 'object' ? s : {}
}

export function clSave(changes: Record<string, any>): void {
  saveSettings({ carelink: { ...clState(), ...changes } })
}

export function clIsConnected(): boolean {
  return !!clState().refresh_token
}

async function clHttp(
  method: string, url: string, headers: Record<string, string> = {}, body: string | null = null,
): Promise<[number, string]> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { 'User-Agent': CL_USER_AGENT, ...headers },
      body: body ?? undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
    })
  } catch (e: any) {
    throw new Error('Hálózati hiba: ' + (e?.message ?? String(e)))
  }
  return [res.status, await res.text()]
}

function clJson(body: string): any | null {
  try {
    const j = JSON.parse(body)
    return j && typeof j === 'object' ? j : null
  } catch {
    return null
  }
}

/** A CareLink végpontjai és az Auth0 beállítások (1 napig tárolva). */
export async function clConfig(force = false): Promise<Record<string, any>> {
  const s = clState()
  if (!force && s.config && (s.config_at ?? 0) > Date.now() / 1000 - 86400) return s.config

  let [code, body] = await clHttp('GET', CL_DISCOVERY_URL)
  const disc = clJson(body)
  if (code !== 200 || !disc) throw new Error(`A CareLink konfiguráció nem érhető el (HTTP ${code}).`)

  let region: any = null
  for (const c of disc.CP ?? []) if (String(c.region ?? '').toUpperCase() === CL_REGION) region = c
  if (!region) throw new Error('Az EU régió nem található a CareLink konfigurációban.')

  const ssoKey = region.UseSSOConfiguration ?? 'Auth0SSOConfiguration'
  ;[code, body] = await clHttp('GET', String(region[ssoKey]))
  const sso = clJson(body)
  if (code !== 200 || !sso || !sso.client) throw new Error(`A CareLink belépési beállítások nem érhetők el (HTTP ${code}).`)

  const srv = sso.server
  const port = srv.port ?? 443
  const authBase = 'https://' + srv.hostname + (port != 443 ? ':' + port : '') +
    (srv.prefix ? '/' + String(srv.prefix).replace(/^\/+/, '').replace(/\/+$/, '') : '')
  const config = {
    auth_base: authBase,
    authorize_path: sso.system_endpoints.authorization_endpoint_path,
    token_path: sso.system_endpoints.token_endpoint_path,
    client_id: sso.client.client_id,
    scope: sso.client.scope,
    redirect_uri: sso.client.redirect_uri,
    audience: sso.client.audience ?? '',
    carelink_host: new URL(String(region.baseUrlCareLink)).host,
    cumulus_base: String(region.baseUrlCumulus).replace(/\/+$/, ''),
    cloud_host: new URL(String(region.baseUrlCumulus)).host,
  }
  clSave({ config, config_at: Math.floor(Date.now() / 1000) })
  return config
}

export async function clAuthorizeUrl(): Promise<string> {
  const c = await clConfig()
  const q = new URLSearchParams({
    client_id: c.client_id, response_type: 'code', scope: c.scope,
    redirect_uri: c.redirect_uri, audience: c.audience,
  })
  return c.auth_base + c.authorize_path + '?' + q.toString()
}

export function clExtractCode(input: string): string | null {
  input = input.trim()
  const m = input.match(/[?&#]code=([^&#\s"']+)/)
  if (m) return decodeURIComponent(m[1])
  if (/^[A-Za-z0-9_\-.~]{10,}$/.test(input)) return input
  return null
}

function clStoreTokens(tok: any): void {
  const changes: Record<string, any> = {
    access_token: tok.access_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(tok.expires_in ?? 3600),
  }
  if (tok.refresh_token) changes.refresh_token = tok.refresh_token
  clSave(changes)
}

export async function clConnectWithCode(input: string): Promise<any> {
  const code = clExtractCode(input)
  if (code === null) {
    throw new Error('Nem találtam kódot a beillesztett szövegben. A „com.medtronic.carepartner:/sso?code=…” kezdetű címet másold be.')
  }
  const c = await clConfig()
  const [status, body] = await clHttp('POST', c.auth_base + c.token_path,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    new URLSearchParams({ grant_type: 'authorization_code', client_id: c.client_id, code, redirect_uri: c.redirect_uri }).toString())
  const tok = clJson(body)
  if (status !== 200 || !tok?.access_token) {
    const msg = tok?.error_description ?? tok?.error ?? `HTTP ${status}`
    throw new Error(`A CareLink nem fogadta el a kódot (${msg}). A kód csak pár percig érvényes és egyszer használható: lépj be újra, és rögtön másold be.`)
  }
  clStoreTokens(tok)
  clSave({ session: null, last_error: null })
  return clSession(true)
}

async function clRefresh(): Promise<void> {
  const s = clState()
  if (!s.refresh_token) throw new Error('Nincs CareLink kapcsolat. Lépj be újra.')
  const c = await clConfig()
  const [status, body] = await clHttp('POST', c.auth_base + c.token_path,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    new URLSearchParams({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: s.refresh_token }).toString())
  const tok = clJson(body)
  if (status !== 200 || !tok?.access_token) {
    // Csak a valódi invalid_grant bontja a kapcsolatot; átmeneti 401/403-nál (pl. botvédelem) megőrizzük a tokent.
    if (tok?.error === 'invalid_grant') {
      clSave({ refresh_token: null, access_token: null })
      throw new Error('A CareLink belépés lejárt. Lépj be újra: Beállítások → CareLink.')
    }
    throw new Error(`A CareLink token frissítése nem sikerült (HTTP ${status}).`)
  }
  clStoreTokens(tok)
}

async function clAccessToken(): Promise<string> {
  let s = clState()
  if (!s.access_token || (s.expires_at ?? 0) < Date.now() / 1000 + 300) {
    await clRefresh()
    s = clState()
  }
  return String(s.access_token)
}

/** Hitelesített kérés; 401/403 esetén egyszer frissíti a tokent és újrapróbálja. */
async function clApi(method: string, url: string, jsonBody: any = null): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = { Authorization: 'Bearer ' + (await clAccessToken()), Accept: 'application/json' }
    let body: string | null = null
    if (jsonBody !== null) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(jsonBody)
    }
    const [status, resp] = await clHttp(method, url, headers, body)
    if ((status === 401 || status === 403) && attempt === 0) {
      await clRefresh()
      continue
    }
    if (status < 200 || status >= 300) throw new Error(`CareLink hiba: HTTP ${status} (${new URL(url).pathname})`)
    const data = clJson(resp)
    if (data === null && resp.trim() !== '' && resp.trim() !== 'null') {
      throw new Error(`A CareLink nem JSON választ adott (${new URL(url).pathname}).`)
    }
    return data ?? {}
  }
  throw new Error('CareLink: a hitelesítés nem sikerült.')
}

/** Fiókadatok: szerepkör, felhasználónév, követett páciensek (6 óráig tárolva). */
export async function clSession(force = false): Promise<any> {
  const s = clState()
  if (!force && s.session && (s.session_at ?? 0) > Date.now() / 1000 - 6 * 3600) return s.session
  const c = await clConfig()
  const base = 'https://' + c.carelink_host
  const user = await clApi('GET', base + '/patient/users/me')
  const profile = await clApi('GET', base + '/patient/users/me/profile')
  const role = String(user.role ?? '')
  const isCarePartner = ['CARE_PARTNER', 'CARE_PARTNER_OUS'].includes(role)
  let m2m = false
  try {
    m2m = !!(await clApi('GET', base + '/patient/configuration/system/personal.cp.m2m.enabled')).value
  } catch {
    m2m = false
  }
  const patients: any[] = []
  if (isCarePartner && m2m) {
    for (const p of await clApi('GET', base + '/patient/m2m/links/patients')) {
      if (p && typeof p === 'object' && p.username) {
        patients.push({
          username: String(p.username),
          name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
          device: String(p.lastDeviceFamily ?? ''),
          status: String(p.status ?? ''),
        })
      }
    }
  }
  const session = {
    username: String(profile.username ?? ''),
    name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    role, care_partner: isCarePartner, m2m, patients,
  }
  clSave({ session, session_at: Math.floor(Date.now() / 1000) })
  return session
}

function clParseTime(value: any): number | null {
  if (typeof value === 'number') return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value)
  if (typeof value !== 'string' || value.trim() === '') return null
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value.trim())
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!hasTz && iso) return zonedToTs(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0))
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
}

/** A nyers CareLink válaszból glükóz sorok (mmol/L), xDrip-szerű időzóna-javítással. */
export function clExtractGlucose(data: any): Row[] {
  const pd = data?.patientData && typeof data.patientData === 'object' ? data.patientData : data
  const sgs = pd?.sgs
  if (!Array.isArray(sgs)) return []

  let shift = 0
  const serverMs = pd.lastMedicalDeviceDataUpdateServerTime ?? pd.lastConduitUpdateServerDateTime ?? null
  const lastSg = pd.lastSG
  const lastTs = lastSg && typeof lastSg === 'object' ? clParseTime(lastSg.datetime ?? lastSg.timestamp ?? null) : null
  if (typeof serverMs === 'number' && serverMs > 1 && lastTs) {
    const diffHours = Math.round((serverMs / 1000 - lastTs) / 3600)
    if (diffHours !== 0 && Math.abs(diffHours) < 26) shift = diffHours * 3600
  }

  const rows: Row[] = []
  const now = Math.floor(Date.now() / 1000)
  for (const sg of sgs) {
    if (!sg || typeof sg !== 'object') continue
    const mgdl = sg.sg
    if (typeof mgdl !== 'number' || mgdl <= 0) continue
    let ts = clParseTime(sg.datetime ?? sg.timestamp ?? null)
    if (ts === null) continue
    ts += shift
    const mmol = Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10
    if (mmol < 1 || mmol > 35 || ts > now + 600) continue
    rows.push({ type: 'glucose', ts, value: mmol, subtype: null, source: 'CareLink' })
  }
  return rows
}

async function clFetchRecent(): Promise<any> {
  const c = await clConfig()
  const session = await clSession()
  const cloud = 'https://' + c.cloud_host

  if (session.care_partner && session.m2m) {
    const chosen = String(clState().patient ?? '')
    let patient: any = null
    for (const p of session.patients) {
      if (chosen === '' || p.username === chosen) { patient = p; break }
    }
    if (!patient) throw new Error('A gondozói fiók nem követ egy pácienst sem. A CareLinkben fogadd el a követési meghívást.')
    const family = String(patient.device).toUpperCase()
    if (family.includes('BLE') || family.includes('SIMPLERA')) {
      return clApi('POST', c.cumulus_base + '/display/message', {
        username: session.username, role: 'carepartner', patientId: patient.username, appVersion: '3.8.0',
      })
    }
    return clApi('GET', cloud + '/patient/m2m/connect/data/gc/patients/' + encodeURIComponent(patient.username))
  }
  return clApi('GET', cloud + '/patient/connect/data')
}

// Egyszerre csak egy lekérés fusson (poller + „Lekérés most” gomb) — in-process lánc.
let pollChain: Promise<any> = Promise.resolve()

export interface PollResult {
  ok: boolean; error?: string; received?: number; inserted?: number; duplicates?: number; latest?: number | null
}

export function clPoll(): Promise<PollResult> {
  const run = async (): Promise<PollResult> => {
    if (!clIsConnected()) return { ok: false, error: 'Nincs CareLink kapcsolat.' }
    clSave({ last_poll_at: Math.floor(Date.now() / 1000) })
    try {
      const data = await clFetchRecent()
      try {
        writeFileSync(rawPath(), JSON.stringify(data, null, 2))
      } catch { /* a nyers mentés hibája nem állítja meg a feldolgozást */ }
      const rows = clExtractGlucose(data)
      const [inserted, duplicates] = storeRows(rows)
      const latest = rows.length ? Math.max(...rows.map((r) => r.ts)) : null
      clSave({
        last_ok_at: Math.floor(Date.now() / 1000), last_error: null,
        last_count: rows.length, last_inserted: inserted, last_sg_at: latest,
      })
      return { ok: true, received: rows.length, inserted, duplicates, latest }
    } catch (e: any) {
      clSave({ last_error: e?.message ?? String(e), last_error_at: Math.floor(Date.now() / 1000) })
      return { ok: false, error: e?.message ?? String(e) }
    }
  }
  pollChain = pollChain.then(run, run)
  return pollChain
}

export function clReadRaw(): string {
  try {
    return readFileSync(rawPath(), 'utf8')
  } catch {
    return '{}'
  }
}

/** Ennyi ideig tartó sikertelen lekérés után jelez a főoldal (mp). */
const ALERT_ERROR_AFTER = 15 * 60
/** Ennyi idő friss szenzoradat nélkül már figyelmeztetés (mp). */
const ALERT_STALE_AFTER = 30 * 60

export interface ClAlert { level: 'error' | 'warning'; message: string; detail?: string }

/**
 * Figyelmeztetés a főoldalra, ha a CareLink-kapcsolat megszakadt, a lekérés tartósan hibás,
 * vagy régóta nem jött szenzoradat. Ha a CareLink sosem volt beállítva, nincs figyelmeztetés.
 */
export function clAlert(now = Math.floor(Date.now() / 1000)): ClAlert | null {
  const s = clState()
  const everUsed = !!(s.refresh_token || s.last_ok_at || s.session)
  if (!everUsed) return null
  if (!clIsConnected()) {
    return { level: 'error', message: 'A CareLink-kapcsolat megszakadt, a szenzorgörbe nem frissül.', detail: 'Jelentkezz be újra a Beállítások oldalon.' }
  }
  const interval = Number(process.env.CARELINK_INTERVAL ?? useRuntimeConfig().carelinkInterval)
  const lastOk = Number(s.last_ok_at ?? 0)
  if (interval > 0 && s.last_error && Number(s.last_error_at ?? 0) >= lastOk && now - lastOk > ALERT_ERROR_AFTER) {
    const mins = lastOk ? Math.round((now - lastOk) / 60) : null
    return {
      level: 'error',
      message: mins ? `A CareLink-lekérés ${mins} perce nem sikerül.` : 'A CareLink-lekérés nem sikerül.',
      detail: `Hiba: ${s.last_error}`,
    }
  }
  const row = db().prepare("SELECT MAX(ts) mx FROM entries WHERE type = 'glucose'").get() as { mx: number | null }
  const lastSg = Number(row?.mx ?? 0)
  if (lastSg && now - lastSg > ALERT_STALE_AFTER) {
    return {
      level: 'warning',
      message: `${staleText(now - lastSg)} nem jött új szenzoradat.`,
      detail: 'A CareLink elérhető, de nincs friss mérés: nézd meg a szenzort és a telefonos Medtronic appot (a telefonnak kell feltöltenie a CareLinkre).',
    }
  }
  return null
}

function staleText(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 120) return `${m} perce`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} órája` : `${Math.round(h / 24)} napja`
}
