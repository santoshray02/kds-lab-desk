import { describe, expect, it } from 'vitest'
import { masterToDefs } from '@shared/masterData'
import { allSignatures, dlcIssues, resolveResults } from '@shared/checks'
import { ageToDays, nextSampleId, sexForTitle, titleChecks } from '@shared/age'

const defs = masterToDefs()
const panel = (c: string) => defs.find((p) => p.code === c)!
const adult = ageToDays({ years: 34, months: 0, days: 0 })

const cbc = {
  hb: '9.4', tlc: '13200', neut: '78', lymph: '16', eos: '4', mono: '2', baso: '0',
  rbc: '3.90', pcv: '29.6', plt: '2.45'
}

describe('result resolution', () => {
  it('fills MCV/MCH/MCHC automatically and marks them auto', () => {
    const r = resolveResults([panel('CBC')], cbc, 'F', adult)
    expect(r.values.mcv).toEqual({ value: '75.9', auto: true })
    expect(r.values.mch).toEqual({ value: '24.1', auto: true })
    expect(r.values.mchc).toEqual({ value: '31.8', auto: true })
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
  })
  it('keeps analyzer values but warns when more than 10% off', () => {
    const ok = resolveResults([panel('CBC')], { ...cbc, mcv: '78' }, 'F', adult)
    expect(ok.values.mcv).toEqual({ value: '78', auto: false })
    expect(ok.issues.some((i) => i.code === 'calc_mismatch')).toBe(false)
    const bad = resolveResults([panel('CBC')], { ...cbc, mcv: '95' }, 'F', adult)
    expect(bad.issues.some((i) => i.code === 'calc_mismatch' && i.paramCode === 'mcv')).toBe(true)
  })
  it('flags H/L on resolved rows', () => {
    const r = resolveResults([panel('CBC')], cbc, 'F', adult)
    const flag = (c: string) => r.rows.find((x) => x.param.code === c)!.eval.flag
    expect(flag('hb')).toBe('L')
    expect(flag('tlc')).toBe('H')
    expect(flag('plt')).toBeNull()
    expect(flag('mch')).toBe('L')
  })
  it('raises a critical issue for Hb below 7', () => {
    const r = resolveResults([panel('CBC')], { ...cbc, hb: '6.1' }, 'F', adult)
    expect(r.issues.some((i) => i.severity === 'critical' && i.paramCode === 'hb')).toBe(true)
  })
  it('rejects Hb 105', () => {
    const r = resolveResults([panel('CBC')], { ...cbc, hb: '105' }, 'M', adult)
    expect(r.issues.some((i) => i.severity === 'error' && i.code === 'implausible' && i.paramCode === 'hb')).toBe(true)
  })
  it('LFT and lipid calculations', () => {
    const lft = resolveResults([panel('LFT')], { tbili: '1.2', dbili: '0.3', tprot: '7', albumin: '4' }, 'M', adult)
    expect(lft.values.ibili.value).toBe('0.90')
    expect(lft.values.globulin.value).toBe('3.00')
    expect(lft.values.agratio.value).toBe('1.33')
    const lip = resolveResults([panel('LIPID')], { tchol: '200', hdl: '40', tg: '150' }, 'M', adult)
    expect(lip.values.vldl.value).toBe('30.0')
    expect(lip.values.ldl.value).toBe('130.0')
  })
})

describe('DLC check', () => {
  const v = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, { value: x }]))
  it('passes at 100', () => {
    expect(dlcIssues(v({ neut: '60', lymph: '30', eos: '4', mono: '5', baso: '1' }))).toEqual([])
  })
  it('includes band forms in the total', () => {
    expect(dlcIssues(v({ neut: '58', lymph: '30', eos: '4', mono: '5', baso: '1', band: '2' }))).toEqual([])
  })
  it('errors whenever the total is not exactly 100', () => {
    expect(dlcIssues(v({ neut: '60', lymph: '30', eos: '4', mono: '5', baso: '5' }))[0].severity).toBe('error')
    expect(dlcIssues(v({ neut: '60', lymph: '30', eos: '4', mono: '5', baso: '0' }))[0].severity).toBe('error')
    expect(dlcIssues(v({ neut: '60', lymph: '30', eos: '4', mono: '5', baso: '0', band: '1' }))).toEqual([])
    expect(dlcIssues(v({ neut: '60', lymph: '30', eos: '4', mono: '5', baso: '1', band: '1' }))[0].severity).toBe('error')
  })
  it('requires all five counts once any is typed', () => {
    expect(dlcIssues(v({ neut: '60' }))[0].code).toBe('dlc_incomplete')
    expect(dlcIssues(v({}))).toEqual([])
  })
})

describe('duplicate result-set signatures', () => {
  it('is equal for identical numbers regardless of patient', () => {
    const a = resolveResults([panel('CBC')], cbc, 'F', adult)
    const b = resolveResults([panel('CBC')], { ...cbc }, 'M', adult)
    expect(allSignatures([panel('CBC')], a.values)).toEqual(allSignatures([panel('CBC')], b.values))
    expect(allSignatures([panel('CBC')], a.values)).toHaveLength(1)
  })
  it('differs when any value differs; ignores auto-calculated values', () => {
    const a = resolveResults([panel('CBC')], cbc, 'F', adult)
    const b = resolveResults([panel('CBC')], { ...cbc, plt: '2.46' }, 'F', adult)
    expect(allSignatures([panel('CBC')], a.values)[0].signature).not.toBe(allSignatures([panel('CBC')], b.values)[0].signature)
  })
  it('qualitative-only and tiny panels never count as duplicates', () => {
    const r = resolveResults([panel('HIV')], { hiv: 'Negative' }, 'M', adult)
    expect(allSignatures([panel('HIV')], r.values)).toEqual([])
    const s = resolveResults([panel('RBS')], { rbs: '102' }, 'M', adult)
    expect(allSignatures([panel('RBS')], s.values)).toEqual([])
  })
})

describe('title, sex and sample id', () => {
  it('title sets sex', () => {
    expect(sexForTitle('Mr')).toBe('M')
    expect(sexForTitle('Master')).toBe('M')
    expect(sexForTitle('Mrs')).toBe('F')
    expect(sexForTitle('Miss')).toBe('F')
    expect(sexForTitle('Baby')).toBeNull()
  })
  it('warns on title/sex mismatch and odd ages', () => {
    expect(titleChecks('Mr', 'F', { years: 30, months: 0, days: 0 }).length).toBe(1)
    expect(titleChecks('Mrs', 'F', { years: 30, months: 0, days: 0 })).toEqual([])
    expect(titleChecks('Master', 'M', { years: 40, months: 0, days: 0 }).length).toBe(1)
    expect(titleChecks('Mrs', 'F', { years: 5, months: 0, days: 0 }).length).toBe(1)
  })
  it('sample id is YYMM-NNN and counts per month', () => {
    const d = new Date(2026, 9, 25)
    expect(nextSampleId(d, [])).toBe('2610-001')
    expect(nextSampleId(d, ['2610-001', '2610-046', '2609-300'])).toBe('2610-047')
    expect(nextSampleId(new Date(2026, 10, 1), ['2610-046'])).toBe('2611-001')
    expect(nextSampleId(d, ['2610-999'])).toBe('2610-1000')
  })
})
