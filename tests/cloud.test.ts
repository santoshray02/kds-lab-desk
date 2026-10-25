import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { createVisit } from '../src/main/visits'
import { approveReport, getEntry, saveDraft, startCorrection } from '../src/main/results'
import { setSettings } from '../src/main/settings'
import { setFetch, setPdfProvider, syncNow, syncStatus, testConnection } from '../src/main/sync'
import { reportLink, qrTarget } from '../src/main/reportsvc'
import { buildWaPlan } from '../src/main/whatsapp'
import { hashPin } from '../src/shared/pinhash'
import { hashPin as fnHash } from '../cloud/supabase/functions/get-report/hash'
import { decide, publicStatus, MAX_FAILS, type ReportRecord } from '../cloud/supabase/functions/get-report/logic'
import { startMockCloud, type MockCloud } from '../cloud/mock-server/server'

let db: Db
let cloud: MockCloud
let dir: string
const cbc = { hb: '12.4', tlc: '7200', neut: '60', lymph: '32', eos: '3', mono: '4', baso: '1', rbc: '4.4', pcv: '38.5', plt: '2.4' }

function approvedVisit(name: string, phone: string, values: Record<string, string> = cbc) {
  const v = createVisit(db, { patient: { name, title: 'Mrs', sex: 'F', phone, village: 'Testpur' }, age: { years: 30, months: 0, days: 0 }, doctor: 'Dr. A. Kumar', panelCodes: ['CBC'], paid: 200 })
  const rid = getEntry(db, v.visitId).reportId!
  saveDraft(db, rid, values)
  approveReport(db, rid, { dupReason: 'test' })
  return { ...v, reportId: rid }
}

beforeEach(async () => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
  cloud = await startMockCloud('service-key')
  dir = mkdtempSync(join(tmpdir(), 'kds-cloud-'))
  setFetch((...a) => fetch(...a))
  setPdfProvider(async (id) => {
    const p = join(dir, `r${id}.pdf`)
    writeFileSync(p, Buffer.from(`%PDF-1.4 fake report ${id}`))
    return p
  })
})
afterEach(async () => {
  await cloud.close()
})

const enable = (url = cloud.url, key = 'service-key') => setSettings(db, { cloud: { enabled: true, url, key, reportBase: 'https://reports.example.test' } })

describe('sync to the cloud (mock server)', () => {
  it('does nothing and sends nothing while sync is off, but keeps the queue', async () => {
    approvedVisit('Off Person', '9800000001')
    const r = await syncNow(db)
    expect(r.enabled).toBe(false)
    expect(cloud.requests).toHaveLength(0)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE done_at IS NULL')!.n).toBeGreaterThan(0)
    expect(syncStatus(db)).toMatchObject({ enabled: false, pending: 0 })
  })

  it('uploads patient, visit, report and PDF; queue empties; reports are never read back', async () => {
    const a = approvedVisit('Cloud Person', '9800000002')
    enable()
    const before = syncStatus(db)
    expect(before.enabled).toBe(true)
    expect(before.pending).toBeGreaterThan(0)
    const r = await syncNow(db)
    expect(r).toMatchObject({ enabled: true, failed: 0 })
    expect(syncStatus(db)).toMatchObject({ pending: 0, failed: 0, lastError: '' })
    expect(syncStatus(db).lastOk).toBeTruthy()

    expect(cloud.tables.patients.get(a.patientId)).toMatchObject({ name: 'Cloud Person', phone: '9800000002' })
    expect(cloud.tables.visits.get(a.visitId)).toMatchObject({ sample_id: a.sampleId, doctor: 'Dr. A. Kumar', paid: 200, cancelled: false })
    const rep = cloud.tables.reports.get(a.reportId)
    expect(rep.status).toBe('approved')
    expect(rep.share_code).toHaveLength(6)
    expect(rep.results.find((x: any) => x.param_code === 'hb')).toMatchObject({ value: '12.4', unit: 'g/dL' })
    // the PIN itself never leaves the PC, only a salted hash
    expect(JSON.stringify(rep)).not.toContain('"share_pin"')
    expect(rep.pin_hash).toBe(await hashPin(rep.share_code, '0002', rep.pin_salt))
    expect(cloud.files.get(`${rep.share_code}/v1.pdf`)!.toString()).toContain('%PDF')
    // single writer: the PC only ever POSTs (and one GET for "test connection")
    expect(cloud.requests.every((q) => q.method === 'POST')).toBe(true)
  })

  it('sends many edits of the same record once', async () => {
    const a = approvedVisit('Dedupe Person', '9800000003')
    for (let i = 0; i < 10; i++) db.run("INSERT INTO outbox(at, entity, entity_id, op, payload) VALUES('x','visit',?, 'upsert','{}')", a.visitId)
    enable()
    await syncNow(db)
    const visitPosts = cloud.requests.filter((q) => q.path === '/rest/v1/visits')
    // one for the visit entity and one inside the report entity, not a dozen
    expect(visitPosts.length).toBeLessThanOrEqual(2)
  })

  it('retries with back-off when the connection fails, and nothing is lost', async () => {
    const a = approvedVisit('Offline Person', '9800000004')
    enable()
    cloud.down = true
    const r1 = await syncNow(db)
    expect(r1.failed).toBeGreaterThan(0)
    const s1 = syncStatus(db)
    expect(s1.pending).toBeGreaterThan(0)
    expect(s1.failed).toBeGreaterThan(0)
    expect(s1.lastError).toBeTruthy()
    const row = db.get<any>('SELECT attempts, next_try FROM outbox WHERE done_at IS NULL ORDER BY id LIMIT 1')!
    expect(row.attempts).toBe(1)
    expect(new Date(row.next_try).getTime()).toBeGreaterThan(Date.now())

    // still inside the back-off window: not even tried
    cloud.down = false
    const n = cloud.requests.length
    const r2 = await syncNow(db)
    expect(r2.sent).toBe(0)
    expect(cloud.requests.length).toBe(n)

    // time passes
    db.run("UPDATE outbox SET next_try = '2000-01-01T00:00:00.000Z' WHERE done_at IS NULL")
    const r3 = await syncNow(db)
    expect(r3.failed).toBe(0)
    expect(syncStatus(db).pending).toBe(0)
    expect(cloud.tables.reports.has(a.reportId)).toBe(true)
  })

  it('server errors (503) are retried; the delay grows with each failure', async () => {
    approvedVisit('Flaky Person', '9800000005')
    enable()
    cloud.failNext = 1000
    await syncNow(db)
    const first = db.get<any>('SELECT next_try FROM outbox WHERE done_at IS NULL ORDER BY id LIMIT 1')!.next_try
    db.run("UPDATE outbox SET next_try = '2000-01-01T00:00:00.000Z' WHERE done_at IS NULL")
    await syncNow(db)
    const second = db.get<any>('SELECT attempts, next_try FROM outbox WHERE done_at IS NULL ORDER BY id LIMIT 1')!
    expect(second.attempts).toBe(2)
    expect(new Date(second.next_try).getTime() - Date.now()).toBeGreaterThan(new Date(first).getTime() - Date.now())
    cloud.failNext = 0
    db.run("UPDATE outbox SET next_try = NULL WHERE done_at IS NULL")
    await syncNow(db)
    expect(syncStatus(db).pending).toBe(0)
  })

  it('a wrong key is reported clearly and stops the run', async () => {
    approvedVisit('Wrong Key', '9800000006')
    enable(cloud.url, 'not-the-key')
    const r = await syncNow(db)
    expect(r.failed).toBeGreaterThan(0)
    expect(syncStatus(db).lastError).toMatch(/401/)
    expect(cloud.tables.patients.size).toBe(0)
  })

  it('a correction sends both versions; the old one is no longer current', async () => {
    const a = approvedVisit('Correct Cloud', '9800000007')
    enable()
    await syncNow(db)
    const v2 = startCorrection(db, a.visitId, { reason: 'typo', pin: undefined })
    saveDraft(db, v2, { ...cbc, hb: '11.9' })
    approveReport(db, v2, {})
    await syncNow(db)
    const reps = [...cloud.tables.reports.values()].sort((x, y) => x.version - y.version)
    expect(reps.map((r) => [r.version, r.is_current])).toEqual([[1, false], [2, true]])
    expect(reps[1].share_code).toBe(reps[0].share_code) // same link, newest version wins
    expect(cloud.files.has(`${reps[1].share_code}/v2.pdf`)).toBe(true)
    expect(reps[1].results.find((x: any) => x.param_code === 'hb').value).toBe('11.9')
  })

  it('test-connection explains common problems', async () => {
    expect(await testConnection(cloud.url, 'service-key')).toEqual({ ok: true })
    expect((await testConnection(cloud.url, 'bad')).message).toMatch(/refused/)
    const closed = await startMockCloud()
    const url = closed.url
    await closed.close()
    expect((await testConnection(url, 'x')).message).toMatch(/Cannot reach/)
  })
})

describe('report link, QR and WhatsApp level', () => {
  it('QR carries a readable summary with a verify code offline and the verification URL once cloud is configured', () => {
    const a = approvedVisit('Qr Person', '9800000008')
    expect(reportLink(db, a.reportId)).toBeNull()
    const off = qrTarget(db, a.reportId)
    expect(off.text).toContain(`Report ${a.sampleId}`)
    expect(off.text).toContain('Patient: ')
    expect(off.text).toContain(`Verify code: ${off.code}`)
    expect(off.code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
    enable()
    const code = db.get<{ share_code: string }>('SELECT share_code FROM reports WHERE id = ?', a.reportId)!.share_code
    expect(reportLink(db, a.reportId)).toBe(`https://reports.example.test/r/${code}`)
    expect(qrTarget(db, a.reportId).text).toBe(`https://reports.example.test/r/${code}`)
  })
  it('WhatsApp level A attaches the PDF; level B sends link + PIN and names the patient', () => {
    const a = approvedVisit('Whats Person', '9800000009')
    const A = buildWaPlan(db, a.reportId)
    expect(A.level).toBe('A')
    expect(A.phone).toBe('919800000009')
    expect(A.text).toContain('Mrs. Whats Person')
    expect(A.appUrl).toMatch(/^whatsapp:\/\/send\?phone=919800000009&text=/)
    expect(A.webUrl).toMatch(/^https:\/\/wa\.me\/919800000009\?text=/)
    enable()
    const B = buildWaPlan(db, a.reportId)
    expect(B.level).toBe('B')
    expect(B.text).toContain('https://reports.example.test/r/')
    expect(B.text).toContain('PIN: 0009')
  })
  it('no phone → no WhatsApp', () => {
    const v = createVisit(db, { patient: { name: 'No Phone', title: 'Mr', sex: 'M', phone: '', village: '' }, age: { years: 30, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['RBS'] })
    const rid = getEntry(db, v.visitId).reportId!
    saveDraft(db, rid, { rbs: '100' })
    approveReport(db, rid, {})
    expect(() => buildWaPlan(db, rid)).toThrow(/no phone/i)
  })
})

describe('report page logic (Edge Function)', () => {
  const rec = async (pin = '1234'): Promise<ReportRecord> => ({
    share_code: 'ABC234', version: 1, status: 'approved', is_current: true, approved_at: '2026-10-25T10:00:00Z',
    pin_salt: 'salty', pin_hash: await hashPin('ABC234', pin, 'salty'), pdf_path: 'ABC234/v1.pdf', visit_id: 1
  })
  it('the PC and the cloud compute the same hash', async () => {
    expect(await fnHash('ABC234', '1234', 'salty')).toBe(await hashPin('ABC234', '1234', 'salty'))
  })
  it('right PIN gives the file; wrong PIN does not', async () => {
    expect(await decide(await rec(), '1234', 0)).toEqual({ kind: 'ok', path: 'ABC234/v1.pdf' })
    expect(await decide(await rec(), '9999', 0)).toMatchObject({ kind: 'bad_pin', attemptsLeft: MAX_FAILS - 1 })
    expect(await decide(await rec(), 'abcd', 0)).toMatchObject({ kind: 'bad_pin' })
  })
  it('locks after repeated wrong tries, even for the right PIN', async () => {
    expect(await decide(await rec(), '1234', MAX_FAILS)).toMatchObject({ kind: 'locked' })
  })
  it('unknown code or no file → not found', async () => {
    expect(await decide(null, '1234', 0)).toEqual({ kind: 'not_found' })
    expect(await decide({ ...(await rec()), pdf_path: null }, '1234', 0)).toEqual({ kind: 'not_found' })
  })
  it('public status tells a QR scanner only whether the report is genuine', async () => {
    expect(publicStatus(await rec(), false)).toEqual({ found: true, state: 'valid', version: 1, issuedOn: '2026-10-25' })
    expect(publicStatus(await rec(), true)).toMatchObject({ state: 'replaced by a corrected version' })
    expect(publicStatus(null, false)).toEqual({ found: false })
  })
})
