import { parseNum } from './calc'
import type { Flag, ParamDef, RangeRow, Sex } from './types'

/** Choose the range row for a patient: sex-specific beats "all", and it must fit the age band. */
export function selectRange(ranges: RangeRow[], sex: Sex, ageDays: number): RangeRow | null {
  const fits = ranges.filter((r) => ageDays >= r.ageMinDays && ageDays < r.ageMaxDays)
  if (!fits.length) return null
  const exact = fits.find((r) => r.sex === sex && sex !== 'O')
  if (exact) return exact
  const all = fits.find((r) => r.sex === 'A')
  if (all) return all
  // sex unknown and only sex-specific ranges exist: fall back to the first one
  return fits[0]
}

function trimNum(n: number, decimals: number): string {
  // keep the master's own precision (11.5, 4000) without trailing zeros past it
  const s = n.toFixed(decimals)
  return decimals > 0 ? s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '') : s
}

/** "2:35" (min:sec) or plain minutes "2.5" → seconds. */
export function parseDuration(s: string): number | null {
  const t = s.trim()
  const m = /^(\d+):([0-5]?\d)$/.exec(t)
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  const n = parseNum(t)
  return n == null ? null : Math.round(n * 60)
}
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s ? `${m} min ${String(s).padStart(2, '0')} sec` : `${m} min`
}

export function rangeText(p: Pick<ParamDef, 'decimals' | 'type' | 'normal'>, r: RangeRow | null): string {
  if (!r) {
    if ((p.type === 'select' || p.type === 'text') && p.normal.length) return p.normal.join(' / ')
    return ''
  }
  if (r.text) return r.text
  const fmt = (n: number) => (p.type === 'duration' ? formatDuration(n) : trimNum(n, p.decimals))
  if (r.low != null && r.high != null) return `${fmt(r.low)} – ${fmt(r.high)}`
  if (r.high != null) return `< ${fmt(r.high)}`
  if (r.low != null) return `> ${fmt(r.low)}`
  return ''
}

export interface Evaluation {
  state: 'empty' | 'ok' | 'invalid'
  number: number | null
  flag: Flag
  critical: boolean
  implausible: boolean
  range: RangeRow | null
  rangeText: string
  message?: string
}

export function evaluate(p: ParamDef, raw: string | undefined, sex: Sex, ageDays: number): Evaluation {
  const range = selectRange(p.ranges, sex, ageDays)
  const base: Evaluation = {
    state: 'empty', number: null, flag: null, critical: false, implausible: false,
    range, rangeText: rangeText(p, range)
  }
  const v = (raw ?? '').trim()
  if (v === '') return base

  if (p.type === 'select' || p.type === 'text') {
    const flagged = p.normal.length > 0 && !p.normal.some((n) => n.toLowerCase() === v.toLowerCase())
    return { ...base, state: 'ok', flag: flagged ? 'A' : null }
  }

  const n = p.type === 'duration' ? parseDuration(v) : parseNum(v)
  if (n == null) return { ...base, state: 'invalid', message: 'Type a number' }

  // plausibility / critical limits are in the parameter's own unit (minutes for durations)
  const plain = p.type === 'duration' ? n / 60 : n
  if ((p.plausibleMin != null && plain < p.plausibleMin) || (p.plausibleMax != null && plain > p.plausibleMax)) {
    return { ...base, state: 'invalid', number: n, implausible: true, message: 'Value is not possible — please re-check' }
  }

  let flag: Flag = null
  if (range && !range.text) {
    if (range.low != null && n < range.low) flag = 'L'
    else if (range.high != null && n > range.high) flag = 'H'
  }
  const critical =
    (p.criticalLow != null && plain < p.criticalLow) || (p.criticalHigh != null && plain > p.criticalHigh)
  return { ...base, state: 'ok', number: n, flag, critical }
}
