import { formatAge } from '../shared/age'
import type { Db } from './db'
import { commissionReport, listExpenses } from './money'
import { buildXlsx, type Cell, type Sheet } from './xlsx'

export const EXPORT_SHEETS = ['visits', 'payments', 'patients', 'expenses', 'commission'] as const
export type ExportSheet = (typeof EXPORT_SHEETS)[number]

export interface ExportOptions {
  from: string
  to: string
  sheets?: ExportSheet[]
}

const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other' }
const REPORT: Record<string, string> = { draft: 'Pending', approved: 'Reported', imported: 'Imported', none: 'No report' }

const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = []
  let [y, m] = from.slice(0, 7).split('-').map(Number)
  const [ey, em] = to.slice(0, 7).split('-').map(Number)
  while ((y < ey || (y === ey && m <= em)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

/** The tables the owner (or the accountant) can open in Excel. Cancelled visits are left out. */
export function exportSheets(db: Db, o: ExportOptions): Sheet[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.from) || !/^\d{4}-\d{2}-\d{2}$/.test(o.to) || o.from > o.to) throw new Error('Choose a valid date range')
  const want = new Set<ExportSheet>(o.sheets?.length ? o.sheets : [...EXPORT_SHEETS])
  const out: Sheet[] = []

  if (want.has('visits')) {
    const rows = db.all<any>(
      `SELECT v.*, p.name pname, p.title ptitle, p.sex psex, p.phone pphone, p.village pvillage,
         (SELECT group_concat(name, ', ') FROM visit_tests t WHERE t.visit_id = v.id) tests,
         (SELECT COALESCE(SUM(price), 0) FROM visit_tests t WHERE t.visit_id = v.id) gross,
         COALESCE((SELECT SUM(amount) FROM payments y WHERE y.visit_id = v.id), 0) paid,
         (SELECT status FROM reports r WHERE r.visit_id = v.id AND r.is_current = 1 ORDER BY version DESC LIMIT 1) rstatus
       FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.cancelled = 0 AND v.visit_date BETWEEN ? AND ? ORDER BY v.visit_date, v.id`, o.from, o.to
    )
    out.push({
      name: 'Visits and bills', header: true,
      rows: [
        ['Date', 'Sample ID', 'Patient', 'Age', 'Sex', 'Phone', 'Village', 'Referred by', 'Package', 'Tests', 'Tests total', 'Discount', 'Net bill', 'Paid', 'Due', 'Report'],
        ...rows.map((r): Cell[] => [
          r.visit_date, r.sample_id, `${r.ptitle ? r.ptitle + '. ' : ''}${r.pname}`, formatAge({ years: r.age_y, months: r.age_m, days: r.age_d }), r.psex === 'F' ? 'Female' : 'Male',
          r.pphone, r.pvillage, r.doctor, r.package_name || null, r.tests ?? '', r.gross, r.discount, r.total, r.paid, Math.max(0, r.total - r.paid), REPORT[r.rstatus ?? 'none'] ?? r.rstatus
        ])
      ]
    })
  }

  if (want.has('payments')) {
    const rows = db.all<any>(
      `SELECT date(y.paid_at, 'localtime') d, v.sample_id, p.name, y.amount, y.method, y.note
       FROM payments y JOIN visits v ON v.id = y.visit_id JOIN patients p ON p.id = v.patient_id
       WHERE v.cancelled = 0 AND date(y.paid_at, 'localtime') BETWEEN ? AND ? ORDER BY y.paid_at, y.id`, o.from, o.to
    )
    out.push({ name: 'Money received', header: true, rows: [['Date', 'Sample ID', 'Patient', 'Amount', 'Paid by', 'Note'], ...rows.map((r): Cell[] => [r.d, r.sample_id, r.name, r.amount, METHOD[r.method] ?? 'Cash', r.note || null])] })
  }

  if (want.has('patients')) {
    const rows = db.all<any>(
      `SELECT p.*, (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.cancelled = 0) n, (SELECT MAX(visit_date) FROM visits v WHERE v.patient_id = p.id AND v.cancelled = 0) last
       FROM patients p ORDER BY p.name COLLATE NOCASE`
    )
    out.push({ name: 'Patients', header: true, rows: [['Name', 'Sex', 'Phone', 'Village', 'Visits', 'Last visit'], ...rows.map((r): Cell[] => [`${r.title ? r.title + '. ' : ''}${r.name}`, r.sex === 'F' ? 'Female' : 'Male', r.phone, r.village, r.n, r.last])] })
  }

  if (want.has('expenses')) {
    out.push({ name: 'Expenses', header: true, rows: [['Date', 'Category', 'Amount', 'Note'], ...listExpenses(db, o.from, o.to).reverse().map((e): Cell[] => [e.date, e.category, e.amount, e.note || null])] })
  }

  if (want.has('commission')) {
    const rows: Cell[][] = [['Month', 'Doctor', 'Rate %', 'Visits', 'Billed', 'Money received', 'Commission earned', 'Paid to doctor', 'Balance']]
    for (const m of monthsBetween(o.from, o.to)) for (const r of commissionReport(db, m).rows) rows.push([m, r.doctor, r.pct, r.visits, r.billed, r.collected, r.earned, r.paid, r.balance])
    out.push({ name: 'Doctor commission', header: true, rows })
  }
  return out
}

export const exportXlsx = (db: Db, o: ExportOptions): Buffer => buildXlsx(exportSheets(db, o))
