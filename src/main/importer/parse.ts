import { MASTER } from '../../shared/masterData'
import { mapName, normalizeLabel, sectionOf } from './aliases'

export interface ParsedRow {
  section: string
  panel: string
  label: string
  value: string
  unit: string
  range: string
  code: string | null
}

export interface ParsedVisit {
  title: string
  name: string
  sex: 'M' | 'F' | null
  age: { years: number; months: number; days: number }
  date: string // ISO yyyy-mm-dd
  doctor: string
  specimen: string
  layout: 'name-ref' | 'old'
  rows: ParsedRow[]
  /** lines that looked like results but could not be understood */
  skipped: string[]
  notes: string[]
}

export interface ParseResult {
  visits: ParsedVisit[]
  thyrocare: boolean
  reason: string
}

const PANEL_OF_CODE = new Map<string, { panel: string; section: string }>()
for (const p of MASTER) for (const q of p.params) PANEL_OF_CODE.set(q.code, { panel: p.name, section: p.section })

const BLACKLIST = /^(name|ref|age|sex|date|specimen|test asked|testasked|investigation|received|reported|mob|pt\.? name|add|tests?|result|results?|unit|units|limitations?|reference range|normal range|normal value|observed value|parameters? name|name of test|observed|qualitative)$/i

const QUAL = /^(negative|positive|non[- ]?reactive|reactive|nil|trace|absent|present|normal|clear|acidic|alkaline|scanty|detected|not detected|[abo]+|ab)$/i

const UNIT_RE = /^(%|[A-Za-zµ°][A-Za-z0-9µ°/.%^*\- ]{0,16}|\/[A-Za-z]+\.?|[a-z]+\/[a-z0-9]+)$/

const NUM_RE = /^[<>]?\s*-?\d[\d,]*(\.\d+)?$/

function clean(s: string) {
  return s.replace(/ /g, ' ').replace(/[“”"‘’`]/g, (c) => (c === '"' || c === '“' || c === '”' ? '"' : "'"))
}

function tokens(line: string): string[] {
  let t = clean(line)
    .split(/	+|\s{2,}|\s\|\s|\|/)
    .map((x) => x.trim().replace(/^:\s*/, '').replace(/\s*:$/, '').trim())
    .filter((x) => x && !/^[-–—_=.\s]{3,}$/.test(x) && x !== ':')
  // some files separate every word with a tab: "Packed<TAB>Cell<TAB>Volume<TAB>30.1<TAB>%"
  const k = t.findIndex((x) => NUM_RE.test(x) || /^\d+\s*[-–]\s*\d+$/.test(x) || /^\d[\d,]*(\.\d+)?\.?[A-Za-z%\/][\w%\/.]*$/.test(x))
  if (k >= 2 && t.slice(0, k).every((x, i) => /[A-Za-z()]/.test(x) && (i === 0 || !/\d/.test(x)) && !QUAL.test(x) && x.length <= 24)) t = [t.slice(0, k).join(' '), ...t.slice(k)]
  if (k === -1 && !/:/.test(line) && t.length >= 2 && t.length <= 5 && t.every((x) => /^[A-Za-z().\/&'-]{1,16}$/.test(x) && !QUAL.test(x)) && /^[A-Z]/.test(t[0])) t = [t.join(' ')]
  // value and unit written together: "180.mg/dl", "7.4gm%"
  if (t.length >= 2) {
    const g = /^(\d[\d,]*(?:\.\d+)?)\.?\s*([A-Za-z%\/][A-Za-z0-9%\/.]*)$/.exec(t[1])
    if (g) t = [t[0], g[1], g[2], ...t.slice(2)]
  }
  // "Label   Negative   Negative" written with single spaces in one cell
  if (t.length === 1) {
    const q = /^(.+?)\s+(negative|positive|reactive|non[- ]?reactive)(?:\s+(negative|non[- ]?reactive|nil))?\s*\.?$/i.exec(t[0])
    if (q && q[1].length > 3) t = [q[1].replace(/\s*:$/, ''), q[2], ...(q[3] ? [q[3]] : [])]
  }
  return t
}

const isNum = (s: string) => NUM_RE.test(s.trim())
const hasLetters = (s: string) => /[A-Za-z]/.test(s)

function normValue(v: string): string {
  let s = v.replace(/^["']|["']$/g, '').trim()
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  if (/^0\d+$/.test(s)) s = String(parseInt(s, 10))
  if (/^(negative|positive|reactive|non[- ]?reactive|nil|trace)$/i.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace('non reactive', 'Non-reactive').replace('non-reactive', 'Non-reactive').replace('nonreactive', 'Non-reactive')
  return s
}

function parseDate(s: string): string | null {
  const m = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/.exec(s)
  if (!m) return null
  let [, d, mo, y] = m
  if (y.length === 2) y = '20' + y
  const yy = +y, mm = +mo, dd = +d
  if (yy < 2005 || yy > 2035 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

function parseTitleName(raw: string): { title: string; name: string } {
  const s = raw.replace(/\s+/g, ' ').replace(/[_.]+$/g, '').trim()
  const m = /^(mrs|mr|miss|mst|ms|master|baby|b\/o|smt|shri|dr)(?![a-z])\.?\s*(.*)$/i.exec(s)
  let title = ''
  let name = s
  if (m && m[2]) {
    const t = m[1].toLowerCase()
    title = t === 'mst' || t === 'master' ? 'Master' : t === 'mr' || t === 'shri' ? 'Mr' : t === 'mrs' || t === 'smt' ? 'Mrs' : t === 'miss' || t === 'ms' ? 'Miss' : t === 'baby' || t === 'b/o' ? 'Baby' : ''
    name = m[2].trim()
  }
  const titleCase = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
  return { title, name: titleCase }
}

function cleanDoctor(s: string): string {
  const t = s.replace(/\s+/g, ' ').replace(/[|:]+$/g, '').trim()
  if (!t || /^(dr\.?\s*)?self$/i.test(t)) return 'Self'
  return t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/^Dr\.?\s*/, 'Dr. ')
}

function splitPages(lines: string[]): string[][] {
  const pages: string[][] = []
  let cur: string[] = []
  const isName = (l: string) => /^\s*Name\s*:|Name of The Patient/i.test(l.replace(/	/g, ' ').replace(/^[\s|]+/, ''))
  for (const l of lines) {
    if (isName(l) && cur.some(isName)) {
      // the clinic header lines just above belong to the new page
      const back: string[] = []
      while (cur.length && /K\.?\s*D\.?\s*S\.?\s*PATHOLOGY|Computrised|Sardarganj|^[\s	-]*$/i.test(cur[cur.length - 1]) && back.length < 6) back.unshift(cur.pop()!)
      pages.push(cur)
      cur = back
    }
    cur.push(l)
  }
  pages.push(cur)
  return pages.filter((p) => p.some((l) => /Name/i.test(l)))
}

interface Header {
  title: string
  name: string
  sex: 'M' | 'F' | null
  age: { years: number; months: number; days: number }
  date: string | null
  doctor: string
  specimen: string
  layout: 'name-ref' | 'old'
  bodyStart: number
}

function parseHeader(page: string[]): Header | null {
  const head = page.filter((l) => l.replace(/[\s|	]/g, '').length > 0).slice(0, 16)
  const flat = clean(head.join(' ')).replace(/[\t|]/g, ' ').replace(/\s+/g, ' ')
  let layout: Header['layout'] = 'name-ref'
  let rawName = ''
  let doctor = ''
  let date: string | null = null
  let specimen = ''
  let sex: 'M' | 'F' | null = null
  const age = { years: 0, months: 0, days: 0 }

  if (/Name of The Patient/i.test(flat)) {
    layout = 'old'
    rawName = /Name of The Patient\s*:?\s*(.+?)\s*(?:Received on|Reported on|Ref\.?\s*By|$)/i.exec(flat)?.[1] ?? ''
    doctor = /Ref\.?\s*By\.?\s*:?\s*(.+?)\s*(?:Reported on|Received on|Investigation|$)/i.exec(flat)?.[1] ?? ''
    date = parseDate(/Received on\s*:?\s*([\d\/\-. ]+)/i.exec(flat)?.[1] ?? '') ?? parseDate(/Reported on\s*:?\s*([\d\/\-. ]+)/i.exec(flat)?.[1] ?? '')
    specimen = /Investigation Required\s*:?\s*([A-Za-z ]+?)(?:\s+Age|$)/i.exec(flat)?.[1]?.trim() ?? 'Blood'
    const am = /Age\s*\/\s*Sex\s*:?\s*(\d+)\s*([YMD])?[a-z]*\s*\/?\s*([MF])\b/i.exec(flat)
    if (am) {
      const n = +am[1]
      const u = (am[2] ?? 'Y').toUpperCase()
      if (u === 'Y') age.years = n
      else if (u === 'M') age.months = n
      else age.days = n
      sex = am[3].toUpperCase() as 'M' | 'F'
    }
  } else {
    rawName = /Name\s*:\s*(.+?)(?=\s*(?:\/\s*)?Ref\s*\.?\s*By|\s+Age\b|$)/i.exec(flat)?.[1] ?? ''
    doctor = /Ref\s*\.?\s*By\s*:\s*(.+?)(?=\s*(?:\/\s*)?(?:Age\b|Sex\b|Date\b|Specimen\b)|$)/i.exec(flat)?.[1] ?? ''
    date = parseDate(/Date\s*:\s*([\d\/\-. ]+)/i.exec(flat)?.[1] ?? '')
    specimen = /Specimen\s*:\s*([A-Za-z ]+?)(?=\s*(?:Test Asked|$|\/|H\s*A\s*E|S\s*E\s*R|B\s*I\s*O|U\s*r\s*o))/i.exec(flat)?.[1]?.trim() ?? 'Blood'
    const ym = /(\d+)\s*(?:Years?|Yrs?)\b/i.exec(flat)
    const mm = /(\d+)\s*Months?\b/i.exec(flat)
    const dm = /(\d+)\s*Days?\b/i.exec(flat)
    if (ym) age.years = +ym[1]
    if (mm) age.months = +mm[1]
    if (dm) age.days = +dm[1]
    const sm = /\b(FEMALE|MALE)\b/i.exec(flat.slice(flat.search(/Sex|Age/i) >= 0 ? flat.search(/Sex|Age/i) : 0))
    if (sm) sex = sm[1].toUpperCase().startsWith('F') ? 'F' : 'M'
  }
  rawName = rawName.replace(/\s*(Ref|Age|Sex)\b.*$/i, '').trim()
  if (!rawName || !date) return null
  const { title, name } = parseTitleName(rawName)
  if (!name) return null
  // body starts after the last header-ish line within the first lines
  let bodyStart = 0
  for (let i = 0; i < Math.min(page.length, 45); i++) {
    if (/Specimen|Investigation Required|Test Asked|Age\s*\/\s*Sex|Reported on|Date\s*:/i.test(page[i])) bodyStart = i + 1
  }
  if (!sex) {
    if (title === 'Mr' || title === 'Master') sex = 'M'
    else if (title === 'Mrs' || title === 'Miss') sex = 'F'
  }
  return { title, name, sex, age, date, doctor: cleanDoctor(doctor), specimen: specimen || 'Blood', layout, bodyStart }
}

interface Ctx {
  section: string
  heading: string
  urine: boolean
}

function parseBody(page: string[], start: number, specimen: string, rows: ParsedRow[], skipped: string[]) {
  const ctx: Ctx = { section: /urine/i.test(specimen) ? 'URINE EXAMINATION' : 'HAEMATOLOGY', heading: '', urine: /urine/i.test(specimen) }
  const labelStack: string[] = []
  let groupLabel = ''
  let last: ParsedRow | null = null
  let ended = false

  const push = (label: string, value: string, unit: string, range: string) => {
    const code = mapName(label, ctx.urine)
    const info = code ? PANEL_OF_CODE.get(code) : undefined
    const row: ParsedRow = {
      section: info?.section ?? ctx.section,
      panel: info?.panel ?? (ctx.heading || 'Other results'),
      label: label.trim(),
      value: normValue(value),
      unit: unit.trim(),
      range: range.trim(),
      code
    }
    rows.push(row)
    last = row
  }

  // flattened view for the Widal grid, which is spread over many table cells
  const body = page.slice(start)
  const widalAt = body.findIndex((l) => /widal/i.test(l))

  for (let i = 0; i < body.length; i++) {
    const raw = body[i]
    if (ended) break
    if (/Dr\.?\s*Manoj|Ram Vivek|Not valid for medico/i.test(raw)) { ended = true; break }
    if (widalAt >= 0 && i > widalAt && /salmonella|titer|titre|antigen|1\s*:\s*\d+/i.test(raw)) continue // handled below
    if (widalAt >= 0 && i > widalAt && /^[\s+\-−–|]*$/.test(raw)) continue

    const t = tokens(raw)
    if (!t.length) continue
    const text = t.join(' ')

    // blood group + Rh on one line: BLOOD GROUP : 'B'  Rh. Positive
    const bg = /BLOOD GROUP\s*:?\s*['"]?\s*(AB|A|B|O)\s*['"]?\s*(?:Rh\.?\s*(?:Factor)?\s*:?\s*['"]?\s*(Positive|Negative))?/i.exec(clean(raw))
    if (bg) {
      push('ABO Blood Group', bg[1].toUpperCase(), '', '')
      if (bg[2]) push('Rh Factor', bg[2], '', '')
      continue
    }

    // section / panel headings: letter-spaced or all-caps single tokens
    const compact = text.replace(/\s+/g, '')
    const spaced = /^([A-Za-z]\s){3,}[A-Za-z]$/.test(text.replace(/\s{2,}/g, ' '))
    if ((t.length === 1 || spaced) && /^\d[\d.]*\s*[-–]\s*\d[\d.]*\s*\(?[MF]\)?$/i.test(t[0]) && last) {
      ;(last as ParsedRow).range += ` / ${t[0]}`
      continue
    }
    if (t.length === 1 || spaced) {
      const sec = sectionOf(spaced ? compact : text)
      const isHeading = spaced || /^[A-Z0-9 .&\/()'-]{4,}$/.test(t[0]) || /examination|function test|profile|test report$/i.test(t[0])
      if (isHeading && !BLACKLIST.test(t[0])) {
        if (sec) { ctx.section = sec; ctx.urine = sec === 'URINE EXAMINATION' }
        if (/physical|chemical|microscopic/i.test(t[0])) { ctx.urine = true; ctx.section = 'URINE EXAMINATION' }
        ctx.heading = spaced ? compact : t[0]
        labelStack.length = 0
        continue
      }
      // plain label waiting for its value on a following line
      if (hasLetters(t[0]) && !isNum(t[0]) && !/^qualitative$/i.test(t[0])) {
        // continuation of a range such as "0.6 - 1.3(F)" never contains letters except M/F
        labelStack.push(t[0])
        if (labelStack.length > 3) labelStack.shift()
        if (/bilirubin|protein/i.test(t[0])) groupLabel = t[0]
      }
      continue
    }

    // continuation of a wrapped label: "Mean Cell Haemoglobin" / "Concentration (M.C.H.C)  30.3 % 32-38"
    let label = t[0]
    let rest = t.slice(1)
    if (/^total$/i.test(label) && groupLabel) label = `${groupLabel} total`
    if (/^concentration/i.test(label) && labelStack.length) label = `${labelStack[labelStack.length - 1]} ${label}`

    // result line whose label sits on an earlier line: "Result : NEGATIVE" or "13.1  gm %  11-16"
    if (/^results?$/i.test(label) || (isNum(label) && labelStack.length)) {
      const pending = labelStack.filter((x) => !/^(qualitative|test name)$/i.test(x)).pop()
      if (pending) {
        const vals = /^results?$/i.test(label) ? rest : t
        if (vals.length) {
          const [value, ...tail] = vals
          const { unit, range } = unitRange(tail)
          push(pending, value, unit, range)
          labelStack.length = 0
        }
        continue
      }
    }

    if (!rest.length) continue
    if (BLACKLIST.test(label.replace(/\s+/g, ' ').trim())) {
      // "Test Name : Malaria ..." keeps the name as a pending label
      if (/^test name$/i.test(label) && rest[0]) labelStack.push(rest[0])
      continue
    }
    if (!hasLetters(label) || isNum(label)) { if (t.length > 1 && /\d/.test(raw)) skipped.push(raw.trim().slice(0, 80)); continue }
    if (/^(received|reported|investigation|age|ref|name of|mob|add|pt)/i.test(label)) continue

    const value = rest[0]
    const { unit, range } = unitRange(rest.slice(1))
    const code = mapName(label, ctx.urine)
    // unknown labels must at least carry a number; mapped labels may carry words ("Negative", "Nil")
    if (!code && !(isNum(value) || /^\d+\s*[-–]\s*\d+$/.test(value) || (QUAL.test(value) && rest.length >= 2))) {
      if (!/^(result|observed)/i.test(value) && /\d/.test(raw)) skipped.push(raw.trim().slice(0, 80))
      continue
    }
    if (code && !isNum(value) && !/^\d+\s*[-–]\s*\d+$/.test(value) && value.length > 40) continue
    push(label, value, unit, range)
    labelStack.length = 0
  }

  // Widal grid
  if (widalAt >= 0) {
    const cells = clean(body.slice(widalAt).join(' | ')).replace(/\t/g, ' ').split('|').map((x) => x.trim()).filter(Boolean)
    for (let i = 0; i < cells.length; i++) {
      const m = /Salmonella\s+(Typhi|Paratyphi)\s*['"]?\s*(O|H|AH|BH)\b/i.exec(cells[i])
      if (!m) continue
      const syms: string[] = []
      for (let j = i + 1; j < cells.length && syms.length < 5; j++) {
        if (/^[+\-−–]$/.test(cells[j])) syms.push(cells[j])
        else if (/salmonella/i.test(cells[j])) break
      }
      if (syms.length === 5) {
        let hi = 0
        syms.forEach((s, k) => { if (s === '+') hi = [20, 40, 80, 160, 320][k] })
        const code = { O: 'wo', H: 'wh', AH: 'wah', BH: 'wbh' }[m[2].toUpperCase() as 'O' | 'H' | 'AH' | 'BH']
        const info = PANEL_OF_CODE.get(code)!
        rows.push({ section: info.section, panel: info.panel, label: `Salmonella ${m[1]} '${m[2].toUpperCase()}'`, value: String(hi), unit: 'titre', range: '', code })
      }
    }
  }
}

function unitRange(tail: string[]): { unit: string; range: string } {
  if (!tail.length) return { unit: '', range: '' }
  const first = tail[0]
  const looksRange = /\d/.test(first) && /[-–<>]|^\d/.test(first) && !/^[A-Za-z]/.test(first)
  if (looksRange || !UNIT_RE.test(first) || QUAL.test(first)) return { unit: '', range: tail.join(' ') }
  return { unit: first, range: tail.slice(1).join(' ') }
}

/** Parse the text lines of one old report file. */
export function parseReport(lines: string[]): ParseResult {
  const all = lines.join('\n')
  if (/thyrocare/i.test(all)) return { visits: [], thyrocare: true, reason: 'Thyrocare report (sent-out test)' }
  const pages = splitPages(lines)
  if (!pages.length) return { visits: [], thyrocare: false, reason: 'No patient header (Name / Ref. By) found: not a lab report' }

  const byKey = new Map<string, ParsedVisit>()
  const reasons: string[] = []
  for (const page of pages) {
    const h = parseHeader(page)
    if (!h || !h.date) { reasons.push('page without readable name/date'); continue }
    const key = `${normalizeLabel(h.name)}|${h.date}`
    let v = byKey.get(key)
    if (!v) {
      v = { title: h.title, name: h.name, sex: h.sex, age: h.age, date: h.date, doctor: h.doctor, specimen: h.specimen, layout: h.layout, rows: [], skipped: [], notes: [] }
      byKey.set(key, v)
    } else {
      if (!v.sex && h.sex) v.sex = h.sex
      if (v.age.years + v.age.months + v.age.days === 0) v.age = h.age
      if (!/urine|blood/i.test(v.specimen) && h.specimen) v.specimen = h.specimen
    }
    const rows: ParsedRow[] = []
    parseBody(page, h.bodyStart, h.specimen, rows, v.skipped)
    for (const r of rows) {
      const k = `${r.code ?? normalizeLabel(r.label)}|${r.section}`
      const existing = v.rows.find((x) => `${x.code ?? normalizeLabel(x.label)}|${x.section}` === k)
      if (!existing) v.rows.push(r)
      else if (existing.value !== r.value) v.skipped.push(`${r.label}: second value ${r.value} differs from ${existing.value}`)
    }
  }
  const visits = [...byKey.values()]
  for (const v of visits) {
    if (v.sex) {
      if ((v.title === 'Mr' || v.title === 'Master') && v.sex === 'F') v.notes.push('Original report says "' + v.title + '." but sex FEMALE')
      if ((v.title === 'Mrs' || v.title === 'Miss') && v.sex === 'M') v.notes.push('Original report says "' + v.title + '." but sex MALE')
    }
  }
  const withRows = visits.filter((v) => v.rows.length > 0)
  if (!withRows.length) return { visits: [], thyrocare: false, reason: reasons[0] ?? 'Patient found but no test results could be recognised' }
  return { visits: withRows, thyrocare: false, reason: '' }
}
