import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import QRCode from 'qrcode'
import { renderReportHtml, type ReportData } from '../shared/reportHtml'
import type { Db } from './db'
import { AppError, buildReportData } from './results'
import { getSettings } from './settings'

export function reportLink(db: Db, reportId: number): string | null {
  const s = getSettings(db)
  if (!s.cloud.enabled || !s.cloud.reportBase) return null
  const code = db.get<{ share_code: string | null }>('SELECT share_code FROM reports WHERE id = ?', reportId)?.share_code
  if (!code) return null
  return `${s.cloud.reportBase.replace(/\/+$/, '')}/r/${code}`
}

/** Short code derived from the patient, sample, version and every printed result; any edit changes it. */
export function verifyCode(d: ReportData): string {
  const body = d.sections.flatMap((s) => s.panels.flatMap((p) => p.rows.map((r) => `${p.name}|${r.name}|${r.value}|${r.unit}`)))
  const h = createHash('sha256').update([d.sampleId, d.version, d.patientName, d.dateText, ...body].join('\n')).digest('hex').slice(0, 12).toUpperCase()
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`
}

/**
 * What the QR code encodes: the verification URL when cloud is on; otherwise a readable
 * summary any phone camera can show, ending in the integrity code (checkable at the lab).
 */
export function qrTarget(db: Db, reportId: number, data?: ReportData): { text: string; caption: string; code: string } {
  const d = data ?? buildReportData(db, reportId)
  const code = verifyCode(d)
  const link = reportLink(db, reportId)
  if (link) return { text: link, caption: 'Scan to verify this report online', code }
  const text = [
    d.lab.name,
    `Report ${d.sampleId}${d.version > 1 ? ` (version ${d.version})` : ''}`,
    `Patient: ${d.title ? d.title + '. ' : ''}${d.patientName}`,
    `Age/Sex: ${d.ageText} / ${d.sexText}`,
    `Date: ${d.dateText}`,
    d.watermark ? `Status: ${d.watermark}` : `Signed: ${d.lab.doctorName}`,
    `Verify code: ${code}`,
    'Not valid for medico legal purpose.'
  ].join('\n')
  return { text, caption: 'Scan for report details', code }
}

export async function reportHtml(db: Db, reportId: number): Promise<string> {
  const data = buildReportData(db, reportId)
  const q = qrTarget(db, reportId, data)
  data.qrSvg = await QRCode.toString(q.text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
  data.qrCaption = q.caption
  data.verifyCode = q.code
  return renderReportHtml(data)
}

export function pdfFileName(db: Db, reportId: number): string {
  const r = db.get<{ sample_id: string; version: number; pname: string }>(
    'SELECT v.sample_id, r.version, p.name AS pname FROM reports r JOIN visits v ON v.id = r.visit_id JOIN patients p ON p.id = v.patient_id WHERE r.id = ?',
    reportId
  )
  if (!r) throw new AppError('NOT_FOUND', 'Report not found')
  const safe = r.pname.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
  return `${r.sample_id}_${safe}${r.version > 1 ? `_v${r.version}` : ''}.pdf`
}

export type PdfRenderer = (html: string, paper: 'A4' | 'Letter') => Promise<Buffer>

/** Make (or reuse) the PDF file of an approved report. Drafts are rendered fresh into a temp folder. */
export async function ensurePdf(db: Db, dataDir: string, reportId: number, render: PdfRenderer, writeFile: (p: string, b: Buffer) => void): Promise<string> {
  const rep = db.get<{ status: string; pdf_path: string | null }>('SELECT status, pdf_path FROM reports WHERE id = ?', reportId)
  if (!rep) throw new AppError('NOT_FOUND', 'Report not found')
  const dir = join(dataDir, rep.status === 'draft' ? 'tmp' : 'pdf')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, pdfFileName(db, reportId))
  if (rep.status !== 'draft' && rep.pdf_path && existsSync(rep.pdf_path) && rep.pdf_path === path) return path
  const buf = await render(await reportHtml(db, reportId), getSettings(db).paper)
  writeFile(path, buf)
  if (rep.status !== 'draft') db.run('UPDATE reports SET pdf_path = ? WHERE id = ?', path, reportId)
  return path
}
