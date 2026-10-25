import { computeCalc, parseNum, relativeDiff, CALCS } from './calc'
import { evaluate, type Evaluation } from './ranges'
import { deltaIssues, type PreviousResult } from './delta'
import type { Issue, PanelDef, ParamDef, ResultMap, Sex } from './types'

export interface Row {
  panel: PanelDef
  param: ParamDef
  value: string
  auto: boolean
  eval: Evaluation
}

export interface Resolved {
  rows: Row[]
  /** the values to store: typed ones plus auto-calculated ones */
  values: ResultMap
  issues: Issue[]
  /** calculated value per calc parameter (null when inputs are missing), for showing as a placeholder */
  calculated: Record<string, string | null>
}

export const CALC_TOLERANCE = 0.1

/**
 * Turn what was typed into final rows: fill auto-calculations, flag high/low, and collect problems.
 * `typed` maps parameter code → string typed by the user (calculated fields may be empty).
 */
export interface DeltaContext {
  /** the patient's most recent earlier result per parameter */
  previous: Record<string, PreviousResult>
  /** date of this visit, YYYY-MM-DD */
  refDate: string
}

export function resolveResults(panels: PanelDef[], typed: Record<string, string>, sex: Sex, ageDays: number, delta?: DeltaContext): Resolved {
  const rows: Row[] = []
  const values: ResultMap = {}
  const issues: Issue[] = []
  const calculated: Record<string, string | null> = {}

  const typedNum = (code: string) => {
    const p = findParam(panels, code)
    if (!p || p.calc) return null
    return parseNum(typed[code])
  }

  for (const panel of panels) {
    for (const param of panel.params) {
      let value = (typed[param.code] ?? '').trim()
      let auto = false
      if (param.calc && CALCS[param.calc]) {
        const c = computeCalc(param.calc, (code) => typedNum(code))
        calculated[param.code] = c == null ? null : c.toFixed(param.decimals)
        if (value === '') {
          if (c != null) {
            value = c.toFixed(param.decimals)
            auto = true
          }
        } else {
          const t = parseNum(value)
          if (t != null && c != null && relativeDiff(t, c) > CALC_TOLERANCE) {
            issues.push({
              severity: 'warn', code: 'calc_mismatch', paramCode: param.code,
              message: `${param.name}: typed ${value} differs by more than 10% from the calculated ${c.toFixed(param.decimals)}. Please check Hb, PCV and RBC.`
            })
          }
        }
      }
      const ev = evaluate(param, value, sex, ageDays)
      if (ev.state === 'invalid') {
        issues.push({ severity: 'error', code: ev.implausible ? 'implausible' : 'invalid', paramCode: param.code, message: `${param.name}: ${ev.message}` })
      }
      if (ev.critical) {
        issues.push({ severity: 'critical', code: 'critical', paramCode: param.code, message: `CRITICAL: ${param.name} ${value} ${param.unit}`.trim() })
      }
      if (value !== '') values[param.code] = { value, auto }
      rows.push({ panel, param, value, auto, eval: ev })
    }
  }

  issues.push(...dlcIssues(values))
  if (delta) issues.push(...deltaIssues(values, delta.previous, delta.refDate))
  return { rows, values, issues, calculated }
}

function findParam(panels: PanelDef[], code: string): ParamDef | undefined {
  for (const p of panels) for (const q of p.params) if (q.code === code) return q
  return undefined
}

export const DLC_REQUIRED = ['neut', 'lymph', 'eos', 'mono', 'baso']

export function dlcIssues(values: ResultMap): Issue[] {
  const all = [...DLC_REQUIRED, 'band']
  const present = all.filter((c) => (values[c]?.value ?? '') !== '')
  if (!present.length) return []
  const missing = DLC_REQUIRED.filter((c) => (values[c]?.value ?? '') === '')
  if (missing.length) {
    return [{ severity: 'error', code: 'dlc_incomplete', message: 'DLC: fill all five differential counts (type 0 where none).' }]
  }
  const sum = Math.round(all.reduce((s, c) => s + (parseNum(values[c]?.value) ?? 0), 0) * 100) / 100
  const diff = Math.abs(sum - 100)
  if (diff === 0) return []
  return [{
    severity: 'error', code: 'dlc_sum',
    message: `DLC adds up to ${sum}, it must total 100.`
  }]
}

/** Signature of the measured numbers in a panel; used to catch identical result sets across patients. */
export function panelSignature(panel: PanelDef, values: ResultMap): string | null {
  const nums: string[] = []
  for (const p of panel.params) {
    const v = values[p.code]
    if (!v || v.auto) continue
    if (p.type !== 'numeric') continue
    const n = parseNum(v.value)
    if (n != null) nums.push(String(n))
  }
  return nums.length >= 3 ? `${panel.code}:${nums.join('|')}` : null
}

export function allSignatures(panels: PanelDef[], values: ResultMap): { panelCode: string; signature: string }[] {
  const out: { panelCode: string; signature: string }[] = []
  for (const panel of panels) {
    const s = panelSignature(panel, values)
    if (s) out.push({ panelCode: panel.code, signature: s })
  }
  return out
}

export function worstSeverity(issues: Issue[]): 'error' | 'critical' | 'warn' | null {
  if (issues.some((i) => i.severity === 'error')) return 'error'
  if (issues.some((i) => i.severity === 'critical')) return 'critical'
  if (issues.some((i) => i.severity === 'warn')) return 'warn'
  return null
}
