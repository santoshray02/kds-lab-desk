import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { addPayment, createVisit } from '../src/main/visits'
import { setSettings } from '../src/main/settings'
import { addExpense, addPayout, cashDay, closeDay, commissionReport, deleteExpense, deletePayout, doctorRates, listPayouts, setDoctorCommission } from '../src/main/money'
import { splitPackagePrice } from '../src/shared/packages'

let db: Db
const at = (m: number, d: number, h = 10) => { clock.now = () => new Date(2026, m - 1, d, h, 0, 0) }

function visit(name: string, doctor: string, codes: string[], opts: Partial<Parameters<typeof createVisit>[1]> = {}) {
  return createVisit(db, { patient: { name, title: 'Mr', sex: 'M', phone: '', village: 'Testpur' }, age: { years: 40, months: 0, days: 0 }, doctor, panelCodes: codes, ...opts })
}

beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  at(10, 5)
})

describe('doctor commission', () => {
  it('is worked out on the bill, per month, and never for Self', () => {
    visit('A One', 'Dr. Rao', ['CBC'])           // 200
    visit('B Two', 'Dr. Rao', ['CBC', 'ESR'])    // 260
    visit('C Three', 'Self', ['CBC'])
    setDoctorCommission(db, 'Dr. Rao', 20)
    // visits registered before the rate was set follow the doctor's rate
    const r = commissionReport(db, '2026-10')
    expect(r.rows.map((x) => x.doctor)).toEqual(['Dr. Rao'])
    expect(r.rows[0]).toMatchObject({ visits: 2, billed: 460, pct: 20, earned: 92, paid: 0, balance: 92 })
    expect(() => setDoctorCommission(db, 'Self', 10)).toThrow(/Self/)
    expect(() => setDoctorCommission(db, 'Dr. Rao', 120)).toThrow(/0 and 100/)
  })

  it('keeps the rate a visit was registered with when the rate changes later', () => {
    setDoctorCommission(db, 'Dr. Rao', 10)
    visit('A One', 'Dr. Rao', ['CBC'])           // 200 at 10% = 20
    setDoctorCommission(db, 'Dr. Rao', 30)
    visit('B Two', 'Dr. Rao', ['CBC'])           // 200 at 30% = 60
    expect(commissionReport(db, '2026-10').rows[0]).toMatchObject({ earned: 80, pct: 30 })
  })

  it('can be worked out on money received instead of the bill', () => {
    setDoctorCommission(db, 'Dr. Rao', 10)
    const v = visit('A One', 'Dr. Rao', ['CBC'], { paid: 100 })
    setSettings(db, { money: { commission: true, commissionBasis: 'collected', expenses: true, expenseCategories: ['Other'] } })
    expect(commissionReport(db, '2026-10').rows[0]).toMatchObject({ billed: 200, collected: 100, earned: 10 })
    at(10, 20)
    addPayment(db, v.visitId, 100)
    expect(commissionReport(db, '2026-10').rows[0].earned).toBe(20)
  })

  it('records payouts, shows month and running balance, and takes a payout back', () => {
    setDoctorCommission(db, 'Dr. Rao', 10)
    visit('A One', 'Dr. Rao', ['CBC'])           // October: 20
    at(11, 3)
    visit('B Two', 'Dr. Rao', ['CBC', 'ESR'])    // November: 26
    const id = addPayout(db, { doctor: 'Dr. Rao', month: '2026-10', amount: 15 })
    expect(listPayouts(db, '2026-10')).toHaveLength(1)
    const oct = commissionReport(db, '2026-10')
    expect(oct.rows[0]).toMatchObject({ earned: 20, paid: 15, balance: 5, balanceAll: 31 })
    const nov = commissionReport(db, '2026-11')
    expect(nov.rows[0]).toMatchObject({ earned: 26, paid: 0, balance: 26, balanceAll: 31 })
    deletePayout(db, id)
    expect(commissionReport(db, '2026-11').rows[0].balanceAll).toBe(46)
    expect(() => addPayout(db, { doctor: 'Dr. Rao', month: '2026-10', amount: 0 })).toThrow()
  })

  it('leaves out cancelled visits and lists doctors with their rates', () => {
    setDoctorCommission(db, 'Dr. Rao', 10)
    visit('A One', 'Dr. Rao', ['CBC'])
    db.run('UPDATE visits SET cancelled = 1')
    expect(commissionReport(db, '2026-10').rows).toEqual([])
    expect(doctorRates(db).find((d) => d.doctor === 'Dr. Rao')!.pct).toBe(10)
    expect(doctorRates(db).some((d) => d.doctor === 'Self')).toBe(false)
  })
})

describe('package price split', () => {
  it('shares the price in proportion and always adds up', () => {
    expect(splitPackagePrice([200, 60, 80], 300)).toEqual([176, 52, 72])
    for (const [p, t] of [[[100, 100, 100], 250], [[0, 0], 99], [[50], 40], [[33, 33, 34], 100]] as const) {
      const s = splitPackagePrice([...p], t)
      expect(s.reduce((a, b) => a + b, 0)).toBe(t)
      expect(s.every((x) => x >= 0)).toBe(true)
    }
    expect(splitPackagePrice([], 100)).toEqual([])
  })
})

describe('expenses and cash closing', () => {
  it('expected cash = opening + cash received - expenses; UPI is not cash', () => {
    visit('A One', 'Self', ['CBC'], { paid: 200 })                 // cash 200
    visit('B Two', 'Self', ['ESR'], { paid: 60, payMethod: 'upi' }) // upi 60
    addExpense(db, { category: 'Reagents & kits', amount: 50 })
    const d = cashDay(db, '2026-10-05')
    expect(d).toMatchObject({ opening: 0, cash: 200, upi: 60, card: 0, expensesTotal: 50, expected: 150 })
    expect(d.month).toMatchObject({ received: 260, expenses: 50, net: 210 })
    expect(d.closing).toBeNull()
  })

  it('records the counted cash and the difference, and carries the count to the next day', () => {
    visit('A One', 'Self', ['CBC'], { paid: 200 })
    const c = closeDay(db, '2026-10-05', 190, 'Rs 10 short')
    expect(c.closing).toMatchObject({ counted: 190, difference: -10, note: 'Rs 10 short' })
    at(10, 6)
    visit('B Two', 'Self', ['ESR'], { paid: 60 })
    const next = cashDay(db, '2026-10-06')
    expect(next.opening).toBe(190)
    expect(next.expected).toBe(250)
    // closing the same day again replaces the first count
    expect(closeDay(db, '2026-10-05', 200).closing!.difference).toBe(0)
    expect(cashDay(db, '2026-10-06').opening).toBe(200)
  })

  it('counts cash and spending of days nobody closed', () => {
    visit('A One', 'Self', ['CBC'], { paid: 200 })
    closeDay(db, '2026-10-05', 200)
    at(10, 6)
    visit('B Two', 'Self', ['ESR'], { paid: 60 })
    addExpense(db, { category: 'Transport', amount: 20 })         // 6 Oct, never closed
    at(10, 7)
    expect(cashDay(db, '2026-10-07').opening).toBe(240)
  })

  it('refuses silly input and deletes an expense', () => {
    expect(() => addExpense(db, { category: 'Rent', amount: 0 })).toThrow()
    expect(() => addExpense(db, { category: 'Rent', amount: 5, date: '5/10' })).toThrow(/date/)
    const id = addExpense(db, { category: '', amount: 5 })
    expect(cashDay(db, '2026-10-05').expenses[0].category).toBe('Other')
    deleteExpense(db, id)
    expect(cashDay(db, '2026-10-05').expenses).toEqual([])
    expect(() => closeDay(db, '2026-10-05', -1)).toThrow()
  })

  it('ignores money from cancelled visits', () => {
    const v = visit('A One', 'Self', ['CBC'], { paid: 200 })
    db.run('UPDATE visits SET cancelled = 1 WHERE id = ?', v.visitId)
    expect(cashDay(db, '2026-10-05').cash).toBe(0)
  })
})
