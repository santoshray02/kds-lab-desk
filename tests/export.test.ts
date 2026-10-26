import { beforeEach, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { addPayment, createVisit } from '../src/main/visits'
import { addExpense, setDoctorCommission } from '../src/main/money'
import { colName, buildXlsx } from '../src/main/xlsx'
import { exportSheets, exportXlsx } from '../src/main/exporter'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  seedMaster(db)
  clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
})

describe('xlsx writer', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
  })

  it('writes a valid package with escaped text, numbers, and safe sheet names', () => {
    const buf = buildXlsx([
      { name: 'Bills: <1>', header: true, rows: [['Name', 'Amount'], ['A & B "quoted" <x>', 12.5], [null, 3], ['control\u0001char', 0]] },
      { name: 'bills  <1>', rows: [[1]] }
    ])
    const z = unzipSync(buf)
    expect(Object.keys(z).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
    const wb = strFromU8(z['xl/workbook.xml'])
    expect(wb).toContain('name="Bills  &lt;1&gt;"')
    expect(wb).toContain('name="bills  &lt;1&gt; 2"') // second sheet with the same name gets a number
    const s1 = strFromU8(z['xl/worksheets/sheet1.xml'])
    expect(s1).toContain('A &amp; B &quot;quoted&quot; &lt;x&gt;')
    expect(s1).toContain('<v>12.5</v>')
    expect(s1).toContain('controlchar')
    expect(s1).toContain('<autoFilter ref="A1:B4"/>')
    expect(s1).toContain('state="frozen"')
  })
})

describe('export of the owner\'s records', () => {
  function seed() {
    setDoctorCommission(db, 'Dr. Rao', 10)
    const a = createVisit(db, { patient: { name: 'Ram Kumar', title: 'Mr', sex: 'M', phone: '9800000001', village: 'Testpur' }, age: { years: 40, months: 0, days: 0 }, doctor: 'Dr. Rao', panelCodes: ['CBC', 'ESR'], discount: 20, paid: 100, payMethod: 'upi', package: 'Fever panel' })
    addPayment(db, a.visitId, 40, 'later', 'cash')
    const b = createVisit(db, { patient: { name: 'Sita Devi', title: 'Mrs', sex: 'F', phone: '', village: 'Rampur' }, age: { years: 0, months: 8, days: 0 }, doctor: 'Self', panelCodes: ['CBC'] })
    db.run('UPDATE visits SET cancelled = 1 WHERE id = ?', b.visitId)
    addExpense(db, { category: 'Rent', amount: 500, note: 'October' })
  }

  it('lists bills with totals, leaves out cancelled visits, and keeps to the date range', () => {
    seed()
    const sheets = exportSheets(db, { from: '2026-10-01', to: '2026-10-31' })
    expect(sheets.map((s) => s.name)).toEqual(['Visits and bills', 'Money received', 'Patients', 'Expenses', 'Doctor commission'])
    const visits = sheets[0].rows
    expect(visits).toHaveLength(2) // heading + one visit (the cancelled one is left out)
    const row = Object.fromEntries((visits[0] as string[]).map((h, i) => [h, visits[1][i]]))
    expect(row).toMatchObject({ Date: '2026-10-25', Patient: 'Mr. Ram Kumar', Age: expect.stringContaining('40'), 'Referred by': 'Dr. Rao', Package: 'Fever panel', 'Tests total': 260, Discount: 20, 'Net bill': 240, Paid: 140, Due: 100, Report: 'Pending' })
    expect(sheets[1].rows.slice(1).map((r) => [r[3], r[4]])).toEqual([[100, 'UPI'], [40, 'Cash']])
    expect(sheets[3].rows[1]).toEqual(['2026-10-25', 'Rent', 500, 'October'])
    const com = sheets[4].rows[1]
    expect(com.slice(0, 2)).toEqual(['2026-10', 'Dr. Rao'])
    expect(com[6]).toBe(24) // 10% of 240
    expect(exportSheets(db, { from: '2026-11-01', to: '2026-11-30' })[0].rows).toHaveLength(1)
  })

  it('exports only the sheets asked for, and refuses a bad range', () => {
    seed()
    expect(exportSheets(db, { from: '2026-10-01', to: '2026-10-31', sheets: ['expenses'] }).map((s) => s.name)).toEqual(['Expenses'])
    expect(() => exportSheets(db, { from: '2026-10-31', to: '2026-10-01' })).toThrow(/date range/)
    expect(() => exportSheets(db, { from: 'x', to: 'y' })).toThrow(/date range/)
  })

  it('produces a file when the lab has no records at all', () => {
    const z = unzipSync(exportXlsx(db, { from: '2026-10-01', to: '2026-10-31' }))
    expect(Object.keys(z).length).toBeGreaterThan(5)
  })

  it('writes a sample file for a manual check when KDS_SAMPLE_DIR is set', () => {
    seed()
    const dir = process.env.KDS_SAMPLE_DIR
    if (!dir) return
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'sample-export.xlsx'), exportXlsx(db, { from: '2026-10-01', to: '2026-10-31' }))
  })
})
