import type { Db } from './db'
import { localDate, clock } from './patients'

export interface DayReport {
  date: string
  visits: { id: number; sampleId: string; name: string; doctor: string; tests: string; total: number; paidToday: number; due: number; reportStatus: string }[]
  patients: number
  billed: number
  /** money actually received on this date (includes later payments for older visits) */
  cashReceived: number
  dueOnDay: number
}

const localDay = "date(paid_at, 'localtime')"

export function dayReport(db: Db, date: string = localDate()): DayReport {
  const rows = db.all<any>(
    `SELECT v.id, v.sample_id, p.name, v.doctor, v.total,
       (SELECT group_concat(name, ', ') FROM visit_tests t WHERE t.visit_id = v.id) AS tests,
       COALESCE((SELECT SUM(amount) FROM payments y WHERE y.visit_id = v.id AND ${localDay} = ?), 0) AS paid_today,
       COALESCE((SELECT SUM(amount) FROM payments y WHERE y.visit_id = v.id), 0) AS paid_all,
       (SELECT status FROM reports r WHERE r.visit_id = v.id AND r.is_current = 1 LIMIT 1) AS rstatus
     FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.visit_date = ? AND v.cancelled = 0 ORDER BY v.id`,
    date, date
  )
  const cash = db.get<{ s: number | null }>(`SELECT SUM(y.amount) AS s FROM payments y JOIN visits cv ON cv.id = y.visit_id WHERE cv.cancelled = 0 AND date(y.paid_at, 'localtime') = ?`, date)?.s ?? 0
  const visits = rows.map((r) => ({
    id: r.id, sampleId: r.sample_id, name: r.name, doctor: r.doctor, tests: r.tests ?? '', total: r.total,
    paidToday: r.paid_today, due: Math.max(0, r.total - r.paid_all), reportStatus: r.rstatus ?? 'none'
  }))
  return {
    date, visits, patients: new Set(rows.map((r) => r.name)).size,
    billed: visits.reduce((a, v) => a + v.total, 0), cashReceived: cash, dueOnDay: visits.reduce((a, v) => a + v.due, 0)
  }
}

export interface DueRow { visitId: number; sampleId: string; date: string; name: string; phone: string; total: number; paid: number; due: number }

export function duesReport(db: Db): { rows: DueRow[]; total: number } {
  const rows = db.all<any>(
    `SELECT v.id, v.sample_id, v.visit_date, p.name, p.phone, v.total,
       COALESCE((SELECT SUM(amount) FROM payments y WHERE y.visit_id = v.id), 0) AS paid
     FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.cancelled = 0 AND v.source = 'app'
     ORDER BY v.visit_date DESC`
  ).filter((r) => r.total - r.paid > 0.009)
  const out = rows.map((r): DueRow => ({ visitId: r.id, sampleId: r.sample_id, date: r.visit_date, name: r.name, phone: r.phone, total: r.total, paid: r.paid, due: r.total - r.paid }))
  return { rows: out, total: out.reduce((a, r) => a + r.due, 0) }
}

export interface DoctorMonthRow { doctor: string; visits: number; patients: number; billed: number }

export function doctorMonthly(db: Db, ym: string = localDate(clock.now()).slice(0, 7)): DoctorMonthRow[] {
  return db.all<any>(
    `SELECT doctor, COUNT(*) AS visits, COUNT(DISTINCT patient_id) AS patients, SUM(total) AS billed
     FROM visits WHERE substr(visit_date, 1, 7) = ? AND cancelled = 0 GROUP BY doctor COLLATE NOCASE ORDER BY visits DESC, doctor`,
    ym
  ).map((r) => ({ doctor: r.doctor, visits: r.visits, patients: r.patients, billed: r.billed ?? 0 }))
}

export interface Pending {
  unreported: { visitId: number; sampleId: string; date: string; name: string; tests: string; ageDays: number }[]
  sentOut: { visitTestId: number; visitId: number; sampleId: string; name: string; test: string; sentTo: string | null; sentAt: string | null; date: string }[]
}

export function pendingReport(db: Db): Pending {
  const today = clock.now()
  const unreported = db.all<any>(
    `SELECT v.id, v.sample_id, v.visit_date, p.name,
       (SELECT group_concat(name, ', ') FROM visit_tests t WHERE t.visit_id = v.id AND t.sent_out = 0) AS tests
     FROM visits v JOIN patients p ON p.id = v.patient_id JOIN reports r ON r.visit_id = v.id
     WHERE v.cancelled = 0 AND r.is_current = 1 AND r.status = 'draft' ORDER BY v.visit_date, v.id`
  ).map((r) => {
    const [y, m, d] = r.visit_date.split('-').map(Number)
    return { visitId: r.id, sampleId: r.sample_id, date: r.visit_date, name: r.name, tests: r.tests ?? '', ageDays: Math.floor((today.getTime() - new Date(y, m - 1, d).getTime()) / 86400000) }
  })
  const sentOut = db.all<any>(
    `SELECT t.id, t.visit_id, v.sample_id, v.visit_date, p.name, t.name AS test, t.sent_to, t.sent_at
     FROM visit_tests t JOIN visits v ON v.id = t.visit_id JOIN patients p ON p.id = v.patient_id
     WHERE t.sent_out = 1 AND t.received_at IS NULL AND v.cancelled = 0 ORDER BY v.visit_date, t.id`
  ).map((r) => ({ visitTestId: r.id, visitId: r.visit_id, sampleId: r.sample_id, name: r.name, test: r.test, sentTo: r.sent_to, sentAt: r.sent_at, date: r.visit_date }))
  return { unreported, sentOut }
}

export interface Insights {
  days: { date: string; billed: number; cash: number; visits: number }[]
  totals: { billed: number; cash: number; visits: number; patients: number; due: number; avgBill: number; turnaroundHours: number | null }
  previous: { billed: number; cash: number; visits: number; patients: number }
  topTests: { name: string; count: number; revenue: number }[]
  doctors: { doctor: string; visits: number }[]
  weekday: number[]
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** The numbers behind the Overview charts for the last `n` days (today included), with the n days before for comparison. */
export function insights(db: Db, n = 30): Insights {
  n = Math.max(7, Math.min(366, Math.round(n)))
  const end = clock.now()
  const from = localDate(addDays(end, -(n - 1)))
  const to = localDate(end)
  const pFrom = localDate(addDays(end, -(2 * n - 1)))
  const pTo = localDate(addDays(end, -n))

  const billedBy = new Map(db.all<any>(`SELECT visit_date d, SUM(total) b, COUNT(*) c FROM visits WHERE cancelled = 0 AND source IN ('app','demo') AND visit_date BETWEEN ? AND ? GROUP BY visit_date`, from, to).map((r) => [r.d, r]))
  const cashBy = new Map(db.all<any>(`SELECT date(y.paid_at, 'localtime') d, SUM(y.amount) s FROM payments y JOIN visits cv ON cv.id = y.visit_id WHERE cv.cancelled = 0 AND date(y.paid_at, 'localtime') BETWEEN ? AND ? GROUP BY d`, from, to).map((r) => [r.d, r.s]))
  const days = Array.from({ length: n }, (_, i) => {
    const date = localDate(addDays(end, -(n - 1 - i)))
    const b = billedBy.get(date)
    return { date, billed: b?.b ?? 0, cash: cashBy.get(date) ?? 0, visits: b?.c ?? 0 }
  })
  const span = (a: string, b: string) => {
    const v = db.get<any>(`SELECT COALESCE(SUM(total),0) billed, COUNT(*) visits, COUNT(DISTINCT patient_id) patients FROM visits WHERE cancelled = 0 AND source IN ('app','demo') AND visit_date BETWEEN ? AND ?`, a, b)!
    const c = db.get<any>(`SELECT COALESCE(SUM(y.amount),0) s FROM payments y JOIN visits cv ON cv.id = y.visit_id WHERE cv.cancelled = 0 AND date(y.paid_at, 'localtime') BETWEEN ? AND ?`, a, b)!.s
    return { billed: v.billed as number, cash: c as number, visits: v.visits as number, patients: v.patients as number }
  }
  const cur = span(from, to)
  const due = db.get<any>(
    `SELECT COALESCE(SUM(MAX(v.total - COALESCE((SELECT SUM(amount) FROM payments y WHERE y.visit_id = v.id), 0), 0)), 0) s
     FROM visits v WHERE v.cancelled = 0 AND v.source IN ('app','demo') AND v.visit_date BETWEEN ? AND ?`, from, to
  )!.s as number
  const turn = db.get<any>(
    `SELECT AVG((julianday(r.approved_at) - julianday(v.created_at)) * 24) h FROM reports r JOIN visits v ON v.id = r.visit_id
     WHERE r.version = 1 AND r.approved_at IS NOT NULL AND v.source IN ('app','demo') AND v.visit_date BETWEEN ? AND ?`, from, to
  )?.h as number | null
  const topTests = db.all<any>(
    `SELECT replace(t.name, ' — sent out', '') name, COUNT(*) c, SUM(t.price) rev FROM visit_tests t JOIN visits v ON v.id = t.visit_id
     WHERE v.cancelled = 0 AND v.source IN ('app','demo') AND v.visit_date BETWEEN ? AND ? GROUP BY t.panel_code ORDER BY c DESC, rev DESC LIMIT 8`, from, to
  ).map((r) => ({ name: r.name, count: r.c, revenue: r.rev ?? 0 }))
  const doctors = db.all<any>(
    `SELECT doctor, COUNT(*) c FROM visits WHERE cancelled = 0 AND source IN ('app','demo') AND visit_date BETWEEN ? AND ? GROUP BY doctor COLLATE NOCASE ORDER BY c DESC LIMIT 8`, from, to
  ).map((r) => ({ doctor: r.doctor, visits: r.c }))
  const weekday = [0, 0, 0, 0, 0, 0, 0]
  for (const r of db.all<any>(`SELECT CAST(strftime('%w', visit_date) AS INTEGER) w, COUNT(*) c FROM visits WHERE cancelled = 0 AND source IN ('app','demo') AND visit_date BETWEEN ? AND ? GROUP BY w`, from, to)) weekday[r.w] = r.c
  void pTo
  return {
    days, topTests, doctors, weekday, previous: span(pFrom, pTo),
    totals: { ...cur, due, avgBill: cur.visits ? cur.billed / cur.visits : 0, turnaroundHours: turn == null ? null : Math.round(turn * 10) / 10 }
  }
}
