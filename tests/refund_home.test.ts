import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { cancelVisit, createVisit, getVisit, homePending, listVisits, markCollected, paidTotal, refundPayment } from '../src/main/visits'
import { cashDay, commissionReport, setDoctorCommission } from '../src/main/money'
import { duesReport, dayReport } from '../src/main/owner'
import { receiptHtml, buildReceiptData } from '../src/main/bill'
import { exportSheets } from '../src/main/exporter'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
})
const visit = (opts: Partial<Parameters<typeof createVisit>[1]> = {}) =>
  createVisit(db, { patient: { name: 'Home Person', title: 'Mrs', sex: 'F', phone: '9800000088', village: 'Rampur' }, age: { years: 55, months: 0, days: 0 }, doctor: 'Dr. Rao', panelCodes: ['CBC', 'ESR'], ...opts })

describe('refunds', () => {
  it('give money back as a negative payment, and every total follows', () => {
    const v = visit({ paid: 260 }) // bill 260, fully paid in cash
    refundPayment(db, v.visitId, { amount: 60, reason: 'ESR not done', method: 'cash' })
    expect(paidTotal(db, v.visitId)).toBe(200)
    expect(getVisit(db, v.visitId)!.payments.map((p: any) => p.amount)).toEqual([260, -60])
    expect(getVisit(db, v.visitId)!.payments[1].note).toBe('Refund: ESR not done')
    // not lowering the bill: the patient still owes the full bill
    expect(listVisits(db, { patientId: v.patientId })[0]).toMatchObject({ total: 260, paid: 200, due: 60 })
    expect(cashDay(db, '2026-10-25')).toMatchObject({ cash: 200, refunds: 60, expected: 200 })
    expect(dayReport(db, '2026-10-25').cashReceived).toBe(200)
  })

  it('can lower the bill as a discount at the same time, so nothing is left due', () => {
    const v = visit({ paid: 260 })
    refundPayment(db, v.visitId, { amount: 60, reason: 'ESR not done', lowerBill: true })
    const row = listVisits(db, { patientId: v.patientId })[0]
    expect(row).toMatchObject({ total: 200, paid: 200, due: 0 })
    expect(duesReport(db).rows).toEqual([])
    const g = getVisit(db, v.visitId)!
    expect(g.visit.discount).toBe(60)
    const r = buildReceiptData(db, v.visitId)
    expect(r).toMatchObject({ gross: 260, discount: 60, total: 200, paid: 200, due: 0 })
    expect(r.payments.map((p) => [p.amount, p.method])).toEqual([[260, 'Cash'], [-60, 'Refund']])
    const h = receiptHtml(db, v.visitId)
    expect(h).toContain('−₹60')
    expect(h).toContain('Refund')
  })

  it('cannot give back more than was paid, without a reason, or on a cancelled visit', () => {
    const v = visit({ paid: 100 })
    expect(() => refundPayment(db, v.visitId, { amount: 150, reason: 'x yes' })).toThrow(/no more than/)
    expect(() => refundPayment(db, v.visitId, { amount: 50, reason: ' ' })).toThrow(/reason/)
    expect(() => refundPayment(db, v.visitId, { amount: 0, reason: 'zero' })).toThrow(/more than zero/)
    refundPayment(db, v.visitId, { amount: 100, reason: 'all back' })
    expect(() => refundPayment(db, v.visitId, { amount: 1, reason: 'again' })).toThrow(/no more than/)
    cancelVisit(db, v.visitId, 'wrong patient')
    expect(() => refundPayment(db, v.visitId, { amount: 1, reason: 'late' })).toThrow(/cancelled/)
  })

  it('takes UPI refunds out of UPI, not out of the drawer, and reduces commission on money received', () => {
    setDoctorCommission(db, 'Dr. Rao', 10)
    const v = visit({ paid: 100, payMethod: 'upi' })
    refundPayment(db, v.visitId, { amount: 40, reason: 'overpaid', method: 'upi' })
    expect(cashDay(db, '2026-10-25')).toMatchObject({ cash: 0, upi: 60, refunds: 0 })
    expect(exportSheets(db, { from: '2026-10-01', to: '2026-10-31', sheets: ['payments'] })[0].rows.slice(1).map((r) => r[3])).toEqual([100, -40])
  })
})

describe('home collection', () => {
  it('records the address, adds the charge to the bill, and lists the job until it is collected', () => {
    const v = visit({ home: { address: 'Near the temple, Rampur', time: 'Morning 7-9', collector: 'Ravi', fee: 50 }, paid: 100 })
    const g = getVisit(db, v.visitId)!.visit
    expect(g).toMatchObject({ collection: 'home', home_address: 'Near the temple, Rampur', home_time: 'Morning 7-9', collector: 'Ravi', home_fee: 50, total: 310, collected_at: null })
    const jobs = homePending(db)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ visitId: v.visitId, patient: 'Mrs. Home Person', address: 'Near the temple, Rampur', time: 'Morning 7-9', collector: 'Ravi', due: 210, fee: 50 })
    expect(jobs[0].tests).toContain('Complete Blood Count')

    markCollected(db, v.visitId, true, 'Sunil')
    expect(homePending(db)).toEqual([])
    expect(getVisit(db, v.visitId)!.visit).toMatchObject({ collector: 'Sunil' })
    expect(getVisit(db, v.visitId)!.visit.collected_at).toBeTruthy()
    markCollected(db, v.visitId, false) // marked by mistake
    expect(homePending(db)).toHaveLength(1)
  })

  it('shows the charge on the receipt and leaves it out of the doctor commission', () => {
    setDoctorCommission(db, 'Dr. Rao', 10)
    const v = visit({ home: { address: 'Rampur chowk', fee: 40 } }) // tests 260 + 40
    const h = receiptHtml(db, v.visitId)
    expect(h).toContain('Home collection charge')
    expect(h).toContain('₹300')
    expect(buildReceiptData(db, v.visitId)).toMatchObject({ gross: 260, homeFee: 40, total: 300 })
    expect(commissionReport(db, '2026-10').rows[0]).toMatchObject({ billed: 300, earned: 26 })
  })

  it('needs an address, ignores a negative charge, and is not for lab visits', () => {
    expect(() => visit({ home: { address: ' ' } })).toThrow(/address/)
    const v = visit({ home: { address: 'Rampur chowk', fee: -20 } })
    expect(getVisit(db, v.visitId)!.visit.home_fee).toBe(0)
    const lab = visit()
    expect(() => markCollected(db, lab.visitId)).toThrow(/not a home collection/)
    expect(() => markCollected(db, 9999)).toThrow(/not found/)
    expect(homePending(db)).toHaveLength(1)
  })

  it('drops out of the list when the visit is cancelled', () => {
    const v = visit({ home: { address: 'Rampur chowk' } })
    cancelVisit(db, v.visitId, 'patient changed mind')
    expect(homePending(db)).toEqual([])
  })
})
