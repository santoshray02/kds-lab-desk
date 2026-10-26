import QRCode from 'qrcode'
import * as bwipjs from 'bwip-js/node'
import { formatAge } from '../shared/age'
import { renderLabelsHtml, renderReceiptHtml, type LabelData, type ReceiptData } from '../shared/billHtml'
import { isUpiId, upiLink } from '../shared/upi'
import type { Db } from './db'
import { getVisit } from './visits'
import { getSettings } from './settings'

const dmy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other' }

/** A QR as an SVG, made without waiting (so the receipt can be built in one go). */
export function qrSvgSync(text: string): string {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = q.modules.size
  const pad = 4
  let path = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(x, y)) path += `M${x + pad} ${y + pad}h1v1h-1z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + pad * 2} ${n + pad * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}

export interface PayQr {
  svg: string
  link: string
  upiId: string
  payeeName: string
  /** amount inside the QR, if any */
  amount?: number
  due: number
}

/** The UPI QR for a visit: for the amount due (or the amount given), when the lab has set a valid UPI ID. */
export function payQrFor(db: Db, visitId: number, amount?: number): PayQr {
  const s = getSettings(db)
  if (!isUpiId(s.payQr.upiId)) throw new Error('Set the lab\u2019s UPI ID first (Settings \u2192 Bills, stickers & money).')
  const g = getVisit(db, visitId)
  if (!g) throw new Error('Visit not found')
  const due = Math.max(0, (g.visit.total as number) - (g.paid as number))
  const amt = amount ?? (s.payQr.withAmount && due > 0 ? due : undefined)
  const payeeName = s.payQr.payeeName.trim() || s.lab.name
  const link = upiLink({ upiId: s.payQr.upiId, name: payeeName, amount: amt, note: g.visit.sample_id })
  return { svg: qrSvgSync(link), link, upiId: s.payQr.upiId.trim(), payeeName, amount: amt, due }
}

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
    paid, due: Math.max(0, total - paid), footer: s.receipt.footer, style: s.receipt.style, thermalWidthMm: s.receipt.thermalWidthMm,
    payQr: receiptPayQr(db, visitId, s, total - paid)
  }
}

function receiptPayQr(db: Db, visitId: number, s: ReturnType<typeof getSettings>, due: number): ReceiptData['payQr'] {
  const c = s.payQr
  if (!c.enabled || c.onReceipt === 'never' || !isUpiId(c.upiId)) return undefined
  if (c.onReceipt === 'whenDue' && !(due > 0.009)) return undefined
  const q = payQrFor(db, visitId)
  return { svg: q.svg, amount: q.amount, upiId: q.upiId }
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
