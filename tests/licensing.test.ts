import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { createVisit } from '../src/main/visits'
import { AppError, approveReport, getEntry, saveDraft, startCorrection } from '../src/main/results'
import { activateLicense, canApprove, FREE_MONTHLY_LIMIT, initLicensing, licenseStatus, parseLicense, recordApproval, removeLicense, setPublicKeyForTests } from '../src/main/licensing'

// a throw-away key pair stands in for the owner's real one
const pair = generateKeyPairSync('ed25519')
const PUB = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const PRIV = createPrivateKey(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }))
const issue = (p: Record<string, unknown>, key = PRIV) => {
  const json = JSON.stringify({ id: 'T-1', issued: '2026-10-01', ...p })
  return 'KDS1.' + Buffer.from(json).toString('base64url') + '.' + sign(null, Buffer.from(json), key).toString('base64url')
}
const NOW = new Date(2026, 9, 25, 10, 0, 0)

let db: Db
let n = 0
beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => NOW
  setPublicKeyForTests(PUB)
  initLicensing('')
  n = 0
})
afterEach(() => initLicensing(''))

function approveOne(source: 'app' | 'demo' = 'app') {
  n++
  const v = createVisit(db, { patient: { name: `Lic Person ${n}`, title: 'Mr', sex: 'M', phone: '', village: 'T' }, age: { years: 30, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['RBS'], paid: 0 })
  if (source === 'demo') db.run("UPDATE visits SET source = 'demo' WHERE id = ?", v.visitId)
  const rid = getEntry(db, v.visitId).reportId!
  saveDraft(db, rid, { rbs: String(90 + (n % 40)) })
  approveReport(db, rid, {})
  return { visitId: v.visitId, reportId: rid }
}

describe('licence codes', () => {
  it('accepts a genuine code and rejects tampered, foreign-key and garbage codes', () => {
    const good = issue({ licensee: 'Test Lab', plan: 'monthly', limit: 300 })
    expect(parseLicense(good)).toMatchObject({ ok: true, payload: { licensee: 'Test Lab', limit: 300 } })
    const [a, b, c] = good.split('.')
    const forged = JSON.stringify({ id: 'T-1', licensee: 'Test Lab', plan: 'unlimited', issued: '2026-10-01' })
    expect(parseLicense([a, Buffer.from(forged).toString('base64url'), c].join('.')).ok).toBe(false) // details changed, signature no longer fits
    const other = generateKeyPairSync('ed25519').privateKey
    expect(parseLicense(issue({ licensee: 'X', plan: 'unlimited' }, other)).ok).toBe(false)
    expect(parseLicense('hello').ok).toBe(false)
    expect(parseLicense(`${a}.${b}`).ok).toBe(false)
    expect(parseLicense(issue({ licensee: 'X', plan: 'monthly' })).ok).toBe(false) // monthly needs a limit
    expect(parseLicense(good + 'x').ok).toBe(false)
  })
})

describe('free plan', () => {
  it('counts approved reports, warns near the limit, blocks the next one, and only for new reports', () => {
    for (let i = 0; i < 79; i++) approveOne()
    let s = licenseStatus(db, NOW)
    expect(s).toMatchObject({ plan: 'free', used: 79, limit: FREE_MONTHLY_LIMIT, blocked: false, nearLimit: false })
    approveOne()
    s = licenseStatus(db, NOW)
    expect(s.nearLimit).toBe(true)
    expect(s.message).toContain('80 of your 100 free reports')
    for (let i = 0; i < 19; i++) approveOne()
    expect(licenseStatus(db, NOW).blocked).toBe(false) // 99 used
    const last = approveOne() // the 100th is still allowed
    s = licenseStatus(db, NOW)
    expect(s).toMatchObject({ used: 100, blocked: true, remaining: 0 })
    expect(s.message).toContain('rayskumar02@gmail.com')
    expect(s.message).toContain('01/11/2026')
    // the 101st is refused with a plain message
    const v = createVisit(db, { patient: { name: 'One Too Many', title: 'Mr', sex: 'M', phone: '', village: 'T' }, age: { years: 30, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['RBS'], paid: 0 })
    const rid = getEntry(db, v.visitId).reportId!
    saveDraft(db, rid, { rbs: '101' })
    expect(() => approveReport(db, rid, {})).toThrowError(AppError)
    try { approveReport(db, rid, {}) } catch (e) { expect((e as AppError).code).toBe('LICENSE') }
    expect(db.get<any>('SELECT status FROM reports WHERE id = ?', rid)!.status).toBe('draft')
    // an already issued report can still be corrected, and demo/imported work is never counted or blocked
    startCorrection(db, last.visitId, { reason: 'typing mistake' })
    const corr = getEntry(db, last.visitId).reportId!
    saveDraft(db, corr, { rbs: '99' })
    expect(() => approveReport(db, corr, {})).not.toThrow()
    expect(licenseStatus(db, NOW).used).toBe(100)
    expect(canApprove(db, 'demo', 1, NOW).ok).toBe(true)
    expect(canApprove(db, 'imported', 1, NOW).ok).toBe(true)
  })
  it('starts again in the next month', () => {
    for (let i = 0; i < 100; i++) approveOne()
    expect(licenseStatus(db, NOW).blocked).toBe(true)
    const nextMonth = new Date(2026, 10, 2, 9, 0, 0)
    expect(licenseStatus(db, nextMonth)).toMatchObject({ used: 0, blocked: false })
  })
  it('does not count demo visits', () => {
    for (let i = 0; i < 5; i++) approveOne('demo')
    expect(licenseStatus(db, NOW).used).toBe(0)
  })
})

describe('licences', () => {
  it('an unlimited licence removes the limit; removing it brings the free plan back', () => {
    for (let i = 0; i < 100; i++) approveOne()
    expect(licenseStatus(db, NOW).blocked).toBe(true)
    const s = activateLicense(db, issue({ licensee: 'K.D.S. Pathology', plan: 'unlimited' }), NOW)
    expect(s).toMatchObject({ plan: 'unlimited', blocked: false, limit: null, licensee: 'K.D.S. Pathology' })
    expect(() => approveOne()).not.toThrow()
    expect(removeLicense(db, NOW).plan).toBe('free')
  })
  it('a monthly licence sets its own limit; an expired one falls back to the free plan', () => {
    activateLicense(db, issue({ licensee: 'Big Lab', plan: 'monthly', limit: 3 }), NOW)
    for (let i = 0; i < 3; i++) approveOne()
    expect(licenseStatus(db, NOW)).toMatchObject({ plan: 'monthly', limit: 3, blocked: true })
    expect(licenseStatus(db, NOW).message).toContain('allows 3 reports a month')
    // same code, a year later, with an expiry: the free plan applies
    db.run("DELETE FROM settings WHERE key = '_license'")
    activateLicense(db, issue({ licensee: 'Big Lab', plan: 'unlimited', expires: '2026-12-31' }), NOW)
    expect(licenseStatus(db, NOW).plan).toBe('unlimited')
    const later = new Date(2027, 0, 5, 10, 0, 0)
    const s = licenseStatus(db, later)
    expect(s).toMatchObject({ plan: 'free', expired: true })
    expect(s.message).toContain('expired on 31/12/2026')
    expect(() => activateLicense(db, issue({ licensee: 'Old', plan: 'unlimited', expires: '2026-01-01' }), NOW)).toThrow(/expired/)
    expect(() => activateLicense(db, 'KDS1.nonsense.code', NOW)).toThrow(/not valid/)
  })
})

describe('second counter', () => {
  it('deleting the database count does not reset the month, and a tampered file is ignored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kds-lic-'))
    initLicensing(dir)
    for (let i = 0; i < 100; i++) approveOne()
    expect(licenseStatus(db, NOW).blocked).toBe(true)
    // a "fresh" database (as after deleting the data folder's database) in the same app folder
    const fresh = openDb(':memory:')
    seedMaster(fresh)
    expect(licenseStatus(fresh, NOW)).toMatchObject({ used: 100, blocked: true })
    recordApproval(fresh, NOW)
    // editing the number by hand breaks the check, so it is ignored rather than trusted
    writeFileSync(join(dir, 'usage.dat'), JSON.stringify({ month: '2026-10', count: 100, mac: 'forged' }))
    expect(licenseStatus(fresh, NOW).used).toBe(0)
  })
})
