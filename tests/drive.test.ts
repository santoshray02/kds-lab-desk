import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { createBackup, validateBackup } from '../src/main/backup'
import { DriveClient, DriveError, type SecretStore, type Secrets } from '../src/main/gdrive'
import { lockBackup, unlockBackup, WrongPassword } from '../src/main/lockedBackup'
import { connectDrive, disconnectDrive, driveBackupIfDue, driveStatus, fetchDriveBackup, listDriveBackups, runDriveBackup, KEEP_ON_DRIVE, type CloudDeps } from '../src/main/cloudBackup'
import { getSettings } from '../src/main/settings'

/** A tiny pretend Google: sign-in, token refresh, and the hidden app folder of Drive. */
function mockGoogle() {
  const files: { id: string; name: string; data: Buffer; createdTime: string }[] = []
  const st = { challenge: '', refresh: 'refresh-1', access: 'access-1', revoked: false, quotaFull: false, tokenCalls: 0, n: 0, lastScope: '' }
  const server: Server = createServer((rq, rs) => {
    const u = new URL(rq.url!, 'http://x')
    const chunks: Buffer[] = []
    rq.on('data', (c) => chunks.push(c))
    rq.on('end', () => {
      const body = Buffer.concat(chunks)
      const json = (o: unknown, code = 200) => rs.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o))
      if (u.pathname === '/token') {
        st.tokenCalls++
        const f = new URLSearchParams(body.toString())
        if (f.get('grant_type') === 'authorization_code') {
          const ok = f.get('code') === 'the-code' && createHash('sha256').update(f.get('code_verifier')!).digest('base64url') === st.challenge
          return ok ? json({ access_token: st.access, refresh_token: st.refresh, expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400)
        }
        if (f.get('grant_type') === 'refresh_token') {
          return f.get('refresh_token') === st.refresh && !st.revoked ? json({ access_token: st.access, expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400)
        }
      }
      if (u.pathname === '/revoke') { st.revoked = true; return json({}) }
      if (rq.headers.authorization !== `Bearer ${st.access}`) return json({ error: 'unauthorized' }, 401)
      if (u.pathname === '/userinfo') return json({ email: 'owner@example.test' })
      if (u.pathname === '/upload/files' && rq.method === 'POST') {
        if (st.quotaFull) return json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403)
        const meta = JSON.parse(body.toString())
        if (!meta.parents?.includes('appDataFolder')) return json({}, 400)
        st.n++
        return rs.writeHead(200, { location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload/session/${st.n}?name=${encodeURIComponent(meta.name)}` }).end()
      }
      if (u.pathname.startsWith('/upload/session/') && rq.method === 'PUT') {
        const id = `f${u.pathname.split('/').pop()}`
        const createdTime = new Date(Date.UTC(2026, 0, 1) + st.n * 86_400_000).toISOString()
        files.push({ id, name: u.searchParams.get('name')!, data: body, createdTime })
        return json({ id })
      }
      if (u.pathname === '/files' && rq.method === 'GET') {
        if (u.searchParams.get('spaces') !== 'appDataFolder') return json({}, 400)
        const sorted = [...files].sort((a, b) => b.createdTime.localeCompare(a.createdTime))
        return json({ files: sorted.map((f) => ({ id: f.id, name: f.name, size: String(f.data.length), createdTime: f.createdTime })) })
      }
      const m = /^\/files\/(.+)$/.exec(u.pathname)
      if (m) {
        const i = files.findIndex((f) => f.id === m[1])
        if (i < 0) return json({}, 404)
        if (rq.method === 'DELETE') { files.splice(i, 1); return rs.writeHead(204).end() }
        return rs.writeHead(200).end(files[i].data)
      }
      json({}, 404)
    })
  })
  return { server, files, st }
}

const memStore = (): SecretStore & { value: Secrets | null } => {
  const s = { value: null as Secrets | null, read: () => s.value, write: (x: Secrets) => { s.value = x }, clear: () => { s.value = null } }
  return s
}

let g: ReturnType<typeof mockGoogle>
let base = ''
let work: string
let db: Db
let deps: CloudDeps
let secrets: ReturnType<typeof memStore>
let client: DriveClient

const open = (st: typeof g.st) => async (url: string) => {
  const u = new URL(url)
  st.challenge = u.searchParams.get('code_challenge')!
  st.lastScope = u.searchParams.get('scope')!
  const back = new URL(u.searchParams.get('redirect_uri')!)
  back.searchParams.set('code', 'the-code')
  back.searchParams.set('state', u.searchParams.get('state')!)
  await fetch(back) // the "browser" returns to the program
}

beforeAll(async () => {
  g = mockGoogle()
  await new Promise<void>((r) => g.server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
})
afterAll(() => void g.server.close())

beforeEach(() => {
  g.files.length = 0
  Object.assign(g.st, { challenge: '', refresh: 'refresh-1', access: 'access-1', revoked: false, quotaFull: false, tokenCalls: 0, n: 0 })
  work = mkdtempSync(join(tmpdir(), 'kds-drive-test-'))
  db = openDb(join(work, 'kds.db'))
  db.run("INSERT INTO patients(name, title, sex, phone, village, source, created_at, updated_at) VALUES('Drive Person','Mr','M','9800000099','','manual','2026-01-01','2026-01-01')")
  secrets = memStore()
  client = new DriveClient(
    { clientId: 'cid', clientSecret: 'sec', endpoints: { auth: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke`, userinfo: `${base}/userinfo`, api: base, upload: `${base}/upload` } },
    secrets
  )
  deps = { drive: client, secrets }
})

describe('password-locked backup file', () => {
  it('round-trips a backup folder and refuses a wrong password', () => {
    const dir = createBackup(db, work, join(work, 'b'), new Date())
    mkdirSync(join(dir, 'attachments'), { recursive: true })
    writeFileSync(join(dir, 'attachments', 'a.txt'), 'hello')
    const locked = lockBackup(dir, 'correct horse')
    expect(locked.includes(Buffer.from('SQLite format'))).toBe(false) // nothing readable inside
    const out = join(work, 'open')
    expect(() => unlockBackup(locked, 'wrong one', out)).toThrow(WrongPassword)
    unlockBackup(locked, 'correct horse', out)
    expect(readFileSync(join(out, 'attachments', 'a.txt'), 'utf8')).toBe('hello')
    expect(validateBackup(out).ok).toBe(true)
  })
  it('detects a damaged file and a file that is not a backup', () => {
    const dir = createBackup(db, work, join(work, 'b'), new Date())
    const locked = lockBackup(dir, 'pw-123456')
    locked[locked.length - 20] ^= 0xff
    expect(() => unlockBackup(locked, 'pw-123456', join(work, 'o1'))).toThrow(WrongPassword)
    expect(() => unlockBackup(Buffer.from('not a backup at all, just text'), 'x', join(work, 'o2'))).toThrow(/not a KDS/)
  })
})

describe('Google Drive backup against a pretend Google', () => {
  it('connects through the browser with PKCE, asks only for the hidden app folder, and shows who is connected', async () => {
    const s = await connectDrive(db, deps, 'lab-secret', open(g.st))
    expect(s).toMatchObject({ connected: true, account: 'owner@example.test' })
    expect(g.st.lastScope).toBe('https://www.googleapis.com/auth/drive.appdata email')
    expect(secrets.value).toEqual({ refreshToken: 'refresh-1', password: 'lab-secret' })
    // the token and password must never be in the database (backups would carry them)
    const all = JSON.stringify(db.all('SELECT key, value FROM settings'))
    expect(all).not.toContain('refresh-1')
    expect(all).not.toContain('lab-secret')
  })

  it('refuses a short password and a sign-in with a wrong state', async () => {
    await expect(connectDrive(db, deps, '123', open(g.st))).rejects.toThrow(/at least 6/)
    const evil = async (url: string) => {
      const back = new URL(new URL(url).searchParams.get('redirect_uri')!)
      back.searchParams.set('code', 'the-code')
      back.searchParams.set('state', 'forged')
      await fetch(back)
      const real = new URL(url)
      real.searchParams.get('state') // the real redirect never happens, so the sign-in must time out
    }
    await expect(client.authorize((u) => void evil(u), 300)).rejects.toThrow(/too long/)
  })

  it('uploads a locked copy, which can be listed, downloaded and restored on another PC', async () => {
    await connectDrive(db, deps, 'lab-secret', open(g.st))
    await runDriveBackup(db, work, deps, new Date('2026-03-01T22:00:00Z'))
    const list = await listDriveBackups(deps)
    expect(list).toHaveLength(1)
    expect(list[0].name).toMatch(/^KDS-backup-2026-03-01-22-00-00\.kdsb$/)
    expect(g.files[0].data.includes(Buffer.from('Drive Person'))).toBe(false) // Google only ever sees locked bytes
    expect(getSettings(db).driveBackup.lastBackup).toBe('2026-03-01T22:00:00.000Z')

    // a new PC: connect again with the same password, then fetch
    const { path, tmp } = await fetchDriveBackup(deps, list[0].id)
    expect(validateBackup(path).info?.patients).toBe(1)
    rmSync(tmp, { recursive: true, force: true })
    await expect(fetchDriveBackup(deps, list[0].id, 'not the password')).rejects.toThrow(/Wrong backup password/)
  })

  it(`keeps only the newest ${KEEP_ON_DRIVE} on Drive`, async () => {
    await connectDrive(db, deps, 'lab-secret', open(g.st))
    for (let i = 0; i < KEEP_ON_DRIVE + 2; i++) await runDriveBackup(db, work, deps, new Date(Date.UTC(2026, 3, 1 + i, 22)))
    const list = await listDriveBackups(deps)
    expect(list).toHaveLength(KEEP_ON_DRIVE)
    expect(list[0].name).toContain('2026-05-02') // newest kept
    expect(list.at(-1)!.name).toContain('2026-04-03') // the two oldest are gone
  }, 60_000)

  it('uploads only when the last copy is over 20 hours old, and never throws', async () => {
    await connectDrive(db, deps, 'lab-secret', open(g.st))
    const t0 = new Date('2026-06-01T22:00:00Z')
    expect(await driveBackupIfDue(db, work, deps, t0)).toBe(true)
    expect(await driveBackupIfDue(db, work, deps, new Date(t0.getTime() + 3 * 3600_000))).toBe(false)
    g.st.quotaFull = true
    expect(await driveBackupIfDue(db, work, deps, new Date(t0.getTime() + 21 * 3600_000))).toBe(false)
    const s = getSettings(db).driveBackup
    expect(s.lastError).toMatch(/Drive is full/)
    expect(s.lastBackup).toBe(t0.toISOString()) // the failed try did not count as a backup
    g.st.quotaFull = false
    expect(await driveBackupIfDue(db, work, deps, new Date(t0.getTime() + 22 * 3600_000))).toBe(true)
    expect(getSettings(db).driveBackup.lastError).toBe('')
  })

  it('tells the owner when there is no internet', async () => {
    await connectDrive(db, deps, 'lab-secret', open(g.st))
    const offline = new DriveClient({ clientId: 'cid', clientSecret: 's', endpoints: { auth: '', token: 'http://127.0.0.1:9/t', revoke: '', userinfo: '', api: 'http://127.0.0.1:9', upload: 'http://127.0.0.1:9' } }, secrets)
    await expect(runDriveBackup(db, work, { drive: offline, secrets })).rejects.toThrow(/Cannot reach Google/)
    expect(getSettings(db).driveBackup.lastError).toMatch(/Cannot reach Google/)
  })

  it('reports a revoked sign-in so the owner can connect again', async () => {
    await connectDrive(db, deps, 'lab-secret', open(g.st))
    g.st.revoked = true
    ;(client as unknown as { cache: null }).cache = null
    await expect(runDriveBackup(db, work, deps)).rejects.toThrow(/disconnected from the Google account/)
  })

  it('disconnect revokes at Google, forgets the secrets, and leaves the backups on Drive', async () => {
    await connectDrive(db, deps, 'lab-secret', open(g.st))
    await runDriveBackup(db, work, deps)
    const s = await disconnectDrive(db, deps)
    expect(s.connected).toBe(false)
    expect(g.st.revoked).toBe(true)
    expect(secrets.value).toBeNull()
    expect(g.files).toHaveLength(1)
    expect(existsSync(work)).toBe(true)
    expect(driveStatus(db, deps).connected).toBe(false)
  })

  it('says so when the program has no Google sign-in set up yet', async () => {
    const none = new DriveClient({ clientId: '', clientSecret: '' }, secrets)
    expect(none.configured).toBe(false)
    await expect(connectDrive(db, { drive: none, secrets }, 'lab-secret', () => undefined)).rejects.toThrow(/not set up/)
    expect(DriveError).toBeDefined()
  })
})
