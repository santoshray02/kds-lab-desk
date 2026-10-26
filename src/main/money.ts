import { audit, nowIso, type Db } from './db'
import { clock, localDate } from './patients'
import { getSettings } from './settings'

const round2 = (n: number) => Math.round(n * 100) / 100
const isSelf = (d: string) => d.trim().toLowerCase() === 'self'
const ym = (d: string) => d.slice(0, 7)

/* ------------------------------------------------------------ doctor commission */

export interface CommissionRow {
  doctor: string
  /** the rate now; visits registered earlier keep the rate they had */
  pct: number
  visits: number
  billed: number
  /** money actually received in the month on these doctors' visits */
  collected: number
  earned: number
  paid: number
  /** earned minus paid for this month */
  balance: number
  /** earned minus paid over all months */
  balanceAll: number
}

export interface Payout { id: number; doctor: string; month: string; amount: number; paidAt: string; note: string }

/** Doctors and their rates, most used first. "Self" is never a doctor who earns commission. */
export function doctorRates(db: Db): { doctor: string; pct: number; uses: number }[] {
  return db.all<{ name: string; commission_pct: number; uses: number }>('SELECT name, commission_pct, uses FROM doctors ORDER BY uses DESC, name')
    .filter((d) => !isSelf(d.name))
    .map((d) => ({ doctor: d.name, pct: d.commission_pct, uses: d.uses }))
}

export function setDoctorCommission(db: Db, doctor: string, pct: number, actor = ''): void {
  const name = doctor.trim()
  if (!name || isSelf(name)) throw new Error('"Self" does not earn commission.')
  if (!(pct >= 0 && pct <= 100)) throw new Error('The rate must be between 0 and 100 per cent.')
  const rate = round2(pct)
  db.tx(() => {
    db.run('INSERT INTO doctors(name, uses, last_used, commission_pct) VALUES(?,0,NULL,?) ON CONFLICT(name) DO UPDATE SET commission_pct = excluded.commission_pct', name, rate)
    // visits registered before the rate existed have no saved rate; they follow the doctor's rate
    audit(db, 'commission.rate', 'doctors', null, `${name}: ${rate}%`, actor)
  })
}

interface Earn { doctor: string; visits: number; billed: number; collected: number; earned: number }

/** Earned commission per doctor for the visits dated in `month` (YYYY-MM) or, with no month, for all time. */
function earnings(db: Db, month: string | null): Map<string, Earn> {
  const basis = getSettings(db).money.commissionBasis
  const out = new Map<string, Earn>()
  const get = (doc: string) => {
    const k = doc.toLowerCase()
    if (!out.has(k)) out.set(k, { doctor: doc, visits: 0, billed: 0, collected: 0, earned: 0 })
    return out.get(k)!
  }
  const rate = 'COALESCE(v.commission_pct, d.commission_pct, 0)'
  const visitFilter = "v.cancelled = 0 AND v.source IN ('app','demo') AND lower(v.doctor) <> 'self'"
  const byBill = db.all<any>(
    `SELECT v.doctor, COUNT(*) n, SUM(v.total) billed, SUM(v.total * ${rate} / 100.0) earned
     FROM visits v LEFT JOIN doctors d ON d.name = v.doctor COLLATE NOCASE
     WHERE ${visitFilter} ${month ? 'AND substr(v.visit_date, 1, 7) = ?' : ''} GROUP BY v.doctor COLLATE NOCASE`,
    ...(month ? [month] : [])
  )
  for (const r of byBill) {
    const e = get(r.doctor)
    e.visits += r.n
    e.billed += r.billed ?? 0
    if (basis === 'billed') e.earned += r.earned ?? 0
  }
  const byCash = db.all<any>(
    `SELECT v.doctor, SUM(y.amount) collected, SUM(y.amount * ${rate} / 100.0) earned
     FROM payments y JOIN visits v ON v.id = y.visit_id LEFT JOIN doctors d ON d.name = v.doctor COLLATE NOCASE
     WHERE ${visitFilter} ${month ? "AND substr(date(y.paid_at, 'localtime'), 1, 7) = ?" : ''} GROUP BY v.doctor COLLATE NOCASE`,
    ...(month ? [month] : [])
  )
  for (const r of byCash) {
    const e = get(r.doctor)
    e.collected += r.collected ?? 0
    if (basis === 'collected') e.earned += r.earned ?? 0
  }
  return out
}

export function commissionReport(db: Db, month: string = ym(localDate(clock.now()))): { month: string; basis: 'billed' | 'collected'; rows: CommissionRow[]; totals: { earned: number; paid: number; balance: number; balanceAll: number } } {
  const basis = getSettings(db).money.commissionBasis
  const cur = earnings(db, month)
  const all = earnings(db, null)
  const rates = new Map(doctorRates(db).map((d) => [d.doctor.toLowerCase(), d.pct]))
  const paidMonth = new Map(db.all<any>('SELECT doctor, SUM(amount) s FROM doctor_payouts WHERE month = ? GROUP BY doctor COLLATE NOCASE', month).map((r) => [r.doctor.toLowerCase(), r.s as number]))
  const paidAll = new Map(db.all<any>('SELECT doctor, SUM(amount) s FROM doctor_payouts GROUP BY doctor COLLATE NOCASE').map((r) => [r.doctor.toLowerCase(), r.s as number]))
  const names = new Map<string, string>()
  for (const e of [...cur.values(), ...all.values()]) names.set(e.doctor.toLowerCase(), e.doctor)
  for (const r of db.all<any>('SELECT doctor FROM doctor_payouts GROUP BY doctor COLLATE NOCASE')) names.set(r.doctor.toLowerCase(), names.get(r.doctor.toLowerCase()) ?? r.doctor)
  const rows = [...names.entries()].map(([k, doctor]): CommissionRow => {
    const c = cur.get(k)
    const paid = paidMonth.get(k) ?? 0
    const earned = round2(c?.earned ?? 0)
    return {
      doctor, pct: rates.get(k) ?? 0, visits: c?.visits ?? 0, billed: c?.billed ?? 0, collected: c?.collected ?? 0, earned, paid, balance: round2(earned - paid),
      balanceAll: round2((all.get(k)?.earned ?? 0) - (paidAll.get(k) ?? 0))
    }
  }).filter((r) => r.visits > 0 || r.paid > 0 || Math.abs(r.balanceAll) > 0.004).sort((a, b) => b.earned - a.earned || a.doctor.localeCompare(b.doctor))
  const sum = (f: (r: CommissionRow) => number) => round2(rows.reduce((a, r) => a + f(r), 0))
  return { month, basis, rows, totals: { earned: sum((r) => r.earned), paid: sum((r) => r.paid), balance: sum((r) => r.balance), balanceAll: sum((r) => r.balanceAll) } }
}

export function addPayout(db: Db, p: { doctor: string; month: string; amount: number; note?: string }, actor = ''): number {
  if (!/^\d{4}-\d{2}$/.test(p.month)) throw new Error('Choose the month')
  if (!(p.amount > 0)) throw new Error('Amount must be more than zero')
  if (!p.doctor.trim() || isSelf(p.doctor)) throw new Error('Choose a doctor')
  const id = db.run('INSERT INTO doctor_payouts(doctor, month, amount, paid_at, note) VALUES(?,?,?,?,?)', p.doctor.trim(), p.month, round2(p.amount), nowIso(), p.note ?? '').lastId
  audit(db, 'commission.payout', 'doctor_payouts', id, `${p.doctor} ${p.month} ${p.amount}`, actor)
  return id
}

export function listPayouts(db: Db, month: string): Payout[] {
  return db.all<any>('SELECT * FROM doctor_payouts WHERE month = ? ORDER BY id DESC', month)
    .map((r) => ({ id: r.id, doctor: r.doctor, month: r.month, amount: r.amount, paidAt: r.paid_at, note: r.note }))
}

export function deletePayout(db: Db, id: number, actor = ''): void {
  const r = db.get<any>('SELECT * FROM doctor_payouts WHERE id = ?', id)
  if (!r) return
  db.run('DELETE FROM doctor_payouts WHERE id = ?', id)
  audit(db, 'commission.payout_delete', 'doctor_payouts', id, `${r.doctor} ${r.month} ${r.amount}`, actor)
}

/* ------------------------------------------------------------ expenses and cash closing */

export interface Expense { id: number; date: string; category: string; amount: number; note: string }

export function addExpense(db: Db, e: { date?: string; category: string; amount: number; note?: string }, actor = ''): number {
  if (!(e.amount > 0)) throw new Error('Amount must be more than zero')
  const category = e.category.trim() || 'Other'
  const date = e.date || localDate(clock.now())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The date is not valid')
  const id = db.run('INSERT INTO expenses(date, category, amount, note, created_at) VALUES(?,?,?,?,?)', date, category, round2(e.amount), e.note ?? '', nowIso()).lastId
  audit(db, 'expense.add', 'expenses', id, `${category} ${e.amount}`, actor)
  return id
}

export function deleteExpense(db: Db, id: number, actor = ''): void {
  const r = db.get<any>('SELECT * FROM expenses WHERE id = ?', id)
  if (!r) return
  db.run('DELETE FROM expenses WHERE id = ?', id)
  audit(db, 'expense.delete', 'expenses', id, `${r.category} ${r.amount}`, actor)
}

export function listExpenses(db: Db, from: string, to: string): Expense[] {
  return db.all<any>('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', from, to)
    .map((r) => ({ id: r.id, date: r.date, category: r.category, amount: r.amount, note: r.note }))
}

export interface CashDay {
  date: string
  /** cash expected in the drawer when the day began */
  opening: number
  cash: number
  upi: number
  card: number
  other: number
  expenses: Expense[]
  expensesTotal: number
  /** opening + cash received - expenses */
  expected: number
  closing: { counted: number; difference: number; note: string; closedAt: string } | null
  /** money received minus expenses, for the whole month of this date */
  month: { received: number; expenses: number; net: number }
}

const dayPaid = (db: Db, from: string, to: string, method?: string): number =>
  db.get<{ s: number | null }>(
    `SELECT SUM(y.amount) s FROM payments y JOIN visits v ON v.id = y.visit_id
     WHERE v.cancelled = 0 AND date(y.paid_at, 'localtime') BETWEEN ? AND ? ${method ? 'AND y.method = ?' : ''}`,
    ...(method ? [from, to, method] : [from, to])
  )?.s ?? 0

const dayExpenses = (db: Db, from: string, to: string): number =>
  db.get<{ s: number | null }>('SELECT SUM(amount) s FROM expenses WHERE date BETWEEN ? AND ?', from, to)?.s ?? 0

const prevDay = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number)
  return localDate(new Date(y, m - 1, dd - 1))
}

export function cashDay(db: Db, date: string = localDate(clock.now())): CashDay {
  // opening = the last counted cash before this day, plus the cash that came and went on days nobody closed
  const last = db.get<{ date: string; counted: number }>('SELECT date, counted FROM cash_closings WHERE date < ? ORDER BY date DESC LIMIT 1', date)
  const gapFrom = last ? localDate(new Date(new Date(`${last.date}T00:00:00`).getTime() + 86_400_000)) : '0000-01-01'
  const gapTo = prevDay(date)
  const opening = round2((last?.counted ?? 0) + (gapFrom <= gapTo ? dayPaid(db, gapFrom, gapTo, 'cash') - dayExpenses(db, gapFrom, gapTo) : 0))
  const by = (m: string) => round2(dayPaid(db, date, date, m))
  const expenses = listExpenses(db, date, date)
  const expensesTotal = round2(expenses.reduce((a, e) => a + e.amount, 0))
  const cash = by('cash')
  const expected = round2(opening + cash - expensesTotal)
  const c = db.get<any>('SELECT * FROM cash_closings WHERE date = ?', date)
  const m0 = `${ym(date)}-01`
  const m1 = `${ym(date)}-31`
  const received = round2(dayPaid(db, m0, m1))
  const spent = round2(dayExpenses(db, m0, m1))
  return {
    date, opening, cash, upi: by('upi'), card: by('card'), other: by('other'), expenses, expensesTotal, expected,
    closing: c ? { counted: c.counted, difference: round2(c.counted - c.expected), note: c.note, closedAt: c.closed_at } : null,
    month: { received, expenses: spent, net: round2(received - spent) }
  }
}

/** Record the cash counted in the drawer at the end of the day. Closing again replaces the earlier count. */
export function closeDay(db: Db, date: string, counted: number, note = '', actor = ''): CashDay {
  if (!(counted >= 0)) throw new Error('Type the cash counted in the drawer')
  const d = cashDay(db, date)
  db.run(
    'INSERT INTO cash_closings(date, opening, expected, counted, note, closed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET opening = excluded.opening, expected = excluded.expected, counted = excluded.counted, note = excluded.note, closed_at = excluded.closed_at',
    date, d.opening, d.expected, round2(counted), note, nowIso()
  )
  audit(db, 'cash.close', 'cash_closings', null, `${date} expected ${d.expected} counted ${counted}`, actor)
  return cashDay(db, date)
}
