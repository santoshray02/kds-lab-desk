import { audit, enqueue, nowIso, type Db } from './db'
import type { Sex } from '../shared/types'

export const clock = { now: () => new Date() }

export function localDate(d: Date = clock.now()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Keep digits only; drop a leading country code / zero so every number is stored as 10 digits. */
export function normalizePhone(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length > 10) return d.slice(-10)
  return d
}

export interface PatientRow {
  id: number
  name: string
  title: string
  sex: Sex
  phone: string
  village: string
  source: string
  created_at: string
}

export interface PersonSummary extends PatientRow {
  lastVisitDate: string | null
  lastDoctor: string | null
  lastAge: { years: number; months: number; days: number } | null
  /** age today, worked out from the age at the last visit */
  ageNow: { years: number; months: number; days: number } | null
  visitCount: number
}

function ageToday(last: { y: number; m: number; d: number }, lastDate: string, today: Date) {
  const [yy, mm, dd] = lastDate.split('-').map(Number)
  const then = new Date(yy, mm - 1, dd)
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000))
  // approximate: add whole years elapsed to a year-based age; small ages are advanced in days/months
  if (last.y > 0) return { years: last.y + Math.floor(days / 365.25), months: 0, days: 0 }
  if (last.m > 0) {
    const totalMonths = last.m + Math.floor(days / 30.44)
    return totalMonths >= 12 ? { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days: 0 } : { years: 0, months: totalMonths, days: 0 }
  }
  const totalDays = last.d + days
  return totalDays >= 30 ? { years: 0, months: Math.floor(totalDays / 30.44), days: 0 } : { years: 0, months: 0, days: totalDays }
}

function summarize(db: Db, rows: PatientRow[]): PersonSummary[] {
  return rows.map((p) => {
    const v = db.get<any>('SELECT visit_date, doctor, age_y, age_m, age_d FROM visits WHERE patient_id = ? AND cancelled = 0 ORDER BY visit_date DESC, id DESC LIMIT 1', p.id)
    const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM visits WHERE patient_id = ? AND cancelled = 0', p.id)!.n
    return {
      ...p,
      lastVisitDate: v?.visit_date ?? null,
      lastDoctor: v?.doctor ?? null,
      lastAge: v ? { years: v.age_y, months: v.age_m, days: v.age_d } : null,
      ageNow: v ? ageToday({ y: v.age_y, m: v.age_m, d: v.age_d }, v.visit_date, clock.now()) : null,
      visitCount: n
    }
  })
}

/** Every person registered on this phone number (families share one phone). */
export function peopleByPhone(db: Db, phone: string): PersonSummary[] {
  const p = normalizePhone(phone)
  if (p.length < 10) return []
  return summarize(db, db.all<PatientRow>('SELECT * FROM patients WHERE phone = ? ORDER BY name COLLATE NOCASE', p))
}

/** Search without a phone: name, village, partial phone or sample ID. */
export function searchPeople(db: Db, q: string, limit = 50): PersonSummary[] {
  const t = q.trim()
  if (!t) return summarize(db, db.all<PatientRow>('SELECT * FROM patients ORDER BY updated_at DESC LIMIT ?', limit))
  const like = `%${t.replace(/[%_]/g, '')}%`
  const digits = t.replace(/\D/g, '')
  const rows = db.all<PatientRow>(
    `SELECT DISTINCT p.* FROM patients p LEFT JOIN visits v ON v.patient_id = p.id
     WHERE p.name LIKE ? COLLATE NOCASE OR p.village LIKE ? COLLATE NOCASE
        OR (? != '' AND p.phone LIKE ?) OR v.sample_id LIKE ?
     ORDER BY p.updated_at DESC LIMIT ?`,
    like, like, digits, `%${digits}%`, like, limit
  )
  return summarize(db, rows)
}

export interface PatientInput {
  id?: number
  name: string
  title: string
  sex: Sex
  phone: string
  village?: string
}

export function savePatient(db: Db, p: PatientInput, source: 'app' | 'imported' = 'app'): number {
  const name = p.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Patient name is required')
  const phone = normalizePhone(p.phone)
  if (p.phone && phone.length !== 10) throw new Error('Phone number must have 10 digits')
  const now = nowIso()
  if (p.id) {
    db.run('UPDATE patients SET name=?, title=?, sex=?, phone=?, village=?, updated_at=? WHERE id=?', name, p.title, p.sex, phone, p.village ?? '', now, p.id)
    enqueue(db, 'patient', p.id)
    return p.id
  }
  const id = db.run('INSERT INTO patients(name, title, sex, phone, village, source, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', name, p.title, p.sex, phone, p.village ?? '', source, now, now).lastId
  audit(db, 'patient.create', 'patients', id)
  enqueue(db, 'patient', id)
  return id
}

/** Correct a patient's details. Sex cannot change once a report was issued (its ranges and flags depend on it). */
export function updatePatient(db: Db, p: PatientInput): number {
  if (!p.id) throw new Error('Unknown patient')
  const old = getPatient(db, p.id)
  if (!old) throw new Error('Unknown patient')
  const issued = db.get('SELECT 1 AS x FROM reports r JOIN visits v ON v.id = r.visit_id WHERE v.patient_id = ? AND r.status = ?', p.id, 'approved')
  if (issued && p.sex !== old.sex) throw new Error('The sex cannot be changed after a report was issued. Make a correction to the report instead.')
  savePatient(db, { ...p, phone: p.phone ?? old.phone })
  // printed copies must show the corrected name: drop cached PDFs and tell the cloud
  for (const r of db.all<{ id: number }>('SELECT r.id FROM reports r JOIN visits v ON v.id = r.visit_id WHERE v.patient_id = ?', p.id)) {
    db.run('UPDATE reports SET pdf_path = NULL WHERE id = ?', r.id)
    if (db.get('SELECT 1 AS x FROM reports WHERE id = ? AND status = ?', r.id, 'approved')) enqueue(db, 'report', r.id)
  }
  audit(db, 'patient.update', 'patients', p.id, `${old.name} -> ${p.name}`)
  return 1
}

export function suggestDoctors(db: Db, prefix: string, limit = 8): string[] {
  const t = prefix.trim()
  const rows = db.all<{ name: string }>(
    `SELECT name FROM doctors WHERE name LIKE ? COLLATE NOCASE ORDER BY uses DESC, last_used DESC LIMIT ?`,
    t ? `%${t.replace(/[%_]/g, '')}%` : '%', limit
  )
  const out = rows.map((r) => r.name)
  if (!out.some((n) => n.toLowerCase() === 'self') && (!t || 'self'.startsWith(t.toLowerCase()))) out.unshift('Self')
  return out
}

export function touchDoctor(db: Db, name: string): void {
  const n = name.trim()
  if (!n) return
  db.run('INSERT INTO doctors(name, uses, last_used) VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used', n, nowIso())
}

export function getPatient(db: Db, id: number) {
  return db.get<PatientRow>('SELECT * FROM patients WHERE id = ?', id)
}
