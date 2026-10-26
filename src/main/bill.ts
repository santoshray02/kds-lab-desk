import QRCode from 'qrcode'
import * as bwipjs from 'bwip-js/node'
import { formatAge } from '../shared/age'
import { renderLabelsHtml, renderReceiptHtml, type LabelData, type ReceiptData } from '../shared/billHtml'
import type { Db } from './db'
import { getVisit } from './visits'
import { getSettings } from './settings'

const dmy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other' }

export function buildReceiptData(db: Db, visitId: number): ReceiptData {
  const g = getVisit(db, visitId)
  if (!g) throw new Error('Visit not found')
  const s = getSettings(db)
  const v = g.visit
  const total = v.total as number
  const paid = g.paid as number
  return {
    lab: s.lab, sampleId: v.sample_id, dateText: dmy(v.visit_date),
    patient: `${g.patient.title ? g.patient.title + '. ' : ''}${g.patient.name}`,
    ageSex: `${formatAge({ years: v.age_y, months: v.age_m, days: v.age_d })} / ${g.patient.sex === 'F' ? 'Female' : 'Male'}`,
    phone: g.patient.phone, doctor: v.doctor, packageName: v.package_name ?? '',
    items: g.tests.map((t: any) => ({ name: String(t.name).replace(/ — sent out$/, ''), price: t.price })),
    gross: g.tests.reduce((a: number, t: any) => a + t.price, 0), discount: v.discount, total,
    payments: g.payments.map((p: any) => ({ dateText: dmy(String(p.paid_at).slice(0, 10)), amount: p.amount, method: METHOD[p.method] ?? 'Cash' })),
    paid, due: Math.max(0, total - paid), footer: s.receipt.footer, style: s.receipt.style, thermalWidthMm: s.receipt.thermalWidthMm
  }
}

export const receiptHtml = (db: Db, visitId: number) => renderReceiptHtml(buildReceiptData(db, visitId))

/** The sample ID as a Code 128 barcode (what a cheap scanner reads) or as a QR code (what a phone reads). */
export async function codeSvg(text: string, kind: 'barcode' | 'qr'): Promise<string> {
  if (kind === 'qr') return QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
  const lib = ((bwipjs as unknown as { default?: typeof bwipjs }).default ?? bwipjs)
  // only the bar widths matter to a scanner, so the bars may be stretched to the height the label has left
  return lib.toSVG({ bcid: 'code128', text, scale: 2, height: 10, includetext: false, paddingwidth: 4, paddingheight: 0 }).replace('<svg ', '<svg preserveAspectRatio="none" ')
}

export async function labelsHtml(db: Db, visitId: number, copies?: number): Promise<string> {
  const g = getVisit(db, visitId)
  if (!g) throw new Error('Visit not found')
  const s = getSettings(db)
  const v = g.visit
  const label: LabelData = {
    labName: s.lab.name, sampleId: v.sample_id,
    patient: `${g.patient.title ? g.patient.title + '. ' : ''}${g.patient.name}`,
    ageSex: `${formatAge({ years: v.age_y, months: v.age_m, days: v.age_d })} ${g.patient.sex}`,
    dateText: dmy(v.visit_date), tests: g.tests.filter((t: any) => !t.sent_out).map((t: any) => t.panel_code).join(' '),
    codeSvg: await codeSvg(v.sample_id, s.labels.code), codeKind: s.labels.code
  }
  return renderLabelsHtml(label, copies ?? s.labels.copies, s.labels)
}
