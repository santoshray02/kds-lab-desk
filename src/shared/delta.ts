import { parseNum } from './calc'
import type { Issue, ResultMap } from './types'

/** A previous result of the same patient: value, visit date (YYYY-MM-DD) and sample ID. */
export interface PreviousResult {
  value: string
  date: string
  sampleId: string
}

/**
 * Largest change (in %) from the patient's last result that is believable between two visits.
 * A bigger jump is far more often a wrong sample, a typing slip or a mix-up than real biology.
 */
export const DELTA_PCT: Record<string, number> = {
  hb: 25, rbc: 25, pcv: 25, plt: 50, tlc: 60,
  rbs: 60, fbs: 50, ppbs: 60, hba1c: 20,
  creat: 50, urea: 60, uric: 50, k: 20, na: 5, cl: 8, k_e: 20, na_e: 5, cl_e: 8,
  sgpt: 100, sgot: 100, tbili: 100, alp: 60,
  tchol: 40, tg: 70, hdl: 40
}

/** Only compare with results this recent; older ones can really have changed. */
export const DELTA_WINDOW_DAYS = 90

const NAMES: Record<string, string> = {
  hb: 'Haemoglobin', rbc: 'RBC count', pcv: 'PCV', plt: 'Platelets', tlc: 'TLC', rbs: 'Random sugar', fbs: 'Fasting sugar', ppbs: 'PP sugar',
  hba1c: 'HbA1c', creat: 'Creatinine', urea: 'Urea', uric: 'Uric acid', k: 'Potassium', na: 'Sodium', cl: 'Chloride', k_e: 'Potassium', na_e: 'Sodium',
  cl_e: 'Chloride', sgpt: 'SGPT', sgot: 'SGOT', tbili: 'Bilirubin', alp: 'ALP', tchol: 'Cholesterol', tg: 'Triglycerides', hdl: 'HDL'
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}
const dmy = (iso: string) => iso.split('-').reverse().join('/')

/** Warnings (never blocking) for results that jumped a lot since the patient's last visit. */
export function deltaIssues(values: ResultMap, previous: Record<string, PreviousResult> | undefined, refDate: string): Issue[] {
  if (!previous || !refDate) return []
  const out: Issue[] = []
  for (const [code, limit] of Object.entries(DELTA_PCT)) {
    const cur = values[code]
    const prev = previous[code]
    if (!cur || cur.auto || !prev) continue
    const now = parseNum(cur.value)
    const before = parseNum(prev.value)
    if (now == null || before == null || before === 0) continue
    const age = dayNumber(refDate) - dayNumber(prev.date)
    if (age < 0 || age > DELTA_WINDOW_DAYS) continue
    const pct = Math.round(((now - before) / Math.abs(before)) * 100)
    if (Math.abs(pct) <= limit) continue
    out.push({
      severity: 'warn', code: 'delta', paramCode: code,
      message: `${NAMES[code] ?? code} ${cur.value} is ${Math.abs(pct)}% ${pct < 0 ? 'lower' : 'higher'} than ${prev.value} on ${dmy(prev.date)} (sample ${prev.sampleId}). Check that it is the right sample and the right number.`
    })
  }
  return out
}
