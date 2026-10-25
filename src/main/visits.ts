import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { nextSampleId, titleChecks } from '../shared/age'
import type { AgeInput, Sex } from '../shared/types'
import { audit, enqueue, nowIso, type Db } from './db'
import { getSettings } from './settings'
import { clock, localDate, normalizePhone, savePatient, touchDoctor, type PatientInput } from './patients'

export interface NewVisitInput {
  patient: PatientInput
  age: AgeInput
  doctor: string
  panelCodes: string[]
  /** price per panel code if the user changed it on the form */
  priceOverrides?: Record<string, number>
  discount?: number
  paid?: number
  notes?: string
  date?: string
}

export function generateSampleId(db: Db, date: Date = clock.now()): string {
  const ids = db.all<{ sample_id: string }>('SELECT sample_id FROM visits WHERE sample_id LIKE ?', `${String(date.getFullYear() % 100).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}-%`)
  return nextSampleId(date, ids.map((r) => r.sample_id))
}

export function createVisit(db: Db, input: NewVisitInput, actor = ''): { visitId: number; sampleId: string; patientId: number; warnings: string[] } {
  const settings = getSettings(db)
  if (settings.phoneRequired && normalizePhone(input.patient.phone).length !== 10) throw new Error('Phone number is required (Settings)')
  if (!input.panelCodes.length) throw new Error('Tick at least one test')
  const warnings = titleChecks(input.patient.title, input.patient.sex, input.age)
  const doctor = input.doctor.trim() || 'Self'

  return db.tx(() => {
    const panels = input.panelCodes.map((c) => {
      const p = db.get<any>('SELECT * FROM test_panels WHERE code = ?', c)
      if (!p) throw new Error(`Unknown test ${c}`)
      return p
    })
    const patientId = savePatient(db, input.patient)
    const now = clock.now()
    const sampleId = generateSampleId(db, now)
    const specimens = [...new Set(panels.filter((p) => !p.sent_out).map((p) => p.specimen))]
    const prices = panels.map((p) => input.priceOverrides?.[p.code] ?? p.price)
    const gross = prices.reduce((a: number, b: number) => a + b, 0)
    const discount = Math.max(0, input.discount ?? 0)
    const total = Math.max(0, gross - discount)
    const visitId = db.run(
      `INSERT INTO visits(patient_id, sample_id, visit_date, age_y, age_m, age_d, doctor, specimen, total, discount, notes, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      patientId, sampleId, input.date ?? localDate(now), input.age.years, input.age.months, input.age.days, doctor,
      specimens.join(', ') || 'Blood', total, discount, input.notes ?? '', nowIso()
    ).lastId
    panels.forEach((p, i) => {
      db.run('INSERT INTO visit_tests(visit_id, panel_id, panel_code, name, price, sent_out) VALUES(?,?,?,?,?,?)', visitId, p.id, p.code, p.name, prices[i], p.sent_out)
    })
    touchDoctor(db, doctor)
    if (input.paid && input.paid > 0) {
      db.run('INSERT INTO payments(visit_id, amount, paid_at, note) VALUES(?,?,?,?)', visitId, Math.min(input.paid, total), nowIso(), 'At registration')
    }
    // an in-house report is needed unless every test is sent out
    if (panels.some((p) => !p.sent_out)) {
      db.run("INSERT INTO reports(visit_id, version, status, is_current, created_at) VALUES(?,?,?,?,?)", visitId, 1, 'draft', 1, nowIso())
    }
    audit(db, 'visit.create', 'visits', visitId, sampleId, actor)
    enqueue(db, 'visit', visitId)
    return { visitId, sampleId, patientId, warnings }
  })
}

export function paidTotal(db: Db, visitId: number): number {
  return db.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM payments WHERE visit_id = ?', visitId)?.s ?? 0
}

export function addPayment(db: Db, visitId: number, amount: number, note = ''): void {
  if (!(amount > 0)) throw new Error('Amount must be more than zero')
  db.run('INSERT INTO payments(visit_id, amount, paid_at, note) VALUES(?,?,?,?)', visitId, amount, nowIso(), note)
  audit(db, 'payment.add', 'visits', visitId, String(amount))
  enqueue(db, 'visit', visitId)
}

export function updateBill(db: Db, visitId: number, total: number, discount: number): void {
  db.run('UPDATE visits SET total = ?, discount = ? WHERE id = ?', Math.max(0, total), Math.max(0, discount), visitId)
  audit(db, 'visit.bill', 'visits', visitId, `${total}/${discount}`)
  enqueue(db, 'visit', visitId)
}

export function cancelVisit(db: Db, visitId: number, reason: string): void {
  const approved = db.get('SELECT 1 AS x FROM reports WHERE visit_id = ? AND status = ?', visitId, 'approved')
  if (approved) throw new Error('This visit already has an approved report and cannot be cancelled')
  db.run('UPDATE visits SET cancelled = 1 WHERE id = ?', visitId)
  audit(db, 'visit.cancel', 'visits', visitId, reason)
  enqueue(db, 'visit', visitId)
}

export interface VisitListItem {
  id: number
  sampleId: string
  date: string
  patientId: number
  patientName: string
  title: string
  sex: Sex
  phone: string
  age: AgeInput
  doctor: string
  tests: string
  total: number
  paid: number
  due: number
  reportStatus: 'none' | 'draft' | 'approved' | 'imported'
  source: string
  pendingSentOut: number
}

export interface VisitFilter {
  from?: string
  to?: string
  doctor?: string
  q?: string
  patientId?: number
  status?: 'pending' | 'done' | 'dues' | 'all'
  limit?: number
}

export function listVisits(db: Db, f: VisitFilter = {}): VisitListItem[] {
  const where: string[] = ['v.cancelled = 0']
  const args: (string | number)[] = []
  if (f.from) { where.push('v.visit_date >= ?'); args.push(f.from) }
  if (f.to) { where.push('v.visit_date <= ?'); args.push(f.to) }
  if (f.doctor) { where.push('v.doctor = ? COLLATE NOCASE'); args.push(f.doctor) }
  if (f.patientId) { where.push('v.patient_id = ?'); args.push(f.patientId) }
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, '')}%`
    const digits = f.q.replace(/\D/g, '')
    where.push("(p.name LIKE ? COLLATE NOCASE OR p.village LIKE ? COLLATE NOCASE OR v.sample_id LIKE ? OR (? != '' AND p.phone LIKE ?))")
    args.push(like, like, like, digits, `%${digits}%`)
  }
  const rows = db.all<any>(
    `SELECT v.*, p.name AS pname, p.title AS ptitle, p.sex AS psex, p.phone AS pphone,
       (SELECT group_concat(name, ', ') FROM visit_tests t WHERE t.visit_id = v.id) AS tests,
       COALESCE((SELECT SUM(amount) FROM payments y WHERE y.visit_id = v.id), 0) AS paid,
       (SELECT status FROM reports r WHERE r.visit_id = v.id AND r.is_current = 1 ORDER BY version DESC LIMIT 1) AS rstatus,
       (SELECT COUNT(*) FROM visit_tests t WHERE t.visit_id = v.id AND t.sent_out = 1 AND t.received_at IS NULL) AS pso
     FROM visits v JOIN patients p ON p.id = v.patient_id
     WHERE ${where.join(' AND ')} ORDER BY v.visit_date DESC, v.id DESC LIMIT ?`,
    ...args, f.limit ?? 300
  )
  let out = rows.map((r): VisitListItem => ({
    id: r.id, sampleId: r.sample_id, date: r.visit_date, patientId: r.patient_id, patientName: r.pname, title: r.ptitle, sex: r.psex,
    phone: r.pphone, age: { years: r.age_y, months: r.age_m, days: r.age_d }, doctor: r.doctor, tests: r.tests ?? '',
    total: r.total, paid: r.paid, due: Math.max(0, r.total - r.paid), reportStatus: r.rstatus ?? 'none', source: r.source, pendingSentOut: r.pso
  }))
  if (f.status === 'pending') out = out.filter((v) => v.reportStatus === 'draft')
  if (f.status === 'done') out = out.filter((v) => v.reportStatus === 'approved' || v.reportStatus === 'imported')
  if (f.status === 'dues') out = out.filter((v) => v.due > 0)
  return out
}

export function getVisit(db: Db, id: number) {
  const v = db.get<any>('SELECT * FROM visits WHERE id = ?', id)
  if (!v) return null
  const tests = db.all<any>('SELECT * FROM visit_tests WHERE visit_id = ? ORDER BY id', id)
  const payments = db.all<any>('SELECT * FROM payments WHERE visit_id = ? ORDER BY id', id)
  const patient = db.get<any>('SELECT * FROM patients WHERE id = ?', v.patient_id)
  const reports = db.all<any>('SELECT id, version, status, is_current, approved_at, approved_by, reason, dup_reason, created_at FROM reports WHERE visit_id = ? ORDER BY version', id)
  return { visit: v, patient, tests, payments, paid: payments.reduce((a: number, p: any) => a + p.amount, 0), reports }
}

/** Remove a test from a visit while its report is still a draft (bill is left for the user to adjust). */
export function removeTest(db: Db, visitTestId: number): void {
  const t = db.get<any>('SELECT * FROM visit_tests WHERE id = ?', visitTestId)
  if (!t) return
  const approved = db.get('SELECT 1 AS x FROM reports WHERE visit_id = ? AND status = ?', t.visit_id, 'approved')
  if (approved) throw new Error('Report already approved')
  db.run('DELETE FROM visit_tests WHERE id = ?', visitTestId)
  db.run('DELETE FROM report_results WHERE report_id IN (SELECT id FROM reports WHERE visit_id = ? AND status = ?) AND panel_code = ?', t.visit_id, 'draft', t.panel_code)
  audit(db, 'visit.remove_test', 'visits', t.visit_id, t.panel_code)
}

export function markSentOut(db: Db, visitTestId: number, data: { sentTo?: string; sentAt?: string; receivedAt?: string | null }): void {
  const t = db.get<any>('SELECT * FROM visit_tests WHERE id = ? AND sent_out = 1', visitTestId)
  if (!t) throw new Error('Not a sent-out test')
  db.run(
    'UPDATE visit_tests SET sent_to = COALESCE(?, sent_to), sent_at = COALESCE(?, sent_at), received_at = ? WHERE id = ?',
    data.sentTo ?? null, data.sentAt ?? null, data.receivedAt === undefined ? t.received_at : data.receivedAt, visitTestId
  )
  audit(db, 'sentout.update', 'visit_tests', visitTestId, JSON.stringify(data))
  enqueue(db, 'visit', t.visit_id)
}

/** Keep the lab's received original PDF exactly as it came. */
export function attachSentOutPdf(db: Db, visitTestId: number, srcPath: string, dataDir: string): string {
  const t = db.get<any>('SELECT * FROM visit_tests WHERE id = ? AND sent_out = 1', visitTestId)
  if (!t) throw new Error('Not a sent-out test')
  const dir = join(dataDir, 'attachments', String(t.visit_id))
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `${visitTestId}-${basename(srcPath)}`)
  copyFileSync(srcPath, dest)
  db.run('UPDATE visit_tests SET attachment = ?, received_at = COALESCE(received_at, ?) WHERE id = ?', dest, localDate(), visitTestId)
  audit(db, 'sentout.attach', 'visit_tests', visitTestId, basename(srcPath))
  enqueue(db, 'visit', t.visit_id)
  return dest
}
