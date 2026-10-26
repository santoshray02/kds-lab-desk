import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { addPayment, createVisit, getVisit } from '../src/main/visits'
import { listPackages, removePackage, savePackage, seedPackages } from '../src/main/packages'
import { buildReceiptData, codeSvg, labelsHtml, receiptHtml } from '../src/main/bill'
import { setSettings } from '../src/main/settings'
import { splitPackagePrice } from '../src/shared/packages'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
})

const visit = (opts: Partial<Parameters<typeof createVisit>[1]> = {}) =>
  createVisit(db, { patient: { name: 'Receipt Person', title: 'Mr', sex: 'M', phone: '9800000077', village: 'Testpur' }, age: { years: 40, months: 0, days: 0 }, doctor: 'Dr. Rao', panelCodes: ['CBC', 'ESR'], ...opts })

describe('health packages', () => {
  it('start with examples, which are made once only', () => {
    seedPackages(db)
    const first = listPackages(db)
    expect(first.map((p) => p.name)).toEqual(['Fever panel', 'Diabetes check', 'Full body checkup', 'Before an operation'])
    expect(first.every((p) => p.price > 0 && p.panelCodes.length >= 3)).toBe(true)
    removePackage(db, first[0].id)
    seedPackages(db)
    expect(listPackages(db)).toHaveLength(3)
  })

  it('can be added, changed, hidden and checked', () => {
    const id = savePackage(db, { name: 'Pregnancy basics', price: 450, panelCodes: ['CBC', 'ABO', 'URINE'] })
    expect(listPackages(db)[0]).toMatchObject({ name: 'Pregnancy basics', price: 450, panelCodes: ['CBC', 'ABO', 'URINE'], active: true })
    savePackage(db, { id, name: 'Pregnancy basics', price: 400, panelCodes: ['CBC', 'ABO'], active: false })
    expect(listPackages(db)).toHaveLength(0)
    expect(listPackages(db, { includeInactive: true })[0]).toMatchObject({ price: 400, active: false })
    expect(() => savePackage(db, { name: 'x', price: 1, panelCodes: ['CBC'] })).toThrow(/name/)
    expect(() => savePackage(db, { name: 'Empty', price: 1, panelCodes: [] })).toThrow(/at least one/)
    expect(() => savePackage(db, { name: 'Bad', price: 1, panelCodes: ['NOPE'] })).toThrow(/Unknown test/)
    expect(() => savePackage(db, { name: 'pregnancy BASICS', price: 1, panelCodes: ['CBC'] })).toThrow(/already/)
  })

  it('a visit made from a package bills the package price and keeps its name', () => {
    const prices = ['CBC', 'ESR'].map((c) => db.get<{ price: number }>('SELECT price FROM test_panels WHERE code = ?', c)!.price)
    const split = splitPackagePrice(prices, 200)
    const v = visit({ priceOverrides: { CBC: split[0], ESR: split[1] }, package: 'Fever panel' })
    const g = getVisit(db, v.visitId)!
    expect(g.visit.total).toBe(200)
    expect(g.visit.package_name).toBe('Fever panel')
    expect(g.tests.reduce((a: number, t: any) => a + t.price, 0)).toBe(200)
  })
})

describe('receipt', () => {
  it('lists the tests, discount, payments by method and the balance', () => {
    const v = visit({ discount: 20, paid: 100, payMethod: 'upi' })
    addPayment(db, v.visitId, 40, 'Received later', 'cash')
    const d = buildReceiptData(db, v.visitId)
    expect(d).toMatchObject({ gross: 260, discount: 20, total: 240, paid: 140, due: 100, patient: 'Mr. Receipt Person', doctor: 'Dr. Rao', dateText: '25/10/2026' })
    expect(d.payments.map((p) => p.method)).toEqual(['UPI', 'Cash'])
    const h = receiptHtml(db, v.visitId)
    expect(h).toContain('RECEIPT')
    expect(h).toContain('Complete Blood Count (CBC)')
    expect(h).toContain('Balance due')
    expect(h).toContain('₹100')
    expect(h).toContain('Thank you. Get well soon.')
    expect(h).toContain('@page { size: A4')
  })

  it('follows the settings: thermal width, own footer, package name', () => {
    setSettings(db, { receipt: { style: 'thermal', thermalWidthMm: 58, footer: 'Visit again', printerName: '', autoPrint: false } })
    const v = visit({ package: 'Fever panel', paid: 260 })
    const h = receiptHtml(db, v.visitId)
    expect(h).toContain('size: 58mm')
    expect(h).toContain('Visit again')
    expect(h).toContain('Package: Fever panel')
    expect(h).toContain('>Balance<') // nothing due
    expect(h).not.toContain('Balance due')
  })

  it('escapes names so nothing in a name can change the page', () => {
    const v = visit({ patient: { name: '<b>Evil</b> & Co', title: 'Mr', sex: 'M', phone: '', village: '' } })
    const h = receiptHtml(db, v.visitId)
    expect(h).not.toContain('<b>Evil</b>')
    expect(h).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co')
  })
})

describe('sample labels', () => {
  it('make a Code 128 barcode or a QR for the sample ID', async () => {
    const bar = await codeSvg('2610-001', 'barcode')
    expect(bar).toContain('<svg')
    expect(bar).toContain('viewBox')
    expect(await codeSvg('2610-001', 'qr')).toContain('<svg')
    expect(bar).not.toEqual(await codeSvg('2610-002', 'barcode'))
  })

  it('print one sticker per tube, sized to the roll', async () => {
    const v = visit()
    const id = getVisit(db, v.visitId)!.visit.sample_id
    const h = await labelsHtml(db, v.visitId)
    expect(h).toContain('size: 50mm 25mm')
    expect(h.match(/class="lb /g)).toHaveLength(2) // default: 2 stickers
    expect(h).toContain(id)
    expect(h).toContain('Receipt Person')
    expect(h).toContain('lb bar')
    expect(h).not.toContain('CBC ESR') // tests are off by default
    setSettings(db, { labels: { enabled: true, widthMm: 40, heightMm: 30, copies: 3, code: 'qr', showAge: false, showTests: true, printerName: '', autoPrint: false } })
    const h2 = await labelsHtml(db, v.visitId)
    expect(h2).toContain('size: 40mm 30mm')
    expect(h2.match(/class="lb /g)).toHaveLength(3)
    expect(h2).toContain('lb qr')
    expect(h2).toContain('CBC ESR')
    expect((await labelsHtml(db, v.visitId, 1)).match(/class="lb /g)).toHaveLength(1)
  })
})
