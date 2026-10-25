import type { Flag } from './types'

export interface ReportRow {
  name: string
  group: string | null
  type: string
  value: string
  unit: string
  range: string
  flag: Flag
  critical?: boolean
  paramCode: string | null
}
export interface ReportPanel {
  code: string | null
  name: string
  rows: ReportRow[]
}
export interface ReportSection {
  title: string
  panels: ReportPanel[]
}
export interface ReportData {
  lab: { name: string; tagline: string; address: string; doctorName: string; doctorQual: string; techName: string; techQual: string; footer: string }
  paper: 'A4' | 'Letter'
  letterhead: boolean
  letterheadTopMm: number
  letterheadBottomMm: number
  patientName: string
  title: string
  ageText: string
  sexText: string
  sampleId: string
  dateText: string
  doctor: string
  specimen: string
  testAsked: string
  version: number
  /** shown when this is a corrected version */
  correctionNote: string
  /** "IMPORTED" and "DRAFT" watermarks */
  watermark: string
  sections: ReportSection[]
  sentOut: { name: string; sentTo: string; received: boolean }[]
  qrSvg: string
  qrCaption: string
  approvedAtText: string
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const DILUTIONS = [20, 40, 80, 160, 320]

function spaced(title: string): string {
  return esc(title)
}

function rowHtml(r: ReportRow): string {
  const abnormal = r.flag != null
  const val = r.value === '' ? '' : esc(r.value) + (r.flag === 'H' || r.flag === 'L' ? ` ${r.flag}` : '')
  return `<tr class="row${abnormal ? ' ab' : ''}"><td class="n">${esc(r.name)}</td><td class="v">${val}</td><td class="u">${esc(r.unit)}</td><td class="r">${esc(r.range)}</td></tr>`
}

function widalHtml(p: ReportPanel): string {
  const main = p.rows.find((r) => r.paramCode === 'widal')
  const titres = p.rows.filter((r) => r.type === 'titre')
  let out = ''
  if (main) {
    out += `<div class="widal-head">WIDAL TEST (SLIDE METHOD): <b>“${esc(main.value.toUpperCase())}”</b></div>`
  }
  if (titres.length) {
    out += `<table class="grid"><tr><th rowspan="2" class="ant">ANTIGEN</th><th colspan="${DILUTIONS.length}">TITRE DILUTION</th></tr>`
    out += `<tr>${DILUTIONS.map((d) => `<th>1:${d}</th>`).join('')}</tr>`
    for (const t of titres) {
      const hi = parseInt(t.value, 10) || 0
      out += `<tr><td class="ant">${esc(t.name)}</td>${DILUTIONS.map((d) => `<td>${hi >= d ? '+' : '−'}</td>`).join('')}</tr>`
    }
    out += '</table>'
  }
  return out
}

function panelHtml(p: ReportPanel): string {
  if (p.code === 'WIDAL') return `<div class="panel small">${widalHtml(p)}</div>`
  // a panel with only qualitative single results is printed like the lab's serology blocks
  const body: string[] = []
  let lastGroup: string | null = null
  for (const r of p.rows) {
    if (r.group && r.group !== lastGroup) body.push(`<tr class="grp"><td colspan="4">${esc(r.group)}</td></tr>`)
    lastGroup = r.group
    body.push(rowHtml(r))
  }
  return `<div class="panel${p.rows.length <= 8 ? ' small' : ''}"><div class="ptitle">${esc(p.name)}</div><table class="res"><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup>
<thead><tr><th>Tests</th><th>Result</th><th>Unit</th><th>Limitations</th></tr></thead><tbody>${body.join('')}</tbody></table></div>`
}

export function renderReportHtml(d: ReportData): string {
  const page = d.paper === 'Letter' ? 'Letter' : 'A4'
  const mt = d.letterhead ? d.letterheadTopMm : 8
  const mb = d.letterhead ? d.letterheadBottomMm : 8
  const sections = d.sections
    .map((s) => `<div class="section"><div class="stitle">${spaced(s.title)}</div>${s.panels.map(panelHtml).join('')}</div>`)
    .join('')
  const sent = d.sentOut.length
    ? `<div class="sent"><b>Sent-out tests:</b> ${d.sentOut
        .map((s) => `${esc(s.name)} — sent to ${esc(s.sentTo || 'referral lab')}${s.received ? ' (report received; attached separately)' : ' (report awaited)'}`)
        .join('; ')}</div>`
    : ''
  const header = d.letterhead
    ? ''
    : `<div class="lh"><div class="lab">${esc(d.lab.name)}</div><div class="tag">${esc(d.lab.tagline)}</div><div class="addr">${esc(d.lab.address)}</div></div>`
  const asked = d.testAsked ? `<div class="asked">Test Asked : ${esc(d.testAsked)}</div>` : ''
  const corr = d.correctionNote ? `<div class="corr">${esc(d.correctionNote)}</div>` : ''
  const wm = d.watermark ? `<div class="wm">${esc(d.watermark)}</div>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.sampleId)}</title><style>
@page { size: ${page}; margin: ${mt}mm 10mm ${mb}mm 10mm; }
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font:11pt/1.35 "Segoe UI","Noto Sans",Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.page{width:100%;border-collapse:collapse}
table.page>thead{display:table-header-group}
table.page>tfoot{display:table-footer-group}
table.page>thead>tr>td,table.page>tbody>tr>td,table.page>tfoot>tr>td{padding:0}
.lh{text-align:center;border-bottom:2px solid #3a3a8c;padding-bottom:5px;margin-bottom:6px}
.lab{font:800 22pt/1.1 "Segoe UI",Arial,sans-serif;color:#3a3a8c;letter-spacing:.06em}
.tag{font-weight:600;font-size:11pt}
.addr{font-size:9.5pt}
.pt{display:grid;grid-template-columns:1.25fr 1fr;gap:1px 14px;font-size:10.5pt;padding:4px 2px;border-bottom:1px solid #777;margin-bottom:6px}
.pt .nm{text-transform:uppercase}
.pt b{font-weight:700}
.asked{font-weight:600;font-size:10.5pt;margin:2px 2px 4px}
.corr{border:1px solid #c2185b;color:#c2185b;font-size:9.5pt;padding:3px 6px;margin:2px 0 6px}
.section{margin-bottom:8px}
.stitle{break-after:avoid;page-break-after:avoid;text-align:center;font-weight:800;letter-spacing:.45em;font-size:11.5pt;padding:3px 0;border-top:1px solid #222;border-bottom:1px solid #222;margin:6px 0 4px}
.ptitle{font-weight:700;font-size:10.5pt;margin:5px 0 2px;text-decoration:underline;break-after:avoid;page-break-after:avoid}
.panel.small{break-inside:avoid;page-break-inside:avoid}
table.res{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
table.res col.c1{width:46%}table.res col.c2{width:17%}table.res col.c3{width:14%}table.res col.c4{width:23%}
table.res th{text-align:left;font-size:10pt;border-bottom:1px solid #444;padding:2px 3px}
table.res td{padding:2px 3px;font-size:10.5pt;vertical-align:top}
table.res tr{break-inside:avoid;page-break-inside:avoid}
table.res tr.grp td{font-weight:700;font-size:10pt;padding-top:5px;text-transform:uppercase}
table.res tr.ab td.v{font-weight:800}
table.res td.v{font-weight:400}
.widal-head{margin:4px 2px;font-size:10.5pt}
table.grid{width:100%;border-collapse:collapse;margin:4px 0;font-size:10.5pt}
table.grid th,table.grid td{border:1px solid #444;padding:2px 4px;text-align:center}
table.grid td.ant,table.grid th.ant{text-align:left}
.sent{font-size:9.5pt;margin:6px 2px;border:1px dashed #777;padding:3px 6px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid #777;padding-top:5px;margin-top:6px;gap:10px;font-size:9.5pt}
.foot .sig{text-align:center;min-width:42mm;font-weight:600;font-size:10.5pt}
.foot .sig small{display:block;font-weight:400;font-size:9.5pt}
.foot .mid{text-align:center;flex:1;display:flex;flex-direction:column;align-items:center;gap:2px}
.foot .qr{width:17mm;height:17mm}
.foot .qr svg{width:100%;height:100%}
.disc{text-align:center;font-size:9pt;margin-top:3px}
.wm{position:fixed;top:45%;left:0;right:0;text-align:center;font:800 70pt/1 Arial,sans-serif;color:rgba(0,0,0,.07);transform:rotate(-25deg);pointer-events:none;z-index:-1}
</style></head><body>${wm}
<table class="page"><thead><tr><td>${header}
<div class="pt">
<div class="nm">Name : <b>${esc(d.title ? d.title + '. ' : '')}${esc(d.patientName)}</b></div><div>Sample ID : <b>${esc(d.sampleId)}</b></div>
<div>Ref. By : <b>${esc(d.doctor)}</b></div><div>Date : <b>${esc(d.dateText)}</b></div>
<div>Age / Sex : <b>${esc(d.ageText)} / ${esc(d.sexText)}</b></div><div>Specimen : <b>${esc(d.specimen)}</b></div>
</div></td></tr></thead>
<tfoot><tr><td><div class="foot">
<div class="sig">${esc(d.lab.doctorName)}<small>${esc(d.lab.doctorQual)}</small></div>
<div class="mid"><div class="qr">${d.qrSvg}</div><div>${esc(d.qrCaption)}</div></div>
<div class="sig">${esc(d.lab.techName)}<small>${esc(d.lab.techQual)}</small></div>
</div><div class="disc">${esc(d.lab.footer)}${d.version > 1 ? ` · Version ${d.version}` : ''}</div></td></tr></tfoot>
<tbody><tr><td>${asked}${corr}${sections}${sent}</td></tr></tbody></table></body></html>`
}
