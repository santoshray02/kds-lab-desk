import { beforeEach, describe, expect, it } from 'vitest'
import { bmi, NO_VITALS, vitalsLine, vitalsProblem, type Vitals } from '../src/shared/vitals'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock, getPatient, updatePatient } from '../src/main/patients'
import { setSettings } from '../src/main/settings'
import { createVisit, saveVitals } from '../src/main/visits'
import { approveReport, buildReportData, getEntry, saveDraft, startCorrection } from '../src/main/results'

const V = (p: Partial<Vitals>): Vitals => ({ ...NO_VITALS, ...p })

describe('vitals rules', () => {
  it('accepts normal values and blanks, refuses impossible ones', () => {
    expect(vitalsProblem(NO_VITALS)).toBeNull()
    expect(vitalsProblem(V({ heightCm: 165, weightKg: 60, bpSys: 120, bpDia: 80, pulse: 78, tempF: 98.6, spo2: 98 }))).toBeNull()
    expect(vitalsProblem(V({ heightCm: 16 }))).toMatch(/Height/) // 165 typed as 16
    expect(vitalsProblem(V({ weightKg: 600 }))).toMatch(/Weight/)
    expect(vitalsProblem(V({ bpSys: 120 }))).toMatch(/both/)
    expect(vitalsProblem(V({ bpSys: 80, bpDia: 120 }))).toMatch(/lower/)
    expect(vitalsProblem(V({ tempF: 986 }))).toMatch(/Temperature/)
    expect(vitalsProblem(V({ spo2: 101 }))).toMatch(/Oxygen/)
    expect(vitalsProblem(V({ pulse: NaN }))).toMatch(/Pulse/)
  })
  it('works out BMI for adults only and writes one readable line', () => {
    const v = V({ heightCm: 170, weightKg: 72.25, bpSys: 130, bpDia: 85, pulse: 80, tempF: 99, spo2: 97 })
    expect(bmi(v, 30)).toBe(25)
    expect(bmi(v, 10)).toBeNull()
    expect(vitalsLine(v, 30)).toBe('Height 170 cm · Weight 72.3 kg · BMI 25.0 (Overweight) · BP 130/85 mmHg · Pulse 80/min · Temp 99 °F · SpO₂ 97%')
    expect(vitalsLine(v, 10)).not.toContain('BMI')
    expect(vitalsLine(NO_VITALS, 30)).toBe('')
  })
})

let db: Db
let n = 0
beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
  n = 0
})
function visit(vitals?: Vitals, phone = '') {
  n++
  return createVisit(db, { patient: { name: `Vit Person ${n}`, title: 'Mr', sex: 'M', phone, village: 'T' }, age: { years: 40, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['RBS'], paid: 0, vitals })
}

describe('vitals on a visit', () => {
  it('are saved at registration, shown in the entry, and can change until approval', () => {
    const { visitId } = visit(V({ heightCm: 160, weightKg: 55 }))
    let e = getEntry(db, visitId)
    expect(e.vitals).toMatchObject({ heightCm: 160, weightKg: 55, bpSys: null })
    expect(e.vitalsEditable).toBe(true)
    saveVitals(db, visitId, V({ heightCm: 160, weightKg: 56, bpSys: 118, bpDia: 76 }))
    e = getEntry(db, visitId)
    expect(e.vitals).toMatchObject({ weightKg: 56, bpSys: 118, bpDia: 76 })
    expect(() => saveVitals(db, visitId, V({ heightCm: 5 }))).toThrow(/Height/)
    expect(() => visit(V({ pulse: 1000 }))).toThrow(/Pulse/)
  })
  it('lock when the report is approved and open again for a correction', () => {
    const { visitId } = visit(V({ weightKg: 70 }))
    const rid = getEntry(db, visitId).reportId!
    saveDraft(db, rid, { rbs: '95' })
    approveReport(db, rid, {})
    expect(getEntry(db, visitId).vitalsEditable).toBe(false)
    expect(() => saveVitals(db, visitId, V({ weightKg: 71 }))).toThrow(/locked/)
    startCorrection(db, visitId, { reason: 'wrong weight' })
    expect(getEntry(db, visitId).vitalsEditable).toBe(true)
    saveVitals(db, visitId, V({ weightKg: 71 }))
    expect(getEntry(db, visitId).vitals.weightKg).toBe(71)
  })
  it('print on the report only when the setting is on and something was taken', () => {
    const a = visit(V({ heightCm: 170, weightKg: 70 }))
    const b = visit()
    const ra = getEntry(db, a.visitId).reportId!
    const rb = getEntry(db, b.visitId).reportId!
    expect(buildReportData(db, ra).vitalsText).toBe('')
    setSettings(db, { reportVitals: true })
    expect(buildReportData(db, ra).vitalsText).toContain('Height 170 cm · Weight 70 kg · BMI 24.2')
    expect(buildReportData(db, rb).vitalsText).toBe('')
  })
})

describe('changing a mobile number', () => {
  it('updates one person only, validates it, and clears the cached PDF', () => {
    const a = visit(undefined, '9800011111')
    const b = visit(undefined, '9800011111') // a different person on the same phone
    updatePatient(db, { id: a.patientId, name: 'Vit Person 1', title: 'Mr', sex: 'M', phone: '9811122222', village: 'T' })
    expect(getPatient(db, a.patientId)!.phone).toBe('9811122222')
    expect(getPatient(db, b.patientId)!.phone).toBe('9800011111')
    expect(getEntry(db, a.visitId).phone).toBe('9811122222')
    expect(() => updatePatient(db, { id: a.patientId, name: 'Vit Person 1', title: 'Mr', sex: 'M', phone: '12345', village: 'T' })).toThrow(/10 digits/)
    updatePatient(db, { id: a.patientId, name: 'Vit Person 1', title: 'Mr', sex: 'M', phone: '', village: 'T' })
    expect(getPatient(db, a.patientId)!.phone).toBe('')
  })
})
