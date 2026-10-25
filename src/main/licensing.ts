import { createHmac, createPublicKey, verify } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { audit, type Db } from './db'
import { clock, localDate } from './patients'

/**
 * Free up to FREE_MONTHLY_LIMIT approved reports a month; more needs a licence code from K.D.S. Pathology.
 * K.D.S. Pathology itself holds an "unlimited" licence. A licence is "KDS1.<details>.<signature>", checked offline
 * with the public key below (the private key stays with the owner: tools/license-tool.mjs).
 *
 * The counter is a deterrent, not a vault: it lives on the user's PC. It is kept twice (database and a small file)
 * so that deleting only one does not reset it. Patient data is never locked: only approving NEW reports pauses.
 */
export const FREE_MONTHLY_LIMIT = 100
export const LICENCE_CONTACT = 'rayskumar02@gmail.com · santoshray.in'
let PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAOLNCWBf2p22XQ7h5gu1IdSQAdItzrYtUpmXenrhXSNE='
/** Tests use their own key pair, so they never need the owner's private key. */
export function setPublicKeyForTests(b64: string): void {
  PUBLIC_KEY_B64 = b64
}
const MIRROR_SECRET = 'kds-usage-mirror-v1'

export interface LicensePayload {
  id: string
  licensee: string
  plan: 'unlimited' | 'monthly'
  limit?: number
  expires?: string
  issued: string
}

export type ParsedLicense = { ok: true; payload: LicensePayload } | { ok: false; error: string }

const BAD = 'This licence code is not valid. Check that you copied the whole code, with nothing added or missing.'

export function parseLicense(code: string, publicKeyB64?: string): ParsedLicense {
  const parts = (code ?? '').trim().split('.')
  if (parts.length !== 3 || parts[0] !== 'KDS1') return { ok: false, error: BAD }
  try {
    const json = Buffer.from(parts[1], 'base64url')
    const key = createPublicKey({ key: Buffer.from(publicKeyB64 ?? PUBLIC_KEY_B64, 'base64'), format: 'der', type: 'spki' })
    if (!verify(null, json, key, Buffer.from(parts[2], 'base64url'))) return { ok: false, error: BAD }
    const p = JSON.parse(json.toString('utf8')) as LicensePayload
    if (!p.licensee || (p.plan !== 'unlimited' && p.plan !== 'monthly') || (p.plan === 'monthly' && !(Number(p.limit) > 0))) return { ok: false, error: BAD }
    return { ok: true, payload: p }
  } catch {
    return { ok: false, error: BAD }
  }
}

export interface LicenseStatus {
  plan: 'free' | 'monthly' | 'unlimited'
  licensee: string
  licenseId: string
  /** null = no monthly limit */
  limit: number | null
  used: number
  remaining: number | null
  month: string
  resetsOn: string
  expiresOn: string | null
  expired: boolean
  blocked: boolean
  nearLimit: boolean
  contact: string
  /** plain-language sentence for a banner; '' when everything is fine */
  message: string
}

let dataDirPath = ''
export function initLicensing(dataDir: string): void {
  dataDirPath = dataDir
}

const monthOf = (d: Date) => localDate(d).slice(0, 7)

function dbCount(db: Db, month: string): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM reports r JOIN visits v ON v.id = r.visit_id
       WHERE r.status = 'approved' AND r.version = 1 AND v.source = 'app' AND strftime('%Y-%m', r.approved_at, 'localtime') = ?`,
      month
    )?.n ?? 0
  )
}

const mac = (month: string, count: number) => createHmac('sha256', MIRROR_SECRET).update(`${month}|${count}`).digest('hex')
const mirrorPath = () => join(dataDirPath, 'usage.dat')

function mirrorCount(month: string): number {
  if (!dataDirPath || !existsSync(mirrorPath())) return 0
  try {
    const m = JSON.parse(readFileSync(mirrorPath(), 'utf8')) as { month: string; count: number; mac: string }
    return m.month === month && m.mac === mac(m.month, m.count) ? m.count : 0
  } catch {
    return 0
  }
}

function writeMirror(month: string, count: number): void {
  if (!dataDirPath) return
  try {
    writeFileSync(mirrorPath(), JSON.stringify({ month, count, mac: mac(month, count) }))
  } catch {
    /* the database count still applies */
  }
}

function storedLicense(db: Db): LicensePayload | null {
  const code = db.get<{ value: string }>("SELECT value FROM settings WHERE key = '_license'")?.value
  if (!code) return null
  const r = parseLicense(code)
  return r.ok ? r.payload : null
}

const nextMonthStart = (now: Date) => localDate(new Date(now.getFullYear(), now.getMonth() + 1, 1))
const niceDate = (iso: string) => iso.split('-').reverse().join('/')

export function licenseStatus(db: Db, now: Date = clock.now()): LicenseStatus {
  const month = monthOf(now)
  const used = Math.max(dbCount(db, month), mirrorCount(month))
  const lic = storedLicense(db)
  const today = localDate(now)
  const expired = !!lic?.expires && today > lic.expires
  const effective: 'free' | 'monthly' | 'unlimited' = !lic || expired ? 'free' : lic.plan
  const limit = effective === 'unlimited' ? null : effective === 'monthly' ? Number(lic!.limit) : FREE_MONTHLY_LIMIT
  const blocked = limit != null && used >= limit
  const nearLimit = limit != null && !blocked && used >= Math.ceil(limit * 0.8)
  const resetsOn = nextMonthStart(now)
  let message = ''
  if (expired) message = `Your licence expired on ${niceDate(lic!.expires!)}, so the free limit of ${FREE_MONTHLY_LIMIT} reports a month applies. `
  if (blocked) {
    message += `${effective === 'free' ? `You have used all ${limit} free reports for this month` : `Your licence allows ${limit} reports a month and all are used`}. Reports already made can still be opened, printed and sent. To approve more, ask K.D.S. Pathology for a licence (${LICENCE_CONTACT}) or wait until ${niceDate(resetsOn)}.`
  } else if (nearLimit) {
    message += `You have used ${used} of your ${limit} ${effective === 'free' ? 'free ' : ''}reports this month. The count starts again on ${niceDate(resetsOn)}.`
  }
  return {
    plan: effective, licensee: lic && !expired ? lic.licensee : '', licenseId: lic && !expired ? lic.id : '', limit, used,
    remaining: limit == null ? null : Math.max(0, limit - used), month, resetsOn, expiresOn: lic?.expires ?? null, expired, blocked, nearLimit,
    contact: LICENCE_CONTACT, message: message.trim()
  }
}

/** Is a new approval allowed? Corrections (version 2+), demo data and imported reports are never counted or blocked. */
export function canApprove(db: Db, visitSource: string, version: number, now: Date = clock.now()): { ok: boolean; message: string } {
  if (version > 1 || visitSource !== 'app') return { ok: true, message: '' }
  const s = licenseStatus(db, now)
  return s.blocked ? { ok: false, message: s.message } : { ok: true, message: '' }
}

/** Remember the new count in the second place too. */
export function recordApproval(db: Db, now: Date = clock.now()): void {
  const month = monthOf(now)
  writeMirror(month, Math.max(dbCount(db, month), mirrorCount(month)))
}

export function activateLicense(db: Db, code: string, now: Date = clock.now()): LicenseStatus {
  const r = parseLicense(code)
  if (!r.ok) throw new Error(r.error)
  if (r.payload.expires && localDate(now) > r.payload.expires) throw new Error(`This licence expired on ${niceDate(r.payload.expires)}. Ask K.D.S. Pathology for a new one.`)
  db.run("INSERT INTO settings(key, value) VALUES('_license', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", code.trim())
  audit(db, 'license.activate', 'license', null, `${r.payload.id} ${r.payload.licensee} ${r.payload.plan}`)
  return licenseStatus(db, now)
}

export function removeLicense(db: Db, now: Date = clock.now()): LicenseStatus {
  db.run("DELETE FROM settings WHERE key = '_license'")
  audit(db, 'license.remove', 'license', null, '')
  return licenseStatus(db, now)
}
