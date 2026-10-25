export type Sex = 'M' | 'F' | 'O'
export type ParamType = 'numeric' | 'select' | 'text' | 'titre' | 'duration'
export type Flag = 'H' | 'L' | 'A' | null

export interface RangeRow {
  sex: 'M' | 'F' | 'A'
  ageMinDays: number
  ageMaxDays: number
  low: number | null
  high: number | null
  /** free-text range shown instead of the numeric one, e.g. "Negative" */
  text?: string | null
}

export interface ParamDef {
  id: number
  panelId: number
  code: string
  name: string
  type: ParamType
  unit: string
  decimals: number
  options: string[]
  /** values that count as normal for select/text params */
  normal: string[]
  calc: string | null
  group: string | null
  sort: number
  plausibleMin: number | null
  plausibleMax: number | null
  criticalLow: number | null
  criticalHigh: number | null
  ranges: RangeRow[]
  rangeVersion: number
}

export interface PanelDef {
  id: number
  code: string
  name: string
  section: string
  price: number
  specimen: string
  sort: number
  sentOut: boolean
  active: boolean
  bundleCodes: string[]
  params: ParamDef[]
}

export interface AgeInput {
  years: number
  months: number
  days: number
}

export interface ResultValue {
  value: string
  /** true when the value was calculated by the program, not typed */
  auto?: boolean
}
export type ResultMap = Record<string, ResultValue>

export type IssueSeverity = 'error' | 'warn' | 'critical'
export interface Issue {
  severity: IssueSeverity
  code: string
  paramCode?: string
  message: string
}

export const CHILD_MAX_DAYS = 12 * 365
export const MAX_AGE_DAYS = 120 * 366
