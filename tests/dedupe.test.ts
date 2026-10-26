import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock, getPatient } from '../src/main/patients'
import { createVisit, listVisits } from '../src/main/visits'
import { editDistance, findDuplicates, mergePatients, normName } from '../src/main/dedupe'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
})

const visit = (name: string, phone: string, sex: 'M' | 'F' = 'M', village = 'Testpur', title = sex === 'F' ? 'Mrs' : 'Mr') =>
  createVisit(db, { patient: { name, title, sex, phone, village }, age: { years: 30, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['CBC'] })

describe('name comparison', () => {
  it('ignores titles, dots, spaces and case', () => {
    expect(normName('Mr. Ram  Kumar')).toBe('ramkumar')
    expect(normName('RAM KUMAR')).toBe('ramkumar')
    expect(normName('Mrs. Dr. Sita Devi')).toBe('sitadevi')
    expect(editDistance('ramkumar', 'ramkumaar')).toBe(1)
    expect(editDistance('ram', 'shyam')).toBeGreaterThan(1)
  })
})

describe('finding duplicates', () => {
  it('finds the same person typed twice, but not family members or different sexes', () => {
    visit('Ram Kumar', '9800000001')
    visit('RAM  KUMAR', '9800000001')            // same name, same phone
    visit('Sunita Devi', '', 'F')                 // same name, one without phone
    visit('Sunita Devi', '9800000002', 'F')
    visit('Anil Singh', '9800000003')             // family: same phone, different names
    visit('Sunil Singh', '9800000003')
    visit('Mohan Prasad', '9800000004')           // typing slip on the same phone
    visit('Mohan Prasaad', '9800000004')
    visit('Gita Kumari', '9800000005', 'F')       // same name, different sex
    visit('Gita Kumari', '9800000006', 'M')
    const pairs = findDuplicates(db)
    expect(pairs).toHaveLength(3)
    expect(pairs.find((p) => p.reason.includes('very similar'))).toBeTruthy()
    expect(pairs.some((p) => /Anil|Sunil/.test(p.a.name))).toBe(false)
    expect(pairs.some((p) => /Gita/.test(p.a.name))).toBe(false)
  })
})

describe('merging', () => {
  it('moves the visits to the kept person, fills blanks, and removes the extra record', () => {
    const a = visit('Sunita Devi', '')
    const b = visit('Sunita Devi', '9800000002', 'M', 'Rampur')
    const v1 = visit('Sunita Devi', '')
    db.run('UPDATE visits SET patient_id = ? WHERE id = ?', a.patientId, v1.visitId)
    const r = mergePatients(db, a.patientId, b.patientId)
    expect(r.moved).toBe(1)
    expect(getPatient(db, b.patientId)).toBeUndefined()
    const kept = getPatient(db, a.patientId)!
    expect(kept.phone).toBe('9800000002')
    expect(kept.village).toBe('Testpur')
    expect(listVisits(db, { patientId: a.patientId })).toHaveLength(3)
    expect(db.get("SELECT 1 x FROM audit_log WHERE action = 'patient.merge'")).toBeTruthy()
    expect(db.get("SELECT 1 x FROM outbox WHERE entity = 'patient' AND entity_id = ? AND op = 'delete'", b.patientId)).toBeTruthy()
  })

  it('clears saved PDFs of the moved visits so they print the kept name', () => {
    const a = visit('Ram Kumar', '9800000001')
    const b = visit('Ram Kumar', '9800000001')
    db.run("UPDATE reports SET pdf_path = 'x.pdf'")
    mergePatients(db, a.patientId, b.patientId)
    const left = db.all<{ visit_id: number; pdf_path: string | null }>('SELECT visit_id, pdf_path FROM reports')
    expect(left.find((r) => r.visit_id === a.visitId)!.pdf_path).toBe('x.pdf') // untouched
    expect(left.find((r) => r.visit_id === b.visitId)!.pdf_path).toBeNull() // moved: printed fresh with the kept name
  })

  it('refuses the same person, unknown people, and a sex mismatch', () => {
    const a = visit('Gita Kumari', '9800000005', 'F')
    const b = visit('Gita Kumari', '9800000006', 'M')
    expect(() => mergePatients(db, a.patientId, a.patientId)).toThrow(/different/)
    expect(() => mergePatients(db, a.patientId, 9999)).toThrow(/not found/)
    expect(() => mergePatients(db, a.patientId, b.patientId)).toThrow(/Male and the other Female/)
    expect(getPatient(db, b.patientId)).toBeTruthy()
  })
})
