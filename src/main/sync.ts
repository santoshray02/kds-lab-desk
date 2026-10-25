import { existsSync, readFileSync } from 'node:fs'
import { hashPin, randomSalt } from '../shared/pinhash'
import { nowIso, type Db } from './db'
import { getSettings } from './settings'

/**
 * Cloud sync: the PC is the only writer. Every change is recorded in the `outbox` table; this module
 * uploads pending changes to Supabase (PostgREST + Storage) whenever it can and retries with back-off.
 * Nothing in the app waits for it.
 */

export type Fetch = typeof fetch

export interface SyncStatus {
  enabled: boolean
  configured: boolean
  pending: number
  failed: number
  lastOk: string
  lastError: string
}

export interface SyncResult {
  enabled: boolean
  sent: number
  failed: number
  error?: string
}

let pdfProvider: ((reportId: number) => Promise<string>) | null = null
/** The app gives sync a way to make a report's PDF when the file is not there yet. */
export function setPdfProvider(fn: (reportId: number) => Promise<string>) {
  pdfProvider = fn
}
let fetchImpl: Fetch = (...a) => fetch(...a)
/** Tests point sync at a mock server through this. */
export function setFetch(f: Fetch) {
  fetchImpl = f
}

const RAW_OK = '_sync_last_ok'
const RAW_ERR = '_sync_last_error'
const getRaw = (db: Db, k: string) => db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', k)?.value ?? ''
const setRaw = (db: Db, k: string, v: string) => db.run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v)

export function syncStatus(db: Db): SyncStatus {
  const s = getSettings(db).cloud
  const pending = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE done_at IS NULL')!.n
  const failed = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE done_at IS NULL AND attempts > 0')!.n
  return {
    enabled: s.enabled && !!s.url && !!s.key, configured: !!s.url && !!s.key, pending: s.enabled ? pending : 0, failed,
    lastOk: getRaw(db, RAW_OK), lastError: getRaw(db, RAW_ERR)
  }
}

const base = (url: string) => url.replace(/\/+$/, '')
const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra })

async function rest(url: string, key: string, table: string, rows: unknown[]) {
  const r = await fetchImpl(`${base(url)}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: headers(key, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows)
  })
  if (!r.ok) throw new HttpError(r.status, `${table}: ${r.status} ${(await r.text()).slice(0, 200)}`)
}

async function upload(url: string, key: string, path: string, bytes: Buffer) {
  const r = await fetchImpl(`${base(url)}/storage/v1/object/reports/${path}`, {
    method: 'POST',
    headers: headers(key, { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }),
    body: new Uint8Array(bytes)
  })
  if (!r.ok) throw new HttpError(r.status, `storage ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`)
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function testConnection(url: string, key: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetchImpl(`${base(url)}/rest/v1/patients?select=id&limit=1`, { headers: headers(key) })
    if (r.ok) return { ok: true }
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'The key was refused. Use the service_role key from Supabase → Settings → API.' }
    if (r.status === 404) return { ok: false, message: 'Connected, but the tables are missing. Run the SQL migration (see docs/CLOUD-SETUP.md).' }
    return { ok: false, message: `Server answered ${r.status}` }
  } catch (e) {
    return { ok: false, message: `Cannot reach the server (${(e as Error).message}). Check the internet and the address.` }
  }
}

/* ------------------------------------------------------------- payloads */

function patientRow(db: Db, id: number) {
  const p = db.get<any>('SELECT * FROM patients WHERE id = ?', id)
  if (!p) return null
  return { id: p.id, name: p.name, title: p.title, sex: p.sex, phone: p.phone, village: p.village, source: p.source, updated_at: p.updated_at }
}

function visitRow(db: Db, id: number) {
  const v = db.get<any>('SELECT * FROM visits WHERE id = ?', id)
  if (!v) return null
  const tests = db.all<any>('SELECT panel_code, name, price, sent_out, sent_to, sent_at, received_at FROM visit_tests WHERE visit_id = ?', id)
  const payments = db.all<any>('SELECT amount, paid_at, note FROM payments WHERE visit_id = ?', id)
  return {
    id: v.id, patient_id: v.patient_id, sample_id: v.sample_id, visit_date: v.visit_date, age_y: v.age_y, age_m: v.age_m, age_d: v.age_d,
    doctor: v.doctor, specimen: v.specimen, total: v.total, discount: v.discount, paid: payments.reduce((a, p) => a + p.amount, 0),
    notes: v.notes, source: v.source, cancelled: !!v.cancelled, tests, payments, updated_at: nowIso()
  }
}

async function reportRows(db: Db, visitId: number) {
  const reps = db.all<any>("SELECT * FROM reports WHERE visit_id = ? AND status = 'approved'", visitId)
  const out = []
  for (const r of reps) {
    const results = db.all<any>('SELECT panel_code, panel_name, section, param_code, name, grp, type, value, unit, range_text, flag, critical, auto FROM report_results WHERE report_id = ? ORDER BY sort', r.id)
    let salt = db.get<{ v: string }>("SELECT value AS v FROM settings WHERE key = ?", `_salt_${r.id}`)?.v
    if (!salt) {
      salt = randomSalt()
      setRaw(db, `_salt_${r.id}`, salt)
    }
    out.push({
      row: {
        id: r.id, visit_id: r.visit_id, version: r.version, status: r.status, is_current: !!r.is_current, approved_at: r.approved_at,
        reason: r.reason, share_code: r.share_code, pin_salt: salt,
        pin_hash: r.share_code && r.share_pin ? await hashPin(r.share_code, r.share_pin, salt) : null,
        pdf_path: r.status === 'approved' && r.share_code ? `${r.share_code}/v${r.version}.pdf` : null,
        results, updated_at: nowIso()
      },
      local: r as { id: number; status: string; pdf_path: string | null }
    })
  }
  return out
}

/* ----------------------------------------------------------------- run */

const backoff = (attempts: number) => Math.min(3600, 30 * 2 ** Math.min(attempts, 7))

let running = false

export async function syncNow(db: Db, _dataDir = ''): Promise<SyncResult> {
  const cfg = getSettings(db).cloud
  if (!cfg.enabled || !cfg.url || !cfg.key) return { enabled: false, sent: 0, failed: 0 }
  if (running) return { enabled: true, sent: 0, failed: 0, error: 'busy' }
  running = true
  const now = nowIso()
  let sent = 0
  let failed = 0
  try {
    const rows = db.all<{ id: number; entity: string; entity_id: number; attempts: number }>(
      'SELECT id, entity, entity_id, attempts FROM outbox WHERE done_at IS NULL AND (next_try IS NULL OR next_try <= ?) ORDER BY id LIMIT 500', now
    )
    // many edits to the same record are sent once; patients first, then visits, then reports
    const groups = new Map<string, { entity: string; entityId: number; ids: number[]; attempts: number }>()
    for (const r of rows) {
      const k = `${r.entity}:${r.entity_id}`
      const g = groups.get(k) ?? { entity: r.entity, entityId: r.entity_id, ids: [], attempts: 0 }
      g.ids.push(r.id)
      g.attempts = Math.max(g.attempts, r.attempts)
      groups.set(k, g)
    }
    const order: Record<string, number> = { patient: 0, visit: 1, report: 2 }
    const list = [...groups.values()].sort((a, b) => (order[a.entity] ?? 9) - (order[b.entity] ?? 9))

    let stop = false
    for (const g of list) {
      if (stop) break
      try {
        await sendOne(db, cfg.url, cfg.key, g.entity, g.entityId)
        db.run(`UPDATE outbox SET done_at = ?, last_error = NULL WHERE id IN (${g.ids.map(() => '?').join(',')})`, nowIso(), ...g.ids)
        sent++
      } catch (e) {
        failed++
        const msg = (e as Error).message
        const next = new Date(Date.now() + backoff(g.attempts + 1) * 1000).toISOString()
        db.run(`UPDATE outbox SET attempts = attempts + 1, next_try = ?, last_error = ? WHERE id IN (${g.ids.map(() => '?').join(',')})`, next, msg, ...g.ids)
        // the server being unreachable or refusing the key will fail the rest too: stop and retry later
        if (!(e instanceof HttpError) || e.status === 401 || e.status === 403 || e.status >= 500) {
          stop = true
          // the others would only fail the same way: hold them back for the same time instead of hammering the server
          db.run('UPDATE outbox SET next_try = ? WHERE done_at IS NULL AND next_try IS NULL', next)
        }
        setRaw(db, RAW_ERR, msg)
      }
    }
    if (sent > 0 && failed === 0) {
      setRaw(db, RAW_OK, nowIso())
      setRaw(db, RAW_ERR, '')
    }
    return { enabled: true, sent, failed, error: failed ? getRaw(db, RAW_ERR) : undefined }
  } finally {
    running = false
  }
}

async function sendOne(db: Db, url: string, key: string, entity: string, id: number) {
  if (entity === 'patient') {
    const p = patientRow(db, id)
    if (p) await rest(url, key, 'patients', [p])
  } else if (entity === 'visit') {
    const v = visitRow(db, id)
    if (v) {
      const p = patientRow(db, v.patient_id)
      if (p) await rest(url, key, 'patients', [p])
      await rest(url, key, 'visits', [v])
    }
  } else if (entity === 'report') {
    const rep = db.get<{ visit_id: number }>('SELECT visit_id FROM reports WHERE id = ?', id)
    if (!rep) return
    const v = visitRow(db, rep.visit_id)
    if (v) {
      const p = patientRow(db, v.patient_id)
      if (p) await rest(url, key, 'patients', [p])
      await rest(url, key, 'visits', [v])
    }
    const reports = await reportRows(db, rep.visit_id)
    for (const { row, local } of reports) {
      if (row.pdf_path) {
        let path = local.pdf_path
        if ((!path || !existsSync(path)) && pdfProvider) path = await pdfProvider(local.id)
        if (!path || !existsSync(path)) throw new Error('PDF not available yet')
        await upload(url, key, row.pdf_path, readFileSync(path))
      }
    }
    await rest(url, key, 'reports', reports.map((r) => r.row))
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Try every minute; each failed record waits its own back-off, so this is cheap when offline. */
export function startSyncLoop(db: Db, dataDir: string): void {
  if (timer) clearInterval(timer)
  const tick = () => {
    syncNow(db, dataDir).catch((e) => setRaw(db, RAW_ERR, (e as Error).message))
  }
  setTimeout(tick, 15_000)
  timer = setInterval(tick, 60_000)
}

/** For a queue that was filled while sync was off: queue everything once so the cloud gets the full history. */
export function enqueueEverything(db: Db): number {
  let n = 0
  db.tx(() => {
    for (const v of db.all<{ id: number }>("SELECT id FROM visits WHERE source != 'imported'")) {
      db.run("INSERT INTO outbox(at, entity, entity_id, op, payload) VALUES(?,?,?,?,?)", nowIso(), 'visit', v.id, 'upsert', '{}')
      n++
    }
    for (const r of db.all<{ id: number }>("SELECT id FROM reports WHERE status = 'approved' AND is_current = 1")) {
      db.run("INSERT INTO outbox(at, entity, entity_id, op, payload) VALUES(?,?,?,?,?)", nowIso(), 'report', r.id, 'upsert', '{}')
      n++
    }
  })
  return n
}
