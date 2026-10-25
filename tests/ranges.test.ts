import { describe, expect, it } from 'vitest'
import { masterToDefs } from '@shared/masterData'
import { evaluate, rangeText, selectRange, parseDuration } from '@shared/ranges'
import { ageToDays } from '@shared/age'
import type { ParamDef } from '@shared/types'

const defs = masterToDefs()
const param = (code: string): ParamDef => defs.flatMap((p) => p.params).find((q) => q.code === code)!
const adult = ageToDays({ years: 30, months: 0, days: 0 })
const child = ageToDays({ years: 5, months: 0, days: 0 })

describe('range selection', () => {
  it('uses sex-specific adult ranges', () => {
    const hb = param('hb')
    expect(selectRange(hb.ranges, 'M', adult)).toMatchObject({ low: 13, high: 17 })
    expect(selectRange(hb.ranges, 'F', adult)).toMatchObject({ low: 11.5, high: 16.5 })
  })
  it('uses the child band for young patients regardless of sex', () => {
    const hb = param('hb')
    expect(selectRange(hb.ranges, 'M', child)).toMatchObject({ low: 11, high: 14.5 })
    expect(selectRange(hb.ranges, 'F', child)).toMatchObject({ low: 11, high: 14.5 })
  })
  it('falls back to a shared range and to the first sex range when sex is unknown', () => {
    expect(selectRange(param('tlc').ranges, 'M', adult)).toMatchObject({ low: 4000, high: 11000 })
    expect(selectRange(param('hb').ranges, 'O', adult)).not.toBeNull()
  })
  it('child boundary is 12 years', () => {
    const tlc = param('tlc')
    expect(selectRange(tlc.ranges, 'M', ageToDays({ years: 11, months: 11, days: 0 }))!.high).toBe(14500)
    expect(selectRange(tlc.ranges, 'M', ageToDays({ years: 12, months: 1, days: 0 }))!.high).toBe(11000)
  })
})

describe('flags', () => {
  it('flags L and H using the patient range (design example: Hb 9.4 in a woman is L)', () => {
    expect(evaluate(param('hb'), '9.4', 'F', adult).flag).toBe('L')
    expect(evaluate(param('tlc'), '13200', 'F', adult).flag).toBe('H')
    expect(evaluate(param('hb'), '14', 'F', adult).flag).toBeNull()
    expect(evaluate(param('hb'), '14', 'M', adult).flag).toBeNull()
    expect(evaluate(param('hb'), '12', 'M', adult).flag).toBe('L')
  })
  it('values on the limit are normal', () => {
    expect(evaluate(param('hb'), '11.5', 'F', adult).flag).toBeNull()
    expect(evaluate(param('mch'), '32', 'F', adult).flag).toBeNull()
    expect(evaluate(param('mch'), '32.1', 'F', adult).flag).toBe('H')
  })
  it('qualitative results outside the normal list are abnormal', () => {
    expect(evaluate(param('hiv'), 'Negative', 'M', adult).flag).toBeNull()
    expect(evaluate(param('hiv'), 'Positive', 'M', adult).flag).toBe('A')
    expect(evaluate(param('u_alb'), 'trace', 'M', adult).flag).toBe('A')
  })
  it('critical values', () => {
    expect(evaluate(param('hb'), '6.5', 'F', adult).critical).toBe(true)
    expect(evaluate(param('hb'), '7', 'F', adult).critical).toBe(false)
    expect(evaluate(param('plt'), '0.4', 'F', adult).critical).toBe(true)
    expect(evaluate(param('rbs'), '45', 'F', adult).critical).toBe(true)
    expect(evaluate(param('rbs'), '420', 'F', adult).critical).toBe(true)
    expect(evaluate(param('k'), '2.7', 'F', adult).critical).toBe(true)
    expect(evaluate(param('k'), '6.3', 'F', adult).critical).toBe(true)
    expect(evaluate(param('k'), '5.0', 'F', adult).critical).toBe(false)
  })
  it('rejects implausible values', () => {
    const e = evaluate(param('hb'), '105', 'M', adult)
    expect(e.state).toBe('invalid')
    expect(e.implausible).toBe(true)
    expect(evaluate(param('hb'), 'x', 'M', adult).state).toBe('invalid')
  })
  it('empty stays empty', () => {
    expect(evaluate(param('hb'), '', 'M', adult).state).toBe('empty')
  })
  it('bleeding/clotting time use minutes:seconds', () => {
    expect(parseDuration('2:35')).toBe(155)
    expect(parseDuration('3')).toBe(180)
    expect(evaluate(param('bt'), '2:35', 'M', adult).flag).toBeNull()
    expect(evaluate(param('bt'), '6:10', 'M', adult).flag).toBe('H')
    expect(rangeText(param('bt'), param('bt').ranges[0])).toBe('2 min – 5 min')
  })
})

describe('range text', () => {
  it('prints the master range', () => {
    expect(rangeText(param('hb'), selectRange(param('hb').ranges, 'F', adult))).toBe('11.5 – 16.5')
    expect(rangeText(param('mch'), selectRange(param('mch').ranges, 'F', adult))).toBe('27 – 32')
    expect(rangeText(param('tc_hdl'), param('tc_hdl').ranges[0])).toBe('< 5')
    expect(rangeText(param('s_cnt'), param('s_cnt').ranges[0])).toBe('> 15')
  })
})

describe('master content', () => {
  it('has corrected units', () => {
    expect(param('sgpt').unit).toBe('U/L')
    expect(param('sgot').unit).toBe('U/L')
    expect(param('alp').unit).toBe('U/L')
    expect(param('tprot').unit).toBe('g/dL')
    expect(param('albumin').unit).toBe('g/dL')
    expect(param('mchc').unit).toBe('g/dL')
    expect(param('tc_hdl').unit).toBe('')
  })
  it('param codes are unique', () => {
    const codes = defs.flatMap((p) => p.params.map((q) => q.code))
    expect(new Set(codes).size).toBe(codes.length)
  })
})
