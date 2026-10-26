import type { Flag } from './types'
import type { Settings } from './settings'

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
  /** this patient's earlier numeric results of the same test, oldest first (at most 5) */
  trend?: { v: number; d: string }[]
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
  lab: Settings['lab']
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
  /** short integrity code printed under the QR; changes if any result changes */
  verifyCode?: string
  approvedAtText: string
  /** one line of vitals; empty when not taken or not switched on in Settings */
  vitalsText?: string
  /** how out-of-range results look; see Settings.abnormalStyle (standard when missing) */
  abnormalStyle?: 'standard' | 'gentle' | 'plain'
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const LOGO = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="kdsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3a8f"/><stop offset="1" stop-color="#127c96"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#kdsg)"/><path d="M32 9C32 9 16 27 16 38a16 16 0 0 0 32 0C48 27 32 9 32 9Z" fill="#fff"/><rect x="25" y="35.500" width="14" height="5" rx="2" fill="#2b3a8f"/><rect x="29.500" y="31" width="5" height="14" rx="2" fill="#2b3a8f"/><circle cx="49" cy="15" r="4.500" fill="#f0527f"/></svg>`

/** Letterhead: logo, name, tagline on the left; address and contact details on the right. */
export function letterheadBlock(lab: Settings['lab']): string {
  const contact = [lab.phone && `☎ ${esc(lab.phone)}`, lab.email && `✉ ${esc(lab.email)}`].filter(Boolean).join(' &nbsp;·&nbsp; ')
  return `<div class="lh"><div class="logo">${LOGO}</div><div class="l"><div class="lab">${esc(lab.name)}</div><div class="tag">${esc(lab.tagline)}</div></div><div class="addr">${esc(lab.address)}${contact ? `<br>${contact}` : ''}${lab.timings ? `<br>${esc(lab.timings)}` : ''}${lab.regNo ? `<br>${esc(lab.regNo)}` : ''}</div></div>`
}

export const LETTERHEAD_CSS = `
:root{--ac:#2b3a8f;--ac2:#eef0fa;--ink:#161a2b;--mut:#5d6479;--line:#d9dcea}
.lh{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:5px solid var(--ac);padding:7px 2px 7px;margin-bottom:7px;border-bottom:1px solid var(--line)}
.lh .l{flex:1}
.lh .logo{width:15mm;height:15mm;flex:none}
.lh .logo svg{width:100%;height:100%;display:block}
.lh{border-bottom:3px double var(--line)}
.lab{font:800 22pt/1.05 "Segoe UI",Arial,sans-serif;color:var(--ac);letter-spacing:.04em}
.tag{font-weight:600;font-size:10.5pt;color:var(--mut);margin-top:2px}
.addr{font-size:9pt;color:var(--mut);text-align:right;max-width:70mm;line-height:1.35}
`

const DILUTIONS = [20, 40, 80, 160, 320]

function spaced(title: string): string {
  return esc(title)
}

/** A thin bar showing where a numeric value sits against a "low – high" range. */
function gauge(r: ReportRow): string {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*$/.exec(r.range)
  const v = parseFloat(r.value)
  if (!m || !isFinite(v) || r.type !== 'numeric') return ''
  const lo = parseFloat(m[1]), hi = parseFloat(m[2])
  if (!(hi > lo)) return ''
  const span = hi - lo
  const min = lo - span * 0.6, max = hi + span * 0.6
  const pos = (x: number) => Math.max(2, Math.min(98, ((x - min) / (max - min)) * 100))
  const cls = r.flag === 'H' || r.flag === 'L' ? ' bad' : ''
  return `<div class="gz"><i class="ok" style="left:${pos(lo).toFixed(1)}%;width:${(pos(hi) - pos(lo)).toFixed(1)}%"></i><b class="mk${cls}" style="left:${pos(v).toFixed(1)}%"></b></div>`
}

/** A tiny line of the earlier results plus this one; the last dot is red when this result is flagged. */
function sparkline(r: ReportRow): string {
  const cur = parseFloat(r.value)
  if (!r.trend?.length || !isFinite(cur) || r.type !== 'numeric') return ''
  const pts = [...r.trend.map((p) => p.v), cur]
  const lo = Math.min(...pts), hi = Math.max(...pts)
  if (hi === lo) return '' // nothing changed: a flat line says nothing
  const span = hi - lo || 1
  const W = 54, H = 14
  const xy = pts.map((v, i) => [2 + (i * (W - 4)) / (pts.length - 1), H - 2 - ((v - lo) / span) * (H - 4)])
  const last = xy[xy.length - 1]
  const bad = r.flag === 'H' || r.flag === 'L'
  const tip = [...r.trend.map((p) => `${p.d.split('-').reverse().join('/')}: ${p.v}`), `today: ${cur}`].join(' | ')
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><title>${esc(tip)}</title><polyline points="${xy.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#8a90a8" stroke-width="1.2" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" class="dot${bad ? ' bad' : ''}" fill="#2b3a8f"/></svg>`
}

function rowHtml(r: ReportRow): string {
  const abnormal = r.flag != null
  const val = r.value === '' ? '' : esc(r.value) + (r.flag === 'H' || r.flag === 'L' ? ` ${r.flag}` : '')
  return `<tr class="row${abnormal ? ' ab' : ''}${abnormal && r.critical ? ' crit' : ''}"><td class="n">${esc(r.name)}</td><td class="v">${val}${sparkline(r)}</td><td class="u">${esc(r.unit)}</td><td class="r">${esc(r.range)}${gauge(r)}</td></tr>`
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
  const header = d.letterhead ? '' : letterheadBlock(d.lab)
  const hasTrend = d.sections.some((s) => s.panels.some((p) => p.rows.some((r) => r.trend?.length)))
  const flagged = d.sections.flatMap((x) => x.panels.flatMap((p) => p.rows)).filter((r) => r.value !== '' && (r.flag === 'H' || r.flag === 'L'))
  const crit = flagged.filter((r) => r.critical).length
  const style = d.abnormalStyle ?? 'standard'
  const summary = flagged.length && style === 'standard'
    ? `<div class="sum"><b>${flagged.length} result${flagged.length > 1 ? 's' : ''} outside the reference range${crit ? ` (${crit} critical)` : ''}:</b><span>${flagged.slice(0, 5).map((r) => `${esc(r.name.replace(/\s*\(.*\)$/, ''))} ${esc(r.value)} ${r.flag}`).join(' · ')}${flagged.length > 5 ? ` · +${flagged.length - 5} more` : ''}</span></div>`
    : ''
  const asked = d.testAsked ? `<div class="asked">Test Asked : ${esc(d.testAsked)}</div>` : ''
  const vit = d.vitalsText ? `<div class="asked">Vitals : ${esc(d.vitalsText)}</div>` : ''
  const corr = d.correctionNote ? `<div class="corr">${esc(d.correctionNote)}</div>` : ''
  const wm = d.watermark ? `<div class="wm">${esc(d.watermark)}</div>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.sampleId)}</title><style>${LETTERHEAD_CSS}
@page { size: ${page}; margin: ${mt}mm 10mm ${mb}mm 10mm; }
:root{--ac:#2b3a8f;--ac2:#eef0fa;--ink:#161a2b;--mut:#5d6479;--line:#d9dcea;--bad:#b3261e;--badbg:#fdf0ee}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font:10.5pt/1.4 "Segoe UI","Noto Sans",Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.page{width:100%;border-collapse:collapse}
table.page>thead{display:table-header-group}
table.page>tfoot{display:table-footer-group}
table.page>thead>tr>td,table.page>tbody>tr>td,table.page>tfoot>tr>td{padding:0}
.pt{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:5px 14px;background:var(--ac2);border:1px solid var(--line);border-radius:6px;padding:7px 10px;margin-bottom:6px}
.pt div{font-size:10.5pt;font-weight:700;min-width:0}
.pt div span{display:block;font-size:7.5pt;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--mut)}
.pt .nm{text-transform:uppercase}
.sum{display:flex;gap:8px;align-items:flex-start;border:1px solid #f0c9c4;background:var(--badbg);color:var(--bad);border-radius:6px;padding:4px 9px;margin:0 0 6px;font-size:9.5pt}
.sum b{white-space:nowrap}
.sum.ok{border-color:#c8e3cf;background:#eff9f1;color:#1d6b35}
.asked{font-weight:600;font-size:9.5pt;color:var(--mut);margin:2px 2px 4px}
.corr{border:1px solid #c2185b;color:#c2185b;border-radius:6px;font-size:9.5pt;padding:3px 8px;margin:2px 0 6px}
.section{margin-bottom:8px}
.stitle{break-after:avoid;page-break-after:avoid;text-align:center;font-weight:800;letter-spacing:.4em;font-size:10.5pt;padding:3px 0 3px .4em;background:var(--ac);color:#fff;border-radius:4px;margin:8px 0 4px}
.ptitle{font-weight:700;font-size:10.5pt;margin:6px 0 2px;color:var(--ac);break-after:avoid;page-break-after:avoid}
.panel.small{break-inside:avoid;page-break-inside:avoid}
table.res{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
table.res col.c1{width:44%}table.res col.c2{width:19%}table.res col.c3{width:14%}table.res col.c4{width:23%}
table.res th{text-align:left;font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);border-bottom:1.5px solid var(--ac);padding:2px 5px}
table.res td{padding:2.5px 5px;font-size:10.5pt;vertical-align:top;border-bottom:1px solid #eceef6}
table.res td.u,table.res td.r{color:var(--mut);font-size:9.5pt}
table.res tr{break-inside:avoid;page-break-inside:avoid}
table.res tr.grp td{font-weight:700;font-size:9pt;padding-top:6px;text-transform:uppercase;color:var(--ac);border-bottom:0}
table.res tr.ab td{background:var(--badbg)}
table.res tr.ab td.n,table.res tr.ab td.v{font-weight:800}
table.res tr.ab td.v{color:var(--bad)}
table.res td.v{font-weight:500}
.gz{position:relative;height:5px;margin-top:2px;border-radius:3px;background:#e4e7f2}
.gz .ok{position:absolute;top:0;bottom:0;background:#9fd6ad;border-radius:3px}
.gz .mk{position:absolute;top:-2px;width:3px;height:9px;margin-left:-1.5px;border-radius:2px;background:var(--ac)}
.gz .mk.bad{background:var(--bad)}
.spark{display:inline-block;vertical-align:middle;margin-left:7px}
.spark .dot.bad{fill:var(--bad)}
.trendnote{font-size:8pt;color:var(--mut);margin:4px 2px 0}
.stamp{text-align:center;font-size:8pt;color:var(--mut);margin-top:3px}
.widal-head{margin:4px 2px;font-size:10.5pt}
table.grid{width:100%;border-collapse:collapse;margin:4px 0;font-size:10pt}
table.grid th,table.grid td{border:1px solid var(--line);padding:2px 4px;text-align:center}
table.grid th{background:var(--ac2);font-size:8.5pt}
table.grid td.ant,table.grid th.ant{text-align:left}
.sent{font-size:9.5pt;margin:6px 2px;border:1px dashed var(--mut);border-radius:6px;padding:3px 8px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;border-top:1.5px solid var(--ac);padding-top:6px;margin-top:6px;gap:10px;font-size:9pt}
.foot .sig{text-align:center;min-width:46mm;font-weight:700;font-size:10.5pt;padding-top:9mm}
.foot .sig i{display:block;border-top:1px solid var(--ink);margin-bottom:2px}
.foot .sig small{display:block;font-weight:400;font-size:9pt;color:var(--mut)}
.foot .mid{text-align:center;flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;color:var(--mut);font-size:8pt}
.foot .qr{width:27mm;height:27mm;padding:3mm;border:1px solid var(--line);border-radius:3px;background:#fff}
.foot .qr svg{width:100%;height:100%;display:block;shape-rendering:crispEdges}
.foot .code{font:600 8.5pt "Consolas","Courier New",monospace;color:var(--ink);letter-spacing:.05em}
.disc{text-align:center;font-size:8.5pt;color:var(--mut);margin-top:3px}
.wm{position:fixed;top:45%;left:0;right:0;text-align:center;font:800 70pt/1 Arial,sans-serif;color:rgba(0,0,0,.07);transform:rotate(-25deg);pointer-events:none;z-index:-1}
${style === 'standard' ? '' : `table.res tr.ab td{background:none}
table.res tr.ab td.v{color:var(--ink)}
.gz .mk.bad{background:var(--ac)}
.spark .dot.bad{fill:var(--ac)}
${style === 'gentle' ? 'table.res tr.ab.crit td.v{color:var(--bad)}' : ''}`}
</style></head><body>${wm}
<table class="page"><thead><tr><td>${header}
<div class="pt">
<div class="nm"><span>Patient</span>${esc(d.title ? d.title + '. ' : '')}${esc(d.patientName)}</div><div><span>Age / Sex</span>${esc(d.ageText)} / ${esc(d.sexText)}</div><div><span>Sample ID</span>${esc(d.sampleId)}</div>
<div><span>Referred by</span>${esc(d.doctor)}</div><div><span>Specimen</span>${esc(d.specimen)}</div><div><span>Date</span>${esc(d.dateText)}</div>
</div></td></tr></thead>
<tfoot><tr><td><div class="foot">
<div class="sig"><i></i>${esc(d.lab.doctorName)}<small>${esc(d.lab.doctorQual)}</small></div>
<div class="mid"><div class="qr">${d.qrSvg}</div><div>${esc(d.qrCaption)}</div>${d.verifyCode ? `<div class="code">${esc(d.verifyCode)}</div>` : ''}</div>
<div class="sig"><i></i>${esc(d.lab.techName)}<small>${esc(d.lab.techQual)}</small></div>
</div>${d.approvedAtText && !d.watermark ? `<div class="stamp">Electronically approved ${esc(new Date(d.approvedAtText).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))} · ${esc(d.lab.doctorName)}</div>` : ''}<div class="disc">${esc(d.lab.footer)}${d.version > 1 ? ` · Version ${d.version}` : ''}</div></td></tr></tfoot>
<tbody><tr><td>${summary}${asked}${vit}${corr}${sections}${sent}${hasTrend ? `<div class="trendnote">The small graph under a result shows this patient's earlier results from this lab (oldest on the left); the dot is today's result.</div>` : ''}</td></tr></tbody></table></body></html>`
}

/** A blank sheet carrying only the letterhead, to print on plain paper or send to a printing press. */
export function renderLetterheadHtml(lab: Settings['lab'], paper: 'A4' | 'Letter'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Letterhead</title><style>${LETTERHEAD_CSS}
@page { size: ${paper}; margin: 0 }
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font:10.5pt/1.4 "Segoe UI","Noto Sans",Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;min-height:100vh;padding:0 10mm}
.sheet .lh{margin-bottom:0}
.band{position:absolute;left:0;right:0;bottom:0;background:var(--ac);color:#fff;text-align:center;font-size:8.5pt;padding:3mm 10mm;letter-spacing:.03em}
.mark{position:absolute;left:0;right:0;top:48%;text-align:center;color:rgba(43,58,143,.05);font:800 54pt/1 "Segoe UI",Arial,sans-serif;letter-spacing:.1em;transform:rotate(-20deg)}
</style></head><body><div class="sheet">${letterheadBlock(lab)}<div class="mark">${esc(lab.name)}</div><div class="band">${esc(lab.address)}${lab.phone ? ' · ' + esc(lab.phone) : ''}</div></div></body></html>`
}
