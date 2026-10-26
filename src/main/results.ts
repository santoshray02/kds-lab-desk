import { randomBytes, randomInt } from 'node:crypto'
import { formatAge, ageToDays, sexLabel } from '../shared/age'
import { allSignatures, resolveResults, type Resolved } from '../shared/checks'
import { SECTION_ORDER } from '../shared/masterData'
import type { ReportData, ReportPanel, ReportRow, ReportSection } from '../shared/reportHtml'
import type { Issue, PanelDef, ResultMap, Sex } from '../shared/types'
import { audit, enqueue, nowIso, type Db } from './db'
import { vitalsLine, type Vitals } from '../shared/vitals'
import { loadMaster } from './master'
import { vitalsOf } from './visits'
import { getSettings, checkApprover, checkPin, hasPin } from './settings'

export class AppError extends Error {
  constructor(public code: string, message: string, public data?: unknown) {
    super(message)
  }
}

export interface DuplicateHit {
  panelCode: string
  sampleId: string
  patientName: string
  date: string
}

interface ReportRowDb {
  id: number
  visit_id: number
  version: number
  status: 'draft' | 'approved' | 'imported'
  is_current: number
}

export function visitPanels(db: Db, visitId: number): PanelDef[] {
  const codes = new Set(db.all<{ panel_code: string }>('SELECT panel_code FROM visit_tests WHERE visit_id = ? AND sent_out = 0', visitId).map((r) => r.panel_code))
  return loadMaster(db, { includeInactive: true }).filter((p) => codes.has(p.code))
}

function visitContext(db: Db, visitId: number) {
  const v = db.get<any>('SELECT v.*, p.sex AS psex, p.name AS pname, p.title AS ptitle, p.phone AS pphone, p.id AS pid FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?', visitId)
  if (!v) throw new AppError('NOT_FOUND', 'Visit not found')
  const age = { years: v.age_y, months: v.age_m, days: v.age_d }
  return { v, sex: v.psex as Sex, age, ageDays: ageToDays(age) }
}

/** The report a user works with for a visit: the open draft if any, else the current one. */
export function activeReport(db: Db, visitId: number): ReportRowDb | undefined {
  return (
    db.get<ReportRowDb>("SELECT * FROM reports WHERE visit_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1", visitId) ??
    db.get<ReportRowDb>('SELECT * FROM reports WHERE visit_id = ? AND is_current = 1 ORDER BY version DESC LIMIT 1', visitId)
  )
}

function storedTyped(db: Db, reportId: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of db.all<{ param_code: string; value: string; auto: number }>('SELECT param_code, value, auto FROM report_results WHERE report_id = ? AND param_code IS NOT NULL', reportId)) {
    if (!r.auto) out[r.param_code] = r.value
  }
  return out
}

function writeSnapshot(db: Db, reportId: number, panels: PanelDef[], res: Resolved) {
  db.run('DELETE FROM report_results WHERE report_id = ?', reportId)
  db.run('DELETE FROM result_signatures WHERE report_id = ?', reportId)
  for (const row of res.rows) {
    if (row.value === '') continue
    const { panel, param, eval: ev } = row
    db.run(
      `INSERT INTO report_results(report_id, panel_code, panel_name, section, param_code, name, grp, type, value, unit, range_text, flag, critical, auto, sort)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      reportId, panel.code, panel.name, panel.section, param.code, param.name, param.group, param.type, row.value, param.unit,
      ev.rangeText, ev.flag, ev.critical ? 1 : 0, row.auto ? 1 : 0, panel.sort * 1000 + param.sort
    )
  }
  for (const s of allSignatures(panels, res.values)) {
    db.run('INSERT INTO result_signatures(report_id, panel_code, signature) VALUES(?,?,?)', reportId, s.panelCode, s.signature)
  }
}

export function findDuplicates(db: Db, reportId: number): DuplicateHit[] {
  const rep = db.get<ReportRowDb>('SELECT * FROM reports WHERE id = ?', reportId)
  if (!rep) return []
  const pid = db.get<{ patient_id: number }>('SELECT patient_id FROM visits WHERE id = ?', rep.visit_id)!.patient_id
  return db.all<any>(
    `SELECT s.panel_code, v.sample_id, p.name, v.visit_date
     FROM result_signatures s JOIN result_signatures mine ON mine.signature = s.signature AND mine.report_id = ?
       JOIN reports r ON r.id = s.report_id JOIN visits v ON v.id = r.visit_id JOIN patients p ON p.id = v.patient_id
     WHERE s.report_id != ? AND v.patient_id != ? AND r.is_current = 1 AND r.status IN ('approved','imported') AND v.cancelled = 0
     ORDER BY v.visit_date DESC LIMIT 10`,
    reportId, reportId, pid
  ).map((r) => ({ panelCode: r.panel_code, sampleId: r.sample_id, patientName: r.name, date: r.visit_date }))
}

export function previousValues(db: Db, patientId: number, excludeVisitId: number): Record<string, { value: string; date: string; sampleId: string; flag: string | null }> {
  const out: Record<string, { value: string; date: string; sampleId: string; flag: string | null }> = {}
  const rows = db.all<any>(
    `SELECT rr.param_code, rr.value, rr.flag, v.visit_date, v.sample_id FROM report_results rr
     JOIN reports r ON r.id = rr.report_id JOIN visits v ON v.id = r.visit_id
     WHERE v.patient_id = ? AND v.id != ? AND r.is_current = 1 AND r.status IN ('approved','imported') AND rr.param_code IS NOT NULL
     ORDER BY v.visit_date DESC, v.id DESC`,
    patientId, excludeVisitId
  )
  for (const r of rows) if (!out[r.param_code]) out[r.param_code] = { value: r.value, date: r.visit_date, sampleId: r.sample_id, flag: r.flag }
  return out
}

export interface EntryState {
  reportId: number | null
  status: 'draft' | 'approved' | 'imported' | 'none'
  version: number
  visit: { id: number; sampleId: string; date: string; doctor: string; patientId: number; patientName: string; title: string; sex: Sex; age: { years: number; months: number; days: number } }
  panels: PanelDef[]
  typed: Record<string, string>
  values: ResultMap
  issues: Issue[]
  duplicates: DuplicateHit[]
  previous: Record<string, { value: string; date: string; sampleId: string; flag: string | null }>
  hasCorrectionDraft: boolean
  correctionReason: string
  phone: string
  vitals: Vitals
  /** vitals can still be changed (the report is not approved yet) */
  vitalsEditable: boolean
  sentOut: { id: number; name: string; sentTo: string | null; sentAt: string | null; receivedAt: string | null; attachment: string | null }[]
}

export function getEntry(db: Db, visitId: number): EntryState {
  const { v, sex, ageDays } = visitContext(db, visitId)
  const rep = activeReport(db, visitId)
  const panels = visitPanels(db, visitId)
  const typed = rep ? storedTyped(db, rep.id) : {}
  const res = resolveResults(panels, typed, sex, ageDays, { previous: previousValues(db, v.pid, visitId), refDate: v.visit_date })
  const sentOut = db.all<any>('SELECT * FROM visit_tests WHERE visit_id = ? AND sent_out = 1 ORDER BY id', visitId).map((t) => ({
    id: t.id, name: t.name, sentTo: t.sent_to, sentAt: t.sent_at, receivedAt: t.received_at, attachment: t.attachment
  }))
  return {
    reportId: rep?.id ?? null,
    status: rep?.status ?? 'none',
    version: rep?.version ?? 0,
    visit: { id: v.id, sampleId: v.sample_id, date: v.visit_date, doctor: v.doctor, patientId: v.pid, patientName: v.pname, title: v.ptitle, sex, age: { years: v.age_y, months: v.age_m, days: v.age_d } },
    panels,
    typed,
    values: res.values,
    issues: res.issues,
    duplicates: rep ? findDuplicates(db, rep.id) : [],
    previous: previousValues(db, v.pid, visitId),
    hasCorrectionDraft: !!rep && rep.status === 'draft' && rep.version > 1,
    correctionReason: rep && rep.status === 'draft' && rep.version > 1 ? db.get<{ reason: string | null }>('SELECT reason FROM reports WHERE id = ?', rep.id)?.reason ?? '' : '',
    phone: v.pphone ?? '',
    vitals: vitalsOf(v),
    vitalsEditable: !rep || rep.status === 'draft',
    sentOut
  }
}

export function saveDraft(db: Db, reportId: number, typed: Record<string, string>): { issues: Issue[]; duplicates: DuplicateHit[]; values: ResultMap } {
  const rep = db.get<ReportRowDb>('SELECT * FROM reports WHERE id = ?', reportId)
  if (!rep) throw new AppError('NOT_FOUND', 'Report not found')
  if (rep.status !== 'draft') throw new AppError('LOCKED', 'This report is approved and locked. Use "Correct report" to change it.')
  const { sex, ageDays } = visitContext(db, rep.visit_id)
  const panels = visitPanels(db, rep.visit_id)
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(typed)) if (typeof v === 'string' && v.trim() !== '') clean[k] = v.trim()
  const { v } = visitContext(db, rep.visit_id)
  const res = resolveResults(panels, clean, sex, ageDays, { previous: previousValues(db, v.pid, rep.visit_id), refDate: v.visit_date })
  db.tx(() => writeSnapshot(db, reportId, panels, res))
  return { issues: res.issues, duplicates: findDuplicates(db, reportId), values: res.values }
}

function shareCode(db: Db): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (;;) {
    const bytes = randomBytes(6)
    let c = ''
    for (const b of bytes) c += alphabet[b % alphabet.length]
    if (!db.get('SELECT 1 AS x FROM reports WHERE share_code = ?', c)) return c
  }
}

export function approveReport(
  db: Db,
  reportId: number,
  opts: { pin?: string; dupReason?: string; actor?: string } = {}
): { reportId: number; visitId: number; shareCode: string } {
  const rep = db.get<ReportRowDb>('SELECT * FROM reports WHERE id = ?', reportId)
  if (!rep) throw new AppError('NOT_FOUND', 'Report not found')
  if (rep.status !== 'draft') throw new AppError('LOCKED', 'Report is already approved')
  if (!checkApprover(db, opts.pin)) throw new AppError('PIN', 'Wrong PIN')

  const { v, sex, ageDays } = visitContext(db, rep.visit_id)
  const panels = visitPanels(db, rep.visit_id)
  const typed = storedTyped(db, reportId)
  const res = resolveResults(panels, typed, sex, ageDays, { previous: previousValues(db, v.pid, rep.visit_id), refDate: v.visit_date })

  const errors = res.issues.filter((i) => i.severity === 'error')
  if (errors.length) throw new AppError('INVALID', 'Fix the marked results first', errors)
  const empty = panels.filter((p) => !p.params.some((q) => res.values[q.code]))
  if (empty.length) throw new AppError('EMPTY', `No results typed for: ${empty.map((p) => p.name).join(', ')}. Type them, or remove the test from the visit.`, empty.map((p) => p.name))
  if (!panels.length) throw new AppError('EMPTY', 'There are no in-house tests to report on this visit')

  db.tx(() => {
    writeSnapshot(db, reportId, panels, res)
    const dups = findDuplicates(db, reportId)
    if (dups.length && !(opts.dupReason && opts.dupReason.trim().length >= 3)) {
      throw new AppError('DUPLICATE', 'These results are identical to another patient’s report', dups)
    }
    const phone: string = v.pphone || ''
    const pin = phone.length >= 4 ? phone.slice(-4) : String(randomInt(1000, 10000))
    const now = nowIso()
    const prev = db.get<{ id: number }>('SELECT id FROM reports WHERE visit_id = ? AND is_current = 1 AND status = ? AND id != ?', rep.visit_id, 'approved', reportId)
    if (prev) db.run('UPDATE reports SET is_current = 0, superseded_at = ? WHERE id = ?', now, prev.id)
    const code = db.get<{ share_code: string | null }>('SELECT share_code FROM reports WHERE visit_id = ? AND share_code IS NOT NULL LIMIT 1', rep.visit_id)?.share_code ?? shareCode(db)
    db.run(
      "UPDATE reports SET status = 'approved', is_current = 1, approved_at = ?, approved_by = ?, dup_reason = ?, share_code = ?, share_pin = ?, pdf_path = NULL WHERE id = ?",
      now, opts.actor ?? '', dups.length ? opts.dupReason!.trim() : null, code, pin, reportId
    )
    audit(db, 'report.approve', 'reports', reportId, JSON.stringify({ version: rep.version, duplicate: dups.length > 0, reason: opts.dupReason ?? '' }), opts.actor)
    enqueue(db, 'report', reportId)
  })
  const code = db.get<{ share_code: string }>('SELECT share_code FROM reports WHERE id = ?', reportId)!.share_code
  return { reportId, visitId: rep.visit_id, shareCode: code }
}

/** Open a new draft version of an approved report. Needs the PIN (if one is set) and a reason. */
export function startCorrection(db: Db, visitId: number, opts: { pin?: string; reason: string; actor?: string }): number {
  const reason = (opts.reason ?? '').trim()
  if (reason.length < 3) throw new AppError('REASON', 'Please write the reason for the correction')
  if (hasPin(db, 'owner') && !checkPin(db, opts.pin, 'owner')) throw new AppError('PIN', 'Wrong PIN')
  const existing = db.get<ReportRowDb>("SELECT * FROM reports WHERE visit_id = ? AND status = 'draft' AND version > 1", visitId)
  if (existing) return existing.id
  const cur = db.get<ReportRowDb>("SELECT * FROM reports WHERE visit_id = ? AND is_current = 1 AND status = 'approved'", visitId)
  if (!cur) throw new AppError('NOT_APPROVED', 'Only an approved report can be corrected')
  return db.tx(() => {
    const max = db.get<{ v: number }>('SELECT MAX(version) AS v FROM reports WHERE visit_id = ?', visitId)!.v
    const id = db.run('INSERT INTO reports(visit_id, version, status, is_current, created_at, reason) VALUES(?,?,?,?,?,?)', visitId, max + 1, 'draft', 0, nowIso(), reason).lastId
    saveDraft(db, id, storedTyped(db, cur.id))
    audit(db, 'report.correction_started', 'reports', id, reason, opts.actor)
    return id
  })
}

export function discardCorrection(db: Db, reportId: number): void {
  const rep = db.get<ReportRowDb>('SELECT * FROM reports WHERE id = ?', reportId)
  if (!rep || rep.status !== 'draft' || rep.version <= 1) throw new AppError('INVALID', 'Not a correction draft')
  db.run('DELETE FROM reports WHERE id = ?', reportId)
  audit(db, 'report.correction_discarded', 'reports', reportId)
}

export function listVersions(db: Db, visitId: number) {
  return db.all<any>('SELECT id, version, status, is_current, approved_at, approved_by, reason, dup_reason, superseded_at FROM reports WHERE visit_id = ? ORDER BY version DESC', visitId)
}

/** Everything the print template needs, from stored (snapshot) rows. QR is added by the caller. */
export function buildReportData(db: Db, reportId: number): ReportData {
  const rep = db.get<any>('SELECT * FROM reports WHERE id = ?', reportId)
  if (!rep) throw new AppError('NOT_FOUND', 'Report not found')
  const s = getSettings(db)
  const v = db.get<any>('SELECT v.*, p.name AS pname, p.title AS ptitle, p.sex AS psex FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?', rep.visit_id)!
  const rows = db.all<any>('SELECT * FROM report_results WHERE report_id = ? ORDER BY sort, id', reportId)
  const master = loadMaster(db, { includeInactive: true })
  const secRank = (t: string) => { const i = SECTION_ORDER.indexOf(t); return i < 0 ? 99 : i }

  const byPanel = new Map<string, { code: string | null; name: string; section: string; first: number; rows: ReportRow[] }>()
  for (const r of rows) {
    const key = `${r.section}|${r.panel_name}`
    if (!byPanel.has(key)) byPanel.set(key, { code: r.panel_code, name: r.panel_name, section: r.section, first: r.sort, rows: [] })
    byPanel.get(key)!.rows.push({
      name: r.name, group: r.grp, type: r.type, value: r.value, unit: r.unit, range: r.range_text, flag: r.flag, critical: !!r.critical, paramCode: r.param_code
    })
  }
  if (s.reportTrends && rep.status !== 'imported') {
    const hist = db.all<any>(
      `SELECT rr.param_code, rr.value, v.visit_date FROM report_results rr
       JOIN reports r ON r.id = rr.report_id JOIN visits v ON v.id = r.visit_id
       WHERE v.patient_id = ? AND v.id != ? AND v.visit_date <= ? AND r.is_current = 1 AND r.status IN ('approved','imported')
         AND rr.param_code IS NOT NULL AND rr.type = 'numeric'
       ORDER BY v.visit_date DESC, v.id DESC`,
      v.patient_id, v.id, v.visit_date
    )
    const byCode = new Map<string, { v: number; d: string }[]>()
    for (const h of hist) {
      const n = parseFloat(h.value)
      if (!isFinite(n)) continue
      const list = byCode.get(h.param_code) ?? []
      if (list.length < 5) list.push({ v: n, d: h.visit_date })
      byCode.set(h.param_code, list)
    }
    for (const b of byPanel.values()) for (const r of b.rows) {
      const t = r.paramCode ? byCode.get(r.paramCode) : undefined
      if (t?.length) r.trend = [...t].reverse()
    }
  }
  const sections = new Map<string, ReportSection>()
  for (const p of [...byPanel.values()].sort((a, b) => a.first - b.first)) {
    if (!sections.has(p.section)) sections.set(p.section, { title: p.section, panels: [] })
    sections.get(p.section)!.panels.push({ code: p.code, name: p.name, rows: p.rows } as ReportPanel)
  }
  const sentOut = db.all<any>('SELECT * FROM visit_tests WHERE visit_id = ? AND sent_out = 1', rep.visit_id).map((t) => ({
    name: t.name.replace(/ — sent out$/, ''), sentTo: t.sent_to ?? '', received: !!t.received_at
  }))
  const asked = db.all<{ name: string }>('SELECT name FROM visit_tests WHERE visit_id = ? AND sent_out = 0 ORDER BY id', rep.visit_id).map((r) => r.name)
  const [yy, mm, dd] = (v.visit_date as string).split('-')
  void master
  const watermark = rep.status === 'draft' ? 'DRAFT' : rep.status === 'imported' ? 'IMPORTED' : ''
  const correctionNote =
    rep.version > 1 && rep.status === 'approved'
      ? `Corrected report (version ${rep.version})${rep.approved_at ? ` issued ${new Date(rep.approved_at).toLocaleString('en-IN')}` : ''}. Reason: ${rep.reason ?? ''}. Earlier versions are withdrawn.`
      : ''
  return {
    lab: s.lab, paper: s.paper, letterhead: s.letterhead, letterheadTopMm: s.letterheadTopMm, letterheadBottomMm: s.letterheadBottomMm,
    patientName: v.pname, title: v.ptitle, ageText: formatAge({ years: v.age_y, months: v.age_m, days: v.age_d }), sexText: sexLabel(v.psex),
    sampleId: v.sample_id, dateText: `${dd}/${mm}/${yy}`, doctor: v.doctor, specimen: v.specimen, testAsked: asked.join(', '),
    version: rep.version, correctionNote, watermark,
    sections: [...sections.values()].sort((a, b) => secRank(a.title) - secRank(b.title)),
    sentOut, qrSvg: '', qrCaption: 'Scan to verify this report', approvedAtText: rep.approved_at ?? '',
    vitalsText: s.reportVitals ? vitalsLine(vitalsOf(v), v.age_y) : ''
  }
}
