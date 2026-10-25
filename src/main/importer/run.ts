import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { allSignatures } from '../../shared/checks'
import { parseNum } from '../../shared/calc'
import type { PanelDef, ResultMap } from '../../shared/types'
import { audit, nowIso, type Db } from '../db'
import { loadMaster } from '../master'
import { touchDoctor } from '../patients'
import { extractLines } from './extract'
import { parseReport, type ParsedVisit } from './parse'

export interface ImportProgress {
  done: number
  total: number
  file: string
}

export interface ImportSummary {
  total: number
  imported: number
  visits: number
  newPatients: number
  alreadyImported: number
  sentOut: number
  unparsed: number
}

const EXTS = new Set(['.doc', '.docx', '.pdf'])

export function listReportFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (EXTS.has(extname(e.name).toLowerCase()) && !e.name.startsWith('~$')) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/** Flag from the range printed on the old report (it never marked abnormal values itself). */
export function flagFromPrinted(value: string, range: string): 'H' | 'L' | null {
  const n = parseNum(value)
  if (n == null || !range || /\([MF]\)|male|female/i.test(range)) return null
  const clean = range.replace(/,/g, '')
  const pair = /(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)/.exec(clean)
  if (pair) {
    const lo = Number(pair[1])
    const hi = Number(pair[2])
    if (hi > lo && hi < lo * 100) return n < lo ? 'L' : n > hi ? 'H' : null
  }
  const lt = /^\s*<\s*=?\s*(\d+(?:\.\d+)?)/.exec(clean)
  if (lt) return n > Number(lt[1]) ? 'H' : null
  return null
}

function findPatient(db: Db, v: ParsedVisit): number | null {
  const rows = db.all<any>("SELECT p.id, v.age_y, v.visit_date FROM patients p JOIN visits v ON v.patient_id = p.id WHERE p.source = 'imported' AND lower(p.name) = lower(?) AND p.sex = ? ORDER BY v.visit_date DESC", v.name, v.sex ?? 'O')
  const thisYears = v.age.years + v.age.months / 12
  for (const r of rows) {
    const gap = (new Date(v.date).getTime() - new Date(r.visit_date).getTime()) / (365.25 * 86400000)
    if (Math.abs(r.age_y + gap - thisYears) <= 2.5) return r.id
  }
  return null
}

function importVisit(db: Db, v: ParsedVisit, file: string, master: PanelDef[]): { visitId: number; newPatient: boolean } {
  const sex = v.sex ?? 'O'
  let pid = findPatient(db, v)
  const newPatient = pid == null
  const now = nowIso()
  if (pid == null) {
    pid = db.run('INSERT INTO patients(name, title, sex, phone, village, source, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', v.name, v.title, sex, '', '', 'imported', now, now).lastId
  }
  const yymm = v.date.slice(2, 4) + v.date.slice(5, 7)
  const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM visits WHERE sample_id LIKE ?', `I${yymm}-%`)!.n
  const sampleId = `I${yymm}-${String(n + 1).padStart(3, '0')}`
  const visitId = db.run(
    `INSERT INTO visits(patient_id, sample_id, visit_date, age_y, age_m, age_d, doctor, specimen, total, discount, notes, source, import_ref, created_at)
     VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,?)`,
    pid, sampleId, v.date, v.age.years, v.age.months, v.age.days, v.doctor || 'Self', v.specimen || 'Blood', v.notes.join('; '), 'imported', file, now
  ).lastId
  if (v.doctor) touchDoctor(db, v.doctor)

  const byCode = new Map<string, { panel: PanelDef; param: PanelDef['params'][number]; pi: number; qi: number }>()
  master.forEach((p, pi) => p.params.forEach((q, qi) => byCode.set(q.code, { panel: p, param: q, pi, qi })))

  const reportId = db.run("INSERT INTO reports(visit_id, version, status, is_current, created_at, approved_at, approved_by, reason) VALUES(?,?,?,?,?,?,?,?)", visitId, 1, 'imported', 1, now, `${v.date}T00:00:00.000Z`, 'imported', 'Imported from ' + file).lastId
  const panelsSeen = new Set<string>()
  const values: ResultMap = {}
  v.rows.forEach((r, i) => {
    const info = r.code ? byCode.get(r.code) : undefined
    const type = info ? info.param.type : parseNum(r.value) != null ? 'numeric' : 'text'
    const sort = info ? info.pi * 1000 + info.qi : 900000 + i
    const flag = type === 'numeric' || type === 'titre' ? flagFromPrinted(r.value, r.range) : null
    db.run(
      `INSERT INTO report_results(report_id, panel_code, panel_name, section, param_code, name, grp, type, value, unit, range_text, flag, critical, auto, sort)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,0,?)`,
      reportId, info?.panel.code ?? null, info?.panel.name ?? r.panel, info?.panel.section ?? r.section, r.code, info?.param.name ?? r.label,
      info?.param.group ?? null, type, r.value, r.unit, r.range, flag, sort
    )
    const key = info?.panel.code ?? r.panel
    if (!panelsSeen.has(key)) {
      panelsSeen.add(key)
      db.run('INSERT INTO visit_tests(visit_id, panel_id, panel_code, name, price, sent_out) VALUES(?,?,?,?,0,0)', visitId, info?.panel.id ?? null, info?.panel.code ?? 'IMPORTED', info?.panel.name ?? r.panel)
    }
    if (r.code) values[r.code] = { value: r.value }
  })
  for (const s of allSignatures(master, values)) {
    db.run('INSERT INTO result_signatures(report_id, panel_code, signature) VALUES(?,?,?)', reportId, s.panelCode, s.signature)
  }
  return { visitId, newPatient }
}

export async function runImport(db: Db, folder: string, progress: (p: ImportProgress) => void = () => undefined): Promise<ImportSummary> {
  if (!statSync(folder).isDirectory()) throw new Error('Choose a folder')
  const files = listReportFiles(folder)
  const master = loadMaster(db, { includeInactive: true })
  const summary: ImportSummary = { total: files.length, imported: 0, visits: 0, newPatients: 0, alreadyImported: 0, sentOut: 0, unparsed: 0 }
  const runAt = nowIso()
  const log = (file: string, status: string, reason: string, hash: string, visitId: number | null = null) => {
    if (status === 'unparsed') db.run("DELETE FROM import_log WHERE file = ? AND status = 'unparsed'", file)
    db.run('INSERT INTO import_log(run_at, file, status, reason, visit_id, file_hash) VALUES(?,?,?,?,?,?)', runAt, file, status, reason, visitId, hash)
  }

  let done = 0
  for (const path of files) {
    const rel = relative(folder, path).replace(/\\/g, '/')
    progress({ done, total: files.length, file: rel })
    done++
    if (done % 25 === 0) await new Promise((r) => setImmediate(r))
    let buf: Buffer
    try {
      buf = readFileSync(path)
    } catch (e) {
      summary.unparsed++
      log(rel, 'unparsed', `Cannot open the file: ${(e as Error).message}`, '')
      continue
    }
    const hash = createHash('sha1').update(buf).digest('hex')
    const prev = db.get<{ status: string }>("SELECT status FROM import_log WHERE file_hash = ? AND status IN ('imported','sentout') LIMIT 1", hash)
    if (prev) {
      summary.alreadyImported++
      continue
    }
    let result
    try {
      result = parseReport(await extractLines(path, buf))
    } catch (e) {
      summary.unparsed++
      log(rel, 'unparsed', `Cannot read the file contents: ${(e as Error).message}`, hash)
      continue
    }
    if (result.thyrocare) {
      summary.sentOut++
      log(rel, 'sentout', result.reason + '. Not imported; the original lab report stays with the patient.', hash)
      continue
    }
    if (!result.visits.length) {
      summary.unparsed++
      log(rel, 'unparsed', result.reason, hash)
      continue
    }
    try {
      db.tx(() => {
        for (const v of result.visits) {
          const r = importVisit(db, v, rel, master)
          summary.visits++
          if (r.newPatient) summary.newPatients++
          const note = v.skipped.length ? `${v.rows.length} results read; ${v.skipped.length} line(s) not understood: ${v.skipped.slice(0, 3).join(' / ')}` : `${v.rows.length} results read`
          log(rel, 'imported', note, hash, r.visitId)
        }
      })
      summary.imported++
    } catch (e) {
      summary.unparsed++
      log(rel, 'unparsed', `Could not save: ${(e as Error).message}`, hash)
    }
  }
  progress({ done: files.length, total: files.length, file: '' })
  audit(db, 'import.run', 'import', null, JSON.stringify(summary))
  return summary
}

export function importLog(db: Db, status?: string) {
  return db.all<{ id: number; file: string; status: string; reason: string; run_at: string }>(
    `SELECT id, file, status, reason, run_at FROM import_log ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 2000`,
    ...(status ? [status] : [])
  )
}
