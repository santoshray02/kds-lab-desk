import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { addPayment, createVisit, getVisit } from '../src/main/visits'
import { payQrFor, qrSvgSync, receiptHtml } from '../src/main/bill'
import { setSettings } from '../src/main/settings'
import { isUpiId, upiLink } from '../src/shared/upi'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
})
const visit = (opts: Partial<Parameters<typeof createVisit>[1]> = {}) =>
  createVisit(db, { patient: { name: 'Pay Person', title: 'Mr', sex: 'M', phone: '', village: '' }, age: { years: 40, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['CBC', 'ESR'], ...opts })
const on = (extra: object = {}) => setSettings(db, { payQr: { enabled: true, upiId: 'kdspathology@okaxis', payeeName: '', onReceipt: 'whenDue', withAmount: true, ...extra } })

describe('UPI link', () => {
  it('accepts real UPI IDs and refuses the rest', () => {
    for (const ok of ['kdspathology@okaxis', 'ram.kumar-12@ybl', '9800000001@paytm', 'lab_1@sbi']) expect(isUpiId(ok), ok).toBe(true)
    for (const bad of ['', 'nobank', '@ybl', 'a@b', 'ram kumar@ybl', 'ram@yb l', 'ram@@ybl', 'ram@123']) expect(isUpiId(bad), bad).toBe(false)
  })

  it('builds the link every UPI app understands', () => {
    expect(upiLink({ upiId: 'kdspathology@okaxis', name: 'K.D.S. Pathology', amount: 470, note: '2610-001' }))
      .toBe('upi://pay?pa=kdspathology%40okaxis&pn=K.D.S.%20Pathology&am=470.00&cu=INR&tn=2610-001')
    expect(upiLink({ upiId: 'lab@ybl', name: '' })).toBe('upi://pay?pa=lab%40ybl&cu=INR')
    expect(upiLink({ upiId: 'lab@ybl', name: 'A', amount: 12.345 })).toContain('am=12.35')
  })

  it('cleans odd characters out of the name and note, and refuses a bad ID or amount', () => {
    const l = upiLink({ upiId: 'lab@ybl', name: 'Lab <script>&amp; Co\n', note: 'x=1&y=2' })
    expect(l).not.toContain('<')
    expect(l).not.toContain('\n')
    expect(l.match(/&/g)!.length).toBe(3) // pa, pn, cu are separated by &, and tn: nothing from the note leaked a new field
    expect(() => upiLink({ upiId: 'bad', name: 'x' })).toThrow(/UPI ID/)
    expect(() => upiLink({ upiId: 'lab@ybl', name: 'x', amount: 0 })).toThrow(/amount/)
    expect(() => upiLink({ upiId: 'lab@ybl', name: 'x', amount: 5_000_000 })).toThrow(/amount/)
  })
})

describe('QR picture', () => {
  it('is a real SVG with dark squares and a white border', () => {
    const svg = qrSvgSync('upi://pay?pa=lab%40ybl&cu=INR')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('viewBox="0 0 ')
    expect(svg).toContain('fill="#fff"')
    expect(svg.match(/h1v1h-1z/g)!.length).toBeGreaterThan(100)
  })
})

describe('payment QR for a visit', () => {
  it('is for the amount due, uses the lab name, and carries the sample ID', () => {
    on()
    const v = visit({ paid: 100, discount: 20 }) // bill 240, due 140
    const q = payQrFor(db, v.visitId)
    expect(q).toMatchObject({ due: 140, amount: 140, upiId: 'kdspathology@okaxis', payeeName: 'K.D.S. PATHOLOGY' })
    expect(q.link).toBe(`upi://pay?pa=kdspathology%40okaxis&pn=K.D.S.%20PATHOLOGY&am=140.00&cu=INR&tn=${getVisit(db, v.visitId)!.visit.sample_id}`)
    expect(payQrFor(db, v.visitId, 50).amount).toBe(50)
    on({ payeeName: 'My Lab', withAmount: false })
    const free = payQrFor(db, v.visitId)
    expect(free.amount).toBeUndefined()
    expect(free.link).toContain('pn=My%20Lab')
    expect(free.link).not.toContain('am=')
  })

  it('needs a valid UPI ID', () => {
    const v = visit()
    expect(() => payQrFor(db, v.visitId)).toThrow(/UPI ID/)
    on({ upiId: 'not a upi id' })
    expect(() => payQrFor(db, v.visitId)).toThrow(/UPI ID/)
  })
})

describe('QR on the receipt', () => {
  it('is off until the lab turns it on', () => {
    const v = visit()
    expect(receiptHtml(db, v.visitId)).not.toContain('pay-qr')
    setSettings(db, { payQr: { enabled: false, upiId: 'kdspathology@okaxis', payeeName: '', onReceipt: 'whenDue', withAmount: true } })
    expect(receiptHtml(db, v.visitId)).not.toContain('pay-qr')
  })

  it('appears when something is due, with the amount, and goes once everything is paid', () => {
    on()
    const v = visit({ paid: 100 })
    const h = receiptHtml(db, v.visitId)
    expect(h).toContain('data-testid="pay-qr"')
    expect(h).toContain('Pay ₹160 by UPI')
    expect(h).toContain('kdspathology@okaxis')
    addPayment(db, v.visitId, 160, '', 'upi')
    expect(receiptHtml(db, v.visitId)).not.toContain('pay-qr')
  })

  it('follows the choices: always (no amount when nothing is due), never, no amount', () => {
    const v = visit({ paid: 260 })
    on({ onReceipt: 'always' })
    const h = receiptHtml(db, v.visitId)
    expect(h).toContain('pay-qr')
    expect(h).toContain('Pay by UPI')
    expect(h).not.toContain('Pay ₹')
    on({ onReceipt: 'never' })
    expect(receiptHtml(db, v.visitId)).not.toContain('pay-qr')
    const due = visit()
    on({ withAmount: false })
    expect(receiptHtml(db, due.visitId)).toContain('Pay by UPI')
  })

  it('is left out, not broken, when the saved UPI ID is invalid', () => {
    on({ upiId: 'oops' })
    const v = visit()
    expect(() => receiptHtml(db, v.visitId)).not.toThrow()
    expect(receiptHtml(db, v.visitId)).not.toContain('pay-qr')
  })
})
