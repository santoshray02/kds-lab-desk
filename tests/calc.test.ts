import { describe, expect, it } from 'vitest'
import { computeCalc, parseNum, relativeDiff } from '@shared/calc'

const get = (m: Record<string, number>) => (c: string) => (c in m ? m[c] : null)

describe('calculations', () => {
  it('computes red cell indices from Hb, PCV and RBC', () => {
    const m = { hb: 9.4, pcv: 29.6, rbc: 3.9 }
    expect(computeCalc('mcv', get(m))).toBe(75.9)
    expect(computeCalc('mch', get(m))).toBe(24.1)
    expect(computeCalc('mchc', get(m))).toBe(31.8)
  })
  it('returns null while inputs are missing', () => {
    expect(computeCalc('mcv', get({ pcv: 30 }))).toBeNull()
    expect(computeCalc('mch', get({ hb: 12, rbc: 0 }))).toBeNull()
  })
  it('LFT: globulin, A/G ratio, indirect bilirubin', () => {
    expect(computeCalc('globulin', get({ tprot: 7, albumin: 4 }))).toBe(3)
    expect(computeCalc('agratio', get({ tprot: 7, albumin: 4 }))).toBe(1.33)
    expect(computeCalc('ibili', get({ tbili: 1.2, dbili: 0.3 }))).toBe(0.9)
    expect(computeCalc('globulin', get({ tprot: 3, albumin: 4 }))).toBeNull()
  })
  it('lipid: VLDL and Friedewald LDL', () => {
    expect(computeCalc('vldl', get({ tg: 150 }))).toBe(30)
    expect(computeCalc('ldl', get({ tchol: 200, hdl: 40, tg: 150 }))).toBe(130)
    // Friedewald is invalid above TG 400
    expect(computeCalc('ldl', get({ tchol: 300, hdl: 40, tg: 450 }))).toBeNull()
    expect(computeCalc('tc_hdl', get({ tchol: 200, hdl: 40 }))).toBe(5)
  })
  it('parses numbers strictly', () => {
    expect(parseNum('13,200')).toBe(13200)
    expect(parseNum(' 4.5 ')).toBe(4.5)
    expect(parseNum('abc')).toBeNull()
    expect(parseNum('')).toBeNull()
    expect(parseNum('1.2.3')).toBeNull()
  })
  it('relative difference', () => {
    expect(relativeDiff(80, 75)).toBeCloseTo(0.0667, 3)
    expect(relativeDiff(90, 75)).toBeGreaterThan(0.1)
  })
})
