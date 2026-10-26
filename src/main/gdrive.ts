import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

/** Only the app's own hidden folder in the owner's Drive, plus the e-mail address to show who is connected. */
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata email'

export interface DriveEndpoints {
  auth: string
  token: string
  revoke: string
  userinfo: string
  api: string
  upload: string
}

export const GOOGLE_ENDPOINTS: DriveEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3'
}

export class DriveError extends Error {
  constructor(message: string, public status = 0) {
    super(message)
  }
}

/** The secrets live in a small file next to the database, encrypted by Windows for this user; never inside the database, so backups do not carry them. */
export interface Secrets {
  refreshToken: string
  password: string
}
export interface SecretStore {
  read(): Secrets | null
  write(s: Secrets): void
  clear(): void
}

export function fileSecretStore(path: string, enc: (s: string) => Buffer, dec: (b: Buffer) => string): SecretStore {
  return {
    read() {
      if (!existsSync(path)) return null
      try {
        return JSON.parse(dec(readFileSync(path))) as Secrets
      } catch {
        return null
      }
    },
    write(s) {
      writeFileSync(path, enc(JSON.stringify(s)))
    },
    clear() {
      rmSync(path, { force: true })
    }
  }
}

export interface RemoteFile {
  id: string
  name: string
  createdAt: string
  sizeBytes: number
}

export interface DriveConfig {
  clientId: string
  clientSecret: string
  endpoints?: DriveEndpoints
  fetch?: typeof fetch
}

const b64url = (b: Buffer) => b.toString('base64url')

const NETWORK = 'Cannot reach Google. Check the internet connection and try again.'

export class DriveClient {
  private ep: DriveEndpoints
  private f: typeof fetch
  private cache: { token: string; until: number } | null = null

  constructor(private cfg: DriveConfig, private secrets: SecretStore) {
    this.ep = cfg.endpoints ?? GOOGLE_ENDPOINTS
    this.f = cfg.fetch ?? fetch
  }

  get configured(): boolean {
    return !!this.cfg.clientId
  }

  private async req(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.f(url, init)
    } catch {
      throw new DriveError(NETWORK)
    }
  }

  /** Signs in through the browser (loopback redirect with PKCE). `openBrowser` shows the Google page to the owner. */
  async authorize(openBrowser: (url: string) => void, timeoutMs = 5 * 60_000): Promise<{ refreshToken: string; email: string }> {
    if (!this.configured) throw new DriveError('Google Drive backup is not set up in this version of the program.')
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const state = b64url(randomBytes(16))
    const server = createServer()
    const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DriveError('Sign-in took too long. Please try again.')), timeoutMs)
      server.on('request', (rq, rs) => {
        const u = new URL(rq.url ?? '/', 'http://127.0.0.1')
        if (u.pathname !== '/') return void rs.writeHead(404).end()
        const page = (msg: string) => rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>KDS Lab Desk</title><body style="font:20px Segoe UI,Arial;text-align:center;margin-top:20vh">${msg}</body>`)
        if (u.searchParams.get('state') !== state) return void page('This sign-in link is not valid. Please go back to KDS Lab Desk and try again.')
        const c = u.searchParams.get('code')
        if (!c) {
          page('Google Drive was not connected. You can close this tab.')
          clearTimeout(timer)
          return reject(new DriveError('Google Drive was not connected.'))
        }
        page('✔ Google Drive is connected.<br>You can close this tab and go back to KDS Lab Desk.')
        clearTimeout(timer)
        resolve({ code: c, redirect: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        const q = new URLSearchParams({
          client_id: this.cfg.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES,
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent'
        })
        openBrowser(`${this.ep.auth}?${q}`)
      })
    }).finally(() => server.close())

    const r = await this.req(this.ep.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code.code, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret,
        redirect_uri: code.redirect, grant_type: 'authorization_code', code_verifier: verifier
      })
    })
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!r.ok || !j.access_token || !j.refresh_token) throw new DriveError('Google did not accept the sign-in. Please try again.', r.status)
    this.cache = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 }
    const me = await this.req(this.ep.userinfo, { headers: { authorization: `Bearer ${j.access_token}` } })
    const email = me.ok ? ((await me.json()) as { email?: string }).email ?? '' : ''
    return { refreshToken: j.refresh_token, email }
  }

  private async token(): Promise<string> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.token
    const s = this.secrets.read()
    if (!s?.refreshToken) throw new DriveError('Google Drive is not connected.')
    const r = await this.req(this.ep.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' })
    })
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }
    if (!r.ok || !j.access_token) {
      throw new DriveError(j.error === 'invalid_grant' ? 'Google Drive was disconnected from the Google account. Connect it again.' : 'Could not sign in to Google Drive.', r.status)
    }
    this.cache = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 }
    return this.cache.token
  }

  private async authed(url: string, init: RequestInit = {}): Promise<Response> {
    const r = await this.req(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await this.token()}` } })
    if (r.status === 403 || r.status === 429) {
      const t = await r.clone().text()
      if (/storageQuotaExceeded|quota/i.test(t)) throw new DriveError('The Google Drive is full. Free some space or use another Google account.', r.status)
    }
    return r
  }

  async list(): Promise<RemoteFile[]> {
    const out: RemoteFile[] = []
    let page = ''
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,size,createdTime)', orderBy: 'createdTime desc', pageSize: '100', q: "name contains 'KDS-backup'" })
      if (page) q.set('pageToken', page)
      const r = await this.authed(`${this.ep.api}/files?${q}`)
      if (!r.ok) throw new DriveError('Could not read the list of backups on Google Drive.', r.status)
      const j = (await r.json()) as { nextPageToken?: string; files?: { id: string; name: string; size?: string; createdTime: string }[] }
      for (const f of j.files ?? []) out.push({ id: f.id, name: f.name, createdAt: f.createdTime, sizeBytes: Number(f.size) || 0 })
      page = j.nextPageToken ?? ''
    } while (page)
    return out
  }

  async upload(name: string, data: Buffer): Promise<string> {
    const start = await this.authed(`${this.ep.upload}/files?uploadType=resumable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream', 'x-upload-content-length': String(data.length) },
      body: JSON.stringify({ name, parents: ['appDataFolder'] })
    })
    const loc = start.headers.get('location')
    if (!start.ok || !loc) throw new DriveError('Google Drive refused the backup.', start.status)
    const put = await this.authed(loc, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(data) })
    if (!put.ok) throw new DriveError('The backup could not be uploaded to Google Drive.', put.status)
    return ((await put.json()) as { id: string }).id
  }

  async download(id: string): Promise<Buffer> {
    const r = await this.authed(`${this.ep.api}/files/${encodeURIComponent(id)}?alt=media`)
    if (!r.ok) throw new DriveError('The backup could not be downloaded from Google Drive.', r.status)
    return Buffer.from(await r.arrayBuffer())
  }

  async remove(id: string): Promise<void> {
    const r = await this.authed(`${this.ep.api}/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok && r.status !== 404) throw new DriveError('Could not delete an old backup on Google Drive.', r.status)
  }

  /** Tells Google to forget this sign-in. Best effort: a failure must not stop the owner disconnecting. */
  async revoke(): Promise<void> {
    const s = this.secrets.read()
    this.cache = null
    if (!s?.refreshToken) return
    try {
      await this.f(this.ep.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: s.refreshToken }) })
    } catch {
      /* offline: the token is still removed from this PC */
    }
  }
}
