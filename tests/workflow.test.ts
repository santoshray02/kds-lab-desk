import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { loadMaster, seedMaster, editParam } from '../src/main/master'
import { clock, peopleByPhone, searchPeople, suggestDoctors } from '../src/main/patients'
import { addPayment, cancelVisit, createVisit, listVisits } from '../src/main/visits'
import { AppError, approveReport, buildReportData, getEntry, listVersions, previousValues, saveDraft, startCorrection } from '../src/main/results'
import { checkPin, setPin, setSettings, getSettings } from '../src/main/settings'
import { dayReport, doctorMonthly, duesReport, pendingReport } from '../src/main/owner'
import { createBackup, listBackups, pruneBackups, restoreBackup, validateBackup } from '../src/main/backup'
import { renderReportHtml } from '../src/shared/reportHtml'

let db: Db
const age = (years: number) => ({ years, months: 0, days: 0 })
const cbc = { hb: '9.4', tlc: '13200', neut: '78', lymph: '16', eos: '4', mono: '2', baso: '0', rbc: '3.90', pcv: '29.6', plt: '2.45' }

function register(name: string, phone: string, codes: string[], opts: Partial<Parameters<typeof createVisit>[1]> = {}) {
  return createVisit(db, {
    patient: { name, title: 'Mrs', sex: 'F', phone, village: 'Testpur' },
    age: age(34), doctor: 'Dr. A. Kumar', panelCodes: codes, paid: 0, ...opts
  })
}

beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
})

describe('database and master', () => {
  it('migrates once and seeds the master with ranges', () => {
    const m = loadMaster(db)
    expect(m.find((p) => p.code === 'CBC')!.params).toHaveLength(14)
    expect(m.find((p) => p.code === 'OTHER_SO')!.sentOut).toBe(true)
    expect(m.find((p) => p.code === 'THYROID')!.sentOut).toBe(false)
    expect(m.find((p) => p.code === 'THYROID')!.params.map((q) => q.code)).toEqual(['t3', 't4', 'tsh'])
    const hb = m.flatMap((p) => p.params).find((q) => q.code === 'hb')!
    expect(hb.ranges.length).toBeGreaterThanOrEqual(3)
    seedMaster(db) // second call must not duplicate
    expect(loadMaster(db).length).toBe(m.length)
  })
  it('range edits create a new version and keep the old rows', () => {
    const hb = loadMaster(db).flatMap((p) => p.params).find((q) => q.code === 'hb')!
    editParam(db, { paramId: hb.id, ranges: [{ sex: 'A', ageMinDays: 0, ageMaxDays: 50000, low: 12, high: 16 }], reason: 'kit insert' })
    const after = loadMaster(db).flatMap((p) => p.params).find((q) => q.code === 'hb')!
    expect(after.ranges).toHaveLength(1)
    expect(after.rangeVersion).toBe(2)
    const rows = db.all('SELECT * FROM ref_ranges WHERE param_id = ?', hb.id)
    expect(rows.length).toBeGreaterThan(1)
    expect(db.all('SELECT * FROM ref_ranges WHERE param_id = ? AND valid_to IS NULL', hb.id)).toHaveLength(1)
  })
  it('PIN is stored hashed and checked', () => {
    expect(checkPin(db, undefined)).toBe(true) // none set yet
    setPin(db, '1234')
    expect(checkPin(db, '1234')).toBe(true)
    expect(checkPin(db, '4321')).toBe(false)
    expect(() => setPin(db, '12')).toThrow()
    expect(db.get<{ value: string }>("SELECT value FROM settings WHERE key = '_pin_owner'")!.value).not.toContain('1234')
    expect(JSON.stringify(getSettings(db))).not.toContain('scrypt')
  })
})

describe('registration', () => {
  it('assigns sample IDs sequentially per month and bills the starter prices', () => {
    const a = register('Test Patient One', '9800000001', ['CBC', 'RBS'], { paid: 250 })
    const b = register('Test Patient Two', '9800000002', ['LFT'])
    expect(a.sampleId).toBe('2610-001')
    expect(b.sampleId).toBe('2610-002')
    const list = listVisits(db)
    const first = list.find((v) => v.sampleId === '2610-001')!
    expect(first.total).toBe(250)
    expect(first.paid).toBe(250)
    expect(first.due).toBe(0)
    expect(list.find((v) => v.sampleId === '2610-002')!.due).toBe(400)
    addPayment(db, b.visitId, 100)
    expect(listVisits(db, { status: 'dues' }).find((v) => v.sampleId === '2610-002')!.due).toBe(300)
  })
  it('lists everyone on a shared phone number and finds people by name or village', () => {
    register('Rekha Testkumari', '98000 41207', ['CBC'])
    createVisit(db, { patient: { name: 'Suresh Testray', title: 'Mr', sex: 'M', phone: '+91 98000 41207', village: 'Otherpur' }, age: age(40), doctor: 'Self', panelCodes: ['RBS'] })
    const people = peopleByPhone(db, '9800041207')
    expect(people.map((p) => p.name).sort()).toEqual(['Rekha Testkumari', 'Suresh Testray'])
    expect(people[0].lastVisitDate).toBe('2026-10-25')
    expect(searchPeople(db, 'suresh')).toHaveLength(1)
    expect(searchPeople(db, 'Testpur')).toHaveLength(1)
    expect(searchPeople(db, '2610-001')).toHaveLength(1)
    expect(suggestDoctors(db, 'dr. a')).toEqual(['Dr. A. Kumar'])
    expect(suggestDoctors(db, 'se')).toContain('Self')
  })
  it('works without a phone, and can require one in Settings', () => {
    expect(register('No Phone Person', '', ['CBC']).visitId).toBeGreaterThan(0)
    setSettings(db, { phoneRequired: true })
    expect(() => register('No Phone Again', '', ['CBC'])).toThrow(/Phone/)
  })
  it('refuses a missing or impossible age', () => {
    expect(() => register('No Age', '', ['CBC'], { age: { years: 0, months: 0, days: 0 } })).toThrow(/age/i)
    expect(() => register('Odd Age', '', ['CBC'], { age: { years: 200, months: 0, days: 0 } })).toThrow(/age/i)
    expect(() => register('Neg Age', '', ['CBC'], { age: { years: -1, months: 0, days: 0 } })).toThrow(/age/i)
    expect(register('Baby Age', '', ['CBC'], { age: { years: 0, months: 0, days: 12 } }).visitId).toBeGreaterThan(0)
  })
  it('rejects a bad phone and an empty test list', () => {
    expect(() => register('Bad Phone', '12345', ['CBC'])).toThrow(/10 digits/)
    expect(() => register('No Tests', '9800000003', [])).toThrow(/test/)
  })
  it('warns about title and sex mismatch', () => {
    const r = createVisit(db, { patient: { name: 'Odd Title', title: 'Mr', sex: 'F', phone: '', village: '' }, age: age(30), doctor: 'Self', panelCodes: ['CBC'] })
    expect(r.warnings.length).toBe(1)
  })
})

describe('result entry, approval and locking', () => {
  it('starts every report with empty results', () => {
    const { visitId } = register('Fresh Report', '9800000010', ['CBC'])
    const e = getEntry(db, visitId)
    expect(e.status).toBe('draft')
    expect(e.values).toEqual({})
    expect(Object.keys(e.typed)).toHaveLength(0)
  })

  it('register → enter → approve → locked', () => {
    const { visitId } = register('Rekha Testkumari', '9800000011', ['CBC'])
    const e0 = getEntry(db, visitId)
    const saved = saveDraft(db, e0.reportId!, cbc)
    expect(saved.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(saved.values.mcv.auto).toBe(true)
    const done = approveReport(db, e0.reportId!, {})
    expect(done.shareCode).toHaveLength(6)
    const e1 = getEntry(db, visitId)
    expect(e1.status).toBe('approved')
    expect(db.get<{ share_pin: string }>('SELECT share_pin FROM reports WHERE id = ?', e0.reportId!)!.share_pin).toBe('0011')
    // immutable
    expect(() => saveDraft(db, e0.reportId!, { ...cbc, hb: '12' })).toThrowError(AppError)
    expect(() => approveReport(db, e0.reportId!, {})).toThrow(/already/)
    // snapshot rows carry flag and range as printed
    const hb = db.get<any>("SELECT * FROM report_results WHERE report_id = ? AND param_code = 'hb'", e0.reportId!)
    expect(hb.flag).toBe('L')
    expect(hb.range_text).toBe('11.5 – 16.5')
  })

  it('blocks approval for implausible values, bad DLC and untouched panels', () => {
    const { visitId } = register('Blocked One', '9800000012', ['CBC', 'RBS'])
    const rid = getEntry(db, visitId).reportId!
    saveDraft(db, rid, { ...cbc, hb: '105' })
    expect(() => approveReport(db, rid, {})).toThrow(/Fix the marked/)
    saveDraft(db, rid, { ...cbc, neut: '60' })
    expect(() => approveReport(db, rid, {})).toThrow(/Fix the marked/)
    saveDraft(db, rid, cbc)
    try {
      approveReport(db, rid, {})
      throw new Error('should have blocked')
    } catch (e) {
      expect((e as AppError).code).toBe('EMPTY')
    }
    saveDraft(db, rid, { ...cbc, rbs: '102' })
    expect(approveReport(db, rid, {}).reportId).toBe(rid)
  })

  it('blocks identical result sets from another patient until a reason is given', () => {
    const a = register('First Person', '9800000013', ['CBC'])
    const ra = getEntry(db, a.visitId).reportId!
    saveDraft(db, ra, cbc)
    approveReport(db, ra, {})

    const b = register('Second Person', '9800000014', ['CBC'])
    const rb = getEntry(db, b.visitId).reportId!
    const s = saveDraft(db, rb, cbc)
    expect(s.duplicates).toHaveLength(1)
    expect(s.duplicates[0].sampleId).toBe(a.sampleId)
    try {
      approveReport(db, rb, {})
      throw new Error('should have blocked')
    } catch (e) {
      expect((e as AppError).code).toBe('DUPLICATE')
    }
    expect(() => approveReport(db, rb, { dupReason: 'x' })).toThrow()
    approveReport(db, rb, { dupReason: 'Twins tested together, re-read analyzer' })
    expect(db.get<{ dup_reason: string }>('SELECT dup_reason FROM reports WHERE id = ?', rb)!.dup_reason).toContain('Twins')
  })

  it('the same patient repeating a test is not a duplicate', () => {
    const a = register('Repeat Person', '9800000015', ['CBC'])
    saveDraft(db, getEntry(db, a.visitId).reportId!, cbc)
    approveReport(db, getEntry(db, a.visitId).reportId!, {})
    const b = createVisit(db, { patient: { id: a.patientId, name: 'Repeat Person', title: 'Mrs', sex: 'F', phone: '9800000015' }, age: age(34), doctor: 'Self', panelCodes: ['CBC'] })
    const s = saveDraft(db, getEntry(db, b.visitId).reportId!, cbc)
    expect(s.duplicates).toEqual([])
  })

  it('corrections make a new version, keep the old one, and need a reason', () => {
    const { visitId } = register('Correct Me', '9800000016', ['CBC'])
    const rid = getEntry(db, visitId).reportId!
    saveDraft(db, rid, cbc)
    approveReport(db, rid, {})
    setPin(db, '2468')
    expect(() => startCorrection(db, visitId, { pin: '0000', reason: 'typo in Hb' })).toThrow(/PIN/)
    expect(() => startCorrection(db, visitId, { pin: '2468', reason: '' })).toThrow(/reason/)
    const v2 = startCorrection(db, visitId, { pin: '2468', reason: 'typo in Hb' })
    // v1 is still the current approved report until v2 is approved
    expect(listVersions(db, visitId).find((v) => v.version === 1)!.is_current).toBe(1)
    const entry = getEntry(db, visitId)
    expect(entry.reportId).toBe(v2)
    expect(entry.typed.hb).toBe('9.4')
    saveDraft(db, v2, { ...cbc, hb: '10.4' })
    approveReport(db, v2, {})
    const versions = listVersions(db, visitId)
    expect(versions.map((v) => [v.version, v.status, v.is_current])).toEqual([[2, 'approved', 1], [1, 'approved', 0]])
    expect(versions[1].superseded_at).toBeTruthy()
    // old values still viewable
    expect(db.get<any>("SELECT value FROM report_results WHERE report_id = ? AND param_code = 'hb'", rid)!.value).toBe('9.4')
    const data = buildReportData(db, v2)
    expect(data.correctionNote).toMatch(/version 2/)
    expect(data.correctionNote).toMatch(/typo in Hb/)
  })

  it('shows previous values beside the current ones', () => {
    const a = register('History Person', '9800000017', ['CBC'])
    saveDraft(db, getEntry(db, a.visitId).reportId!, cbc)
    approveReport(db, getEntry(db, a.visitId).reportId!, {})
    clock.now = () => new Date(2026, 10, 20)
    const b = createVisit(db, { patient: { id: a.patientId, name: 'History Person', title: 'Mrs', sex: 'F', phone: '9800000017' }, age: age(34), doctor: 'Self', panelCodes: ['CBC'] })
    const e = getEntry(db, b.visitId)
    expect(e.previous.hb.value).toBe('9.4')
    expect(e.previous.hb.sampleId).toBe('2610-001')
    expect(previousValues(db, a.patientId, 999).hb.date).toBe('2026-10-25')
  })

  it('sent-out only visits have no report to enter', () => {
    const { visitId } = register('Sent Out', '9800000018', ['OTHER_SO'])
    expect(getEntry(db, visitId).status).toBe('none')
    expect(getEntry(db, visitId).sentOut).toHaveLength(1)
    expect(pendingReport(db).sentOut).toHaveLength(1)
  })
})

describe('report data and HTML', () => {
  it('groups by section, marks abnormal values, has footer and signatures', () => {
    const { visitId } = register('Print Person', '9800000019', ['CBC', 'WIDAL', 'OTHER_SO'])
    const rid = getEntry(db, visitId).reportId!
    saveDraft(db, rid, { ...cbc, widal: 'Positive', wo: '80', wh: '40', wah: '20', wbh: '0' })
    approveReport(db, rid, {})
    const d = buildReportData(db, rid)
    d.qrSvg = '<svg></svg>'
    expect(d.sections.map((s) => s.title)).toEqual(['HAEMATOLOGY', 'SEROLOGY'])
    const html = renderReportHtml(d)
    expect(html).toContain('K.D.S. PATHOLOGY')
    expect(html).toContain('Dr. Manoj Kumar')
    expect(html).toContain('Ram Vivek Kumar')
    expect(html).toContain('Not valid for medico legal purpose. Use only for treatment.')
    expect(html).toContain('9.4 L')
    expect(html).toContain('13200 H')
    expect(html).toContain('WIDAL TEST (SLIDE METHOD)')
    expect(html).toContain('1:320')
    expect(html).toContain('Sent-out tests')
    expect(html).toContain('Mrs. Print Person')
    expect(html).toContain('thead')
  })
  it('letterhead mode drops the printed header and sets page margins', () => {
    const { visitId } = register('Letterhead Person', '9800000020', ['RBS'])
    const rid = getEntry(db, visitId).reportId!
    saveDraft(db, rid, { rbs: '102' })
    approveReport(db, rid, {})
    setSettings(db, { letterhead: true, letterheadTopMm: 50, letterheadBottomMm: 30, paper: 'Letter' })
    const html = renderReportHtml(buildReportData(db, rid))
    expect(html).toContain('margin: 50mm 10mm 30mm 10mm')
    expect(html).toContain('size: Letter')
    expect(html).not.toContain('class="lh"')
  })
})

describe('owner reports', () => {
  it('today register, cash, dues, doctor counts and pending', () => {
    const a = register('Cash One', '9800000021', ['CBC'], { paid: 200 })
    register('Due Two', '9800000022', ['LFT'], { paid: 100, doctor: 'Dr. B. Singh' })
    register('Due Three', '9800000023', ['KFT'], { doctor: 'Dr. A. Kumar' })
    const day = dayReport(db, '2026-10-25')
    expect(day.visits).toHaveLength(3)
    expect(day.billed).toBe(1000)
    expect(day.cashReceived).toBe(300)
    expect(day.dueOnDay).toBe(700)
    const dues = duesReport(db)
    expect(dues.total).toBe(700)
    expect(dues.rows).toHaveLength(2)
    const docs = doctorMonthly(db, '2026-10')
    expect(docs.find((d) => d.doctor === 'Dr. A. Kumar')!.visits).toBe(2)
    expect(docs.find((d) => d.doctor === 'Dr. B. Singh')!.visits).toBe(1)
    expect(pendingReport(db).unreported).toHaveLength(3)
    saveDraft(db, getEntry(db, a.visitId).reportId!, cbc)
    approveReport(db, getEntry(db, a.visitId).reportId!, {})
    expect(pendingReport(db).unreported).toHaveLength(2)
  })
})

describe('backups', () => {
  it('creates, validates, prunes and restores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kds-test-'))
    const dataDir = join(dir, 'data')
    mkdirSync(join(dataDir, 'attachments'), { recursive: true })
    writeFileSync(join(dataDir, 'attachments', 'a.txt'), 'x')
    register('Backup Person', '9800000030', ['CBC'])
    const dest = join(dir, 'bk')
    const b1 = createBackup(db, dataDir, dest, new Date(2026, 9, 1, 22, 0, 0))
    createBackup(db, dataDir, dest, new Date(2026, 9, 2, 22, 0, 0))
    createBackup(db, dataDir, dest, new Date(2026, 9, 3, 22, 0, 0))
    expect(listBackups(dest)).toHaveLength(3)
    expect(validateBackup(b1).ok).toBe(true)
    expect(listBackups(dest)[0].patients).toBe(1)
    expect(pruneBackups(dest, 2)).toBe(1)
    expect(listBackups(dest)).toHaveLength(2)
    expect(validateBackup(dir).ok).toBe(false)
    // restore: needs the live db closed; here we simulate with a file db
    const live = join(dataDir, 'kds.db')
    const ldb = openDb(live)
    ldb.close()
    const kept = restoreBackup(listBackups(dest)[0].path, dataDir)
    expect(existsSync(join(kept, 'kds.db'))).toBe(true)
    const restored = openDb(live)
    expect(restored.get<{ n: number }>('SELECT COUNT(*) AS n FROM patients')!.n).toBe(1)
    restored.close()
  })
})

describe('report design extras', () => {
  it('summarises abnormal results and the verify code changes when a result changes', async () => {
    const { reportHtml, verifyCode } = await import('../src/main/reportsvc')
    const { visitId } = register('Code Person', '9800000031', ['CBC'])
    const rid = getEntry(db, visitId).reportId!
    saveDraft(db, rid, cbc)
    approveReport(db, rid, {})
    setSettings(db, { abnormalStyle: 'standard' })
    const html = await reportHtml(db, rid)
    expect(html).toContain('outside the reference range')
    const d = buildReportData(db, rid)
    const a = verifyCode(d)
    d.sections[0].panels[0].rows[0].value = '12.0'
    expect(verifyCode(d)).not.toBe(a)
    expect(html).toContain(a)
  })
})

describe('tests that can be done in the lab or sent out', () => {
  it('an older database gets result fields for Thyroid, keeping its price; the toggle switches new visits', async () => {
    const { setPanelSentOut } = await import('../src/main/master')
    // simulate the old master: thyroid sent out, no fields
    db.run("DELETE FROM ref_ranges WHERE param_id IN (SELECT id FROM test_params WHERE panel_id = (SELECT id FROM test_panels WHERE code = 'THYROID'))")
    db.run("DELETE FROM test_params WHERE panel_id = (SELECT id FROM test_panels WHERE code = 'THYROID')")
    db.run("UPDATE test_panels SET sent_out = 1, price = 475, name = 'Thyroid Profile (T3/T4/TSH) — sent out' WHERE code = 'THYROID'")
    seedMaster(db)
    const th = loadMaster(db).find((p) => p.code === 'THYROID')!
    expect(th.sentOut).toBe(false)
    expect(th.price).toBe(475)
    expect(th.params).toHaveLength(3)
    // done here: result entry exists and a high TSH is flagged
    const v1 = register('Thy One', '9800000041', ['THYROID'])
    const rid = getEntry(db, v1.visitId).reportId!
    saveDraft(db, rid, { t3: '120', t4: '8', tsh: '9.5' })
    approveReport(db, rid, {})
    expect(buildReportData(db, rid).sections[0].panels[0].rows.find((r) => r.name.startsWith('TSH'))!.flag).toBe('H')
    // switched to sent out: only new visits change
    setPanelSentOut(db, th.id, true)
    const v2 = register('Thy Two', '9800000042', ['THYROID'])
    expect(getEntry(db, v2.visitId).status).toBe('none')
    expect(getEntry(db, v2.visitId).sentOut).toHaveLength(1)
    expect(getEntry(db, v1.visitId).status).toBe('approved')
    expect(() => setPanelSentOut(db, loadMaster(db).find((p) => p.code === 'OTHER_SO')!.id, false)).toThrow()
  })
})

describe('overview insights', () => {
  it('adds up days, tests, doctors and weekdays for the period', async () => {
    const { insights } = await import('../src/main/owner')
    register('Chart One', '9800000061', ['CBC'], { paid: 200 })
    register('Chart Two', '9800000062', ['CBC', 'ESR'], { doctor: 'Dr. B. Singh' })
    const i = insights(db, 30)
    expect(i.days).toHaveLength(30)
    expect(i.days[29].visits).toBe(2)
    expect(i.totals.visits).toBe(2)
    expect(i.totals.cash).toBe(200)
    expect(i.topTests[0]).toMatchObject({ count: 2 })
    expect(i.doctors.map((d) => d.doctor).sort()).toEqual(['Dr. A. Kumar', 'Dr. B. Singh'])
    expect(i.weekday.reduce((a, b) => a + b, 0)).toBe(2)
    expect(i.totals.due).toBeGreaterThan(0)
  })
})

describe('delta checks and trend lines', () => {
  const visitAt = (name: string, phone: string, day: number, hb: string, extra: Record<string, string> = {}) => {
    clock.now = () => new Date(2026, 9, day, 10, 0, 0)
    const v = register(name, phone, ['CBC'])
    const rid = getEntry(db, v.visitId).reportId!
    saveDraft(db, rid, { ...cbc, hb, ...extra })
    return { v, rid }
  }
  it('warns (without blocking) when a result jumps far from the last visit, and not for old or small changes', () => {
    const first = visitAt('Delta One', '9800000081', 1, '12.9')
    approveReport(db, first.rid, {})
    // same patient again 3 weeks later with a big drop
    clock.now = () => new Date(2026, 9, 22, 10, 0, 0)
    const again = createVisit(db, { patient: { id: first.v.patientId, name: 'Delta One', title: 'Mrs', sex: 'F', phone: '9800000081' }, age: age(34), doctor: 'Dr. A. Kumar', panelCodes: ['CBC'], paid: 0 })
    const rid2 = getEntry(db, again.visitId).reportId!
    const r = saveDraft(db, rid2, { ...cbc, hb: '8.0' })
    const d = r.issues.find((i) => i.code === 'delta')
    expect(d?.severity).toBe('warn')
    expect(d?.message).toContain('38% lower than 12.9')
    expect(() => approveReport(db, rid2, {})).not.toThrow() // a warning never blocks
    // a small change is fine
    const ok = createVisit(db, { patient: { id: first.v.patientId, name: 'Delta One', title: 'Mrs', sex: 'F', phone: '9800000081' }, age: age(34), doctor: 'Dr. A. Kumar', panelCodes: ['CBC'], paid: 0 })
    const rid3 = getEntry(db, ok.visitId).reportId!
    expect(saveDraft(db, rid3, { ...cbc, hb: '8.4', plt: '2.5' }).issues.some((i) => i.code === 'delta')).toBe(false)
  })
  it('prints a trend graph from earlier results, and switches off in settings', () => {
    const a = visitAt('Trend One', '9800000082', 1, '11.0')
    approveReport(db, a.rid, {})
    clock.now = () => new Date(2026, 9, 10, 10, 0, 0)
    const b = createVisit(db, { patient: { id: a.v.patientId, name: 'Trend One', title: 'Mrs', sex: 'F', phone: '9800000082' }, age: age(34), doctor: 'Dr. A. Kumar', panelCodes: ['CBC'], paid: 0 })
    const rb = getEntry(db, b.visitId).reportId!
    saveDraft(db, rb, { ...cbc, hb: '11.8', tlc: '9000', neut: '60', lymph: '34', plt: '2.4', rbc: '4.1', pcv: '36' })
    approveReport(db, rb, {})
    clock.now = () => new Date(2026, 9, 20, 10, 0, 0)
    const c = createVisit(db, { patient: { id: a.v.patientId, name: 'Trend One', title: 'Mrs', sex: 'F', phone: '9800000082' }, age: age(34), doctor: 'Dr. A. Kumar', panelCodes: ['CBC'], paid: 0 })
    const rc = getEntry(db, c.visitId).reportId!
    saveDraft(db, rc, { ...cbc, hb: '12.4', tlc: '9000', neut: '60', lymph: '34', plt: '2.4', rbc: '4.1', pcv: '37' })
    approveReport(db, rc, {})
    const data = buildReportData(db, rc)
    const hb = data.sections[0].panels[0].rows.find((r) => r.paramCode === 'hb')!
    expect(hb.trend!.map((t) => t.v)).toEqual([11, 11.8])
    const html = renderReportHtml(data)
    expect(html).toContain('class="spark"')
    expect(html).toContain('earlier results')
    // the first-ever report has nothing to compare with
    expect(buildReportData(db, a.rid).sections[0].panels[0].rows.every((r) => !r.trend)).toBe(true)
    setSettings(db, { reportTrends: false })
    expect(renderReportHtml(buildReportData(db, rc))).not.toContain('class="spark"')
  })
})

describe('cancel visit', () => {
  it('removes a draft visit from the register and cash, needs a reason, and cannot be repeated', () => {
    const v = register('Cancel Draft', '9800000101', ['RBS'], { paid: 50 })
    expect(dayReport(db, '2026-10-25').cashReceived).toBe(50)
    expect(() => cancelVisit(db, v.visitId, ' ')).toThrow(/reason/)
    cancelVisit(db, v.visitId, 'Patient left')
    const d = dayReport(db, '2026-10-25')
    expect(d.visits).toHaveLength(0)
    expect(d.cashReceived).toBe(0)
    expect(pendingReport(db).unreported.some((p) => p.visitId === v.visitId)).toBe(false)
    expect(() => cancelVisit(db, v.visitId, 'again')).toThrow(/already cancelled/)
  })
  it('withdraws an approved report: kept on file, no longer history or a duplicate source, charts and cloud told', async () => {
    const { insights } = await import('../src/main/owner')
    const v = register('Cancel Issued', '9800000102', ['CBC'], { paid: 200 })
    const rid = getEntry(db, v.visitId).reportId!
    saveDraft(db, rid, cbc)
    approveReport(db, rid, {})
    expect(insights(db, 7).totals.visits).toBe(1)
    cancelVisit(db, v.visitId, 'Test entry, not a real patient')
    const row = db.get<any>('SELECT status, is_current, reason FROM reports WHERE id = ?', rid)
    expect(row).toMatchObject({ status: 'approved', is_current: 0 })
    expect(row.reason).toBe('WITHDRAWN: Test entry, not a real patient')
    expect(insights(db, 7).totals).toMatchObject({ visits: 0, billed: 0, cash: 0 })
    // the same numbers typed for another patient are not a "duplicate" of a withdrawn report
    const other = register('Other Person', '9800000103', ['CBC'])
    const r2 = getEntry(db, other.visitId).reportId!
    expect(saveDraft(db, r2, cbc).duplicates).toHaveLength(0)
    expect(db.get<any>("SELECT detail FROM audit_log WHERE action = 'visit.cancel' ORDER BY id DESC LIMIT 1")!.detail).toContain('Test entry')
  })
})
