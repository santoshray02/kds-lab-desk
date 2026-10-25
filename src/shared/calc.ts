/** Auto-calculated parameters. Inputs refer to parameter codes. */
export interface CalcDef {
  inputs: string[]
  decimals: number
  fn: (v: Record<string, number>) => number | null
}

export const CALCS: Record<string, CalcDef> = {
  mcv: { inputs: ['pcv', 'rbc'], decimals: 1, fn: (v) => (v.rbc > 0 ? (v.pcv / v.rbc) * 10 : null) },
  mch: { inputs: ['hb', 'rbc'], decimals: 1, fn: (v) => (v.rbc > 0 ? (v.hb / v.rbc) * 10 : null) },
  mchc: { inputs: ['hb', 'pcv'], decimals: 1, fn: (v) => (v.pcv > 0 ? (v.hb / v.pcv) * 100 : null) },
  ibili: { inputs: ['tbili', 'dbili'], decimals: 2, fn: (v) => (v.tbili >= v.dbili ? v.tbili - v.dbili : null) },
  globulin: { inputs: ['tprot', 'albumin'], decimals: 2, fn: (v) => (v.tprot > v.albumin ? v.tprot - v.albumin : null) },
  agratio: {
    inputs: ['tprot', 'albumin'],
    decimals: 2,
    fn: (v) => (v.tprot > v.albumin ? v.albumin / (v.tprot - v.albumin) : null)
  },
  vldl: { inputs: ['tg'], decimals: 1, fn: (v) => v.tg / 5 },
  // Friedewald is not valid when triglycerides exceed 400 mg/dL
  ldl: {
    inputs: ['tchol', 'hdl', 'tg'],
    decimals: 1,
    fn: (v) => (v.tg <= 400 ? v.tchol - v.hdl - v.tg / 5 : null)
  },
  tc_hdl: { inputs: ['tchol', 'hdl'], decimals: 2, fn: (v) => (v.hdl > 0 ? v.tchol / v.hdl : null) },
  ldl_hdl: {
    inputs: ['tchol', 'hdl', 'tg'],
    decimals: 2,
    fn: (v) => (v.hdl > 0 && v.tg <= 400 ? (v.tchol - v.hdl - v.tg / 5) / v.hdl : null)
  }
}

export function parseNum(s: string | undefined | null): number | null {
  if (s == null) return null
  const t = String(s).trim().replace(/,/g, '')
  if (t === '' || !/^[-+]?\d*\.?\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Value of a calculated parameter from the typed numbers, or null when inputs are missing. */
export function computeCalc(calcId: string, get: (code: string) => number | null): number | null {
  const def = CALCS[calcId]
  if (!def) return null
  const inputs: Record<string, number> = {}
  for (const code of def.inputs) {
    const n = get(code)
    if (n == null) return null
    inputs[code] = n
  }
  const out = def.fn(inputs)
  if (out == null || !Number.isFinite(out) || out < 0) return null
  return Number(out.toFixed(def.decimals))
}

/** Relative difference between typed (analyzer) and calculated value. */
export function relativeDiff(typed: number, calculated: number): number {
  if (calculated === 0) return typed === 0 ? 0 : Infinity
  return Math.abs(typed - calculated) / Math.abs(calculated)
}
