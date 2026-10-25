import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { renderReportHtml } from '../shared/reportHtml'
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

/** What the QR code encodes: the verification URL when cloud is on, otherwise the sample ID. */
export function qrTarget(db: Db, reportId: number): { text: string; caption: string } {
  const link = reportLink(db, reportId)
  const sample = db.get<{ sample_id: string }>('SELECT v.sample_id FROM reports r JOIN visits v ON v.id = r.visit_id WHERE r.id = ?', reportId)?.sample_id ?? ''
  return link
    ? { text: link, caption: 'Scan to verify this report online' }
    : { text: sample, caption: `Sample ID ${sample}` }
}

export async function reportHtml(db: Db, reportId: number): Promise<string> {
  const data = buildReportData(db, reportId)
  const q = qrTarget(db, reportId)
  data.qrSvg = await QRCode.toString(q.text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
  data.qrCaption = q.caption
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
