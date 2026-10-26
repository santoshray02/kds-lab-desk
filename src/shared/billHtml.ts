import type { Settings } from './settings'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const inr = (n: number) => '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export interface ReceiptData {
  lab: Settings['lab']
  sampleId: string
  dateText: string
  patient: string
  ageSex: string
  phone: string
  doctor: string
  packageName: string
  items: { name: string; price: number }[]
  gross: number
  discount: number
  total: number
  payments: { dateText: string; amount: number; method: string }[]
  paid: number
  due: number
  footer: string
  style: 'a4' | 'thermal'
  thermalWidthMm: number
  /** a UPI QR to pay what is due */
  payQr?: { svg: string; amount?: number; upiId: string }
}

/** The bill the patient takes home: tests, prices, discount, what was paid and what is still due. */
export function renderReceiptHtml(d: ReceiptData): string {
  const thermal = d.style === 'thermal'
  const w = Math.max(48, Math.min(110, d.thermalWidthMm))
  // the margin is made with padding, not @page, so every print path gives the same result
  const page = thermal ? `@page { size: ${w}mm 400mm; margin: 0 }` : '@page { size: A4; margin: 0 }'
  const contact = [d.lab.phone && `☎ ${esc(d.lab.phone)}`, d.lab.email && `✉ ${esc(d.lab.email)}`].filter(Boolean).join(' · ')
  const rows = d.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r">${inr(i.price)}</td></tr>`).join('')
  const pays = d.payments.length
    ? `<div class="pays"><b>Payments</b>${d.payments.map((p) => `<div class="pr"><span>${esc(p.dateText)} · ${esc(p.method)}</span><span>${inr(p.amount)}</span></div>`).join('')}</div>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${esc(d.sampleId)}</title><style>
${page}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{padding:${thermal ? '2mm 3mm' : '12mm'};font:${thermal ? '9pt/1.35' : '10.5pt/1.45'} "Segoe UI","Noto Sans",Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rc{${thermal ? '' : 'width:130mm;border:1px solid #bbb;border-radius:6px;padding:7mm;'}}
.lab{text-align:center;font-weight:800;font-size:${thermal ? '12pt' : '15pt'};letter-spacing:.03em}
.sub{text-align:center;color:#444;font-size:${thermal ? '8pt' : '9pt'}}
h2{text-align:center;margin:6px 0;font-size:${thermal ? '10pt' : '11pt'};letter-spacing:.25em;border-top:1px dashed #777;border-bottom:1px dashed #777;padding:3px 0}
.kv{display:grid;grid-template-columns:${thermal ? '1fr' : '1fr 1fr'};gap:1px 10px;margin-bottom:6px}
.kv span{color:#555}
table{width:100%;border-collapse:collapse}
td{padding:2px 0;vertical-align:top}
td.r{text-align:right;white-space:nowrap;padding-left:8px}
.line{border-top:1px dashed #777;margin:5px 0}
.tot td{font-weight:700}
.due td{font-weight:800;font-size:${thermal ? '10.5pt' : '12pt'}}
.pays{margin-top:5px;font-size:${thermal ? '8pt' : '9pt'};color:#333}
.pr{display:flex;justify-content:space-between}
.pk{font-weight:600;margin:2px 0 4px}
.ft{text-align:center;margin-top:8px;color:#333}
.pq{display:flex;gap:8px;align-items:center;margin-top:8px;border-top:1px dashed #777;padding-top:6px;font-size:${thermal ? '8.5pt' : '9.5pt'}}
.pqs{flex:none;width:${thermal ? '26mm' : '30mm'}}
.pqs svg{width:100%;height:auto;display:block}
.pq small{display:block;color:#444;word-break:break-all}
</style></head><body><div class="rc">
<div class="lab">${esc(d.lab.name)}</div>
<div class="sub">${esc(d.lab.tagline)}</div>
<div class="sub">${esc(d.lab.address)}</div>
${contact ? `<div class="sub">${contact}</div>` : ''}
<h2>RECEIPT</h2>
<div class="kv"><div><span>Sample ID:</span> <b>${esc(d.sampleId)}</b></div><div><span>Date:</span> ${esc(d.dateText)}</div>
<div><span>Patient:</span> <b>${esc(d.patient)}</b></div><div><span>Age / Sex:</span> ${esc(d.ageSex)}</div>
${d.phone ? `<div><span>Phone:</span> ${esc(d.phone)}</div>` : ''}<div><span>Referred by:</span> ${esc(d.doctor)}</div></div>
${d.packageName ? `<div class="pk">Package: ${esc(d.packageName)}</div>` : ''}
<div class="line"></div>
<table>${rows}</table>
<div class="line"></div>
<table>
${d.discount > 0 ? `<tr><td>Total of tests</td><td class="r">${inr(d.gross)}</td></tr><tr><td>Discount</td><td class="r">− ${inr(d.discount)}</td></tr>` : ''}
<tr class="tot"><td>Net amount</td><td class="r">${inr(d.total)}</td></tr>
<tr><td>Paid</td><td class="r">${inr(d.paid)}</td></tr>
<tr class="due"><td>${d.due > 0 ? 'Balance due' : 'Balance'}</td><td class="r">${inr(d.due)}</td></tr>
</table>
${pays}
${d.payQr ? `<div class="pq" data-testid="pay-qr"><div class="pqs">${d.payQr.svg}</div><div><b>${d.payQr.amount ? `Pay ${inr(d.payQr.amount)} by UPI` : 'Pay by UPI'}</b><br>Scan with any UPI app<small>${esc(d.payQr.upiId)}</small></div></div>` : ''}
${d.footer ? `<div class="ft">${esc(d.footer)}</div>` : ''}
</div></body></html>`
}

export interface LabelData {
  labName: string
  sampleId: string
  patient: string
  ageSex: string
  dateText: string
  tests: string
  /** an SVG of the barcode or QR for the sample ID */
  codeSvg: string
  codeKind: 'barcode' | 'qr'
}

export type LabelConfig = Pick<Settings['labels'], 'widthMm' | 'heightMm' | 'showAge' | 'showTests'>

/** One sticker per page, sized to the label roll. Repeat the same label for each tube. */
export function renderLabelsHtml(l: LabelData, copies: number, c: LabelConfig): string {
  const w = Math.max(20, Math.min(120, c.widthMm))
  const h = Math.max(12, Math.min(100, c.heightMm))
  const one = `<div class="lb ${l.codeKind === 'barcode' ? 'bar' : 'qr'}"><div class="tx"><div class="lab">${esc(l.labName)}</div><div class="id">${esc(l.sampleId)}</div><div class="nm">${esc(l.patient)}</div>${c.showAge ? `<div class="sm">${esc(l.ageSex)} · ${esc(l.dateText)}</div>` : `<div class="sm">${esc(l.dateText)}</div>`}${c.showTests && l.tests ? `<div class="sm ts">${esc(l.tests)}</div>` : ''}</div><div class="cd">${l.codeSvg}</div></div>`
  const n = Math.max(1, Math.min(20, Math.round(copies)))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Labels ${esc(l.sampleId)}</title><style>
@page { size: ${w}mm ${h}mm; margin: 0 }
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Segoe UI","Noto Sans",Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lb{width:${w}mm;height:${h}mm;padding:1.2mm 1.6mm;display:flex;gap:1.5mm;align-items:center;overflow:hidden;page-break-after:always;break-after:page}
.lb:last-child{page-break-after:auto;break-after:auto}
.tx{flex:1;min-width:0;line-height:1.15}
.lab{font-size:5.5pt;font-weight:700;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.id{font-size:${h >= 28 ? '13pt' : h >= 20 ? '11pt' : '9pt'};font-weight:800;letter-spacing:.02em}
.nm{font-size:7.5pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sm{font-size:6.5pt;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sm.ts{white-space:normal;max-height:${Math.max(6, Math.floor(h / 3))}mm}
.lb.qr .cd{flex:none;width:${Math.round(Math.min(h - 3, w * 0.4))}mm;display:flex;align-items:center;justify-content:center}
.lb.qr .cd svg{width:100%;height:auto;max-height:${h - 3}mm}
.lb.bar{flex-direction:column;align-items:stretch;justify-content:center;gap:.5mm}
.lb.bar .tx{flex:0 1 auto;min-height:0;overflow:hidden}
.lb.bar .cd{flex:1 1 5mm;min-height:5mm;width:100%}
.lb.bar .cd svg{width:100%;height:100%}
</style></head><body>${Array.from({ length: n }, () => one).join('')}</body></html>`
}
