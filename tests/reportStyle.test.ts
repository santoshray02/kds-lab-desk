import { describe, expect, it } from 'vitest'
import { renderReportHtml, type ReportData, type ReportRow } from '../src/shared/reportHtml'
import { DEFAULT_SETTINGS } from '../src/shared/settings'

const row = (name: string, value: string, flag: ReportRow['flag'], critical = false): ReportRow => ({
  name, group: null, type: 'numeric', value, unit: 'g/dL', range: '12 – 16', flag, critical, paramCode: null
})

const data = (abnormalStyle?: ReportData['abnormalStyle']): ReportData => ({
  lab: DEFAULT_SETTINGS.lab, paper: 'A4', letterhead: false, letterheadTopMm: 45, letterheadBottomMm: 25,
  patientName: 'Test Patient', title: 'Mr', ageText: '30 Y', sexText: 'Male', sampleId: '2610-001', dateText: '26/10/2026',
  doctor: 'Self', specimen: 'Blood', testAsked: '', version: 1, correctionNote: '', watermark: '',
  sections: [{ title: 'HAEMATOLOGY', panels: [{ code: null, name: 'CBC', rows: [row('Hb', '10.0', 'L'), row('Platelets', '0.3', 'L', true), row('TLC', '7000', null)] }] }],
  sentOut: [], qrSvg: '', qrCaption: '', approvedAtText: '', abnormalStyle
})

describe('abnormal result style', () => {
  it('standard keeps the red summary box and pink rows', () => {
    const h = renderReportHtml(data('standard'))
    expect(h).toContain('class="sum"')
    expect(h).not.toContain('tr.ab td{background:none}')
  })
  it('gentle has no summary box or pink rows, and keeps red only for critical values', () => {
    const h = renderReportHtml(data('gentle'))
    expect(h).not.toContain('class="sum"')
    expect(h).toContain('tr.ab td{background:none}')
    expect(h).toContain('tr.ab.crit td.v{color:var(--bad)}')
    expect(h).toContain('10.0 L') // the H/L letter stays
  })
  it('plain has no red at all', () => {
    const h = renderReportHtml(data('plain'))
    expect(h).not.toContain('class="sum"')
    expect(h).not.toContain('tr.ab.crit td.v')
  })
  it('older callers without a style still get the standard look', () => {
    expect(renderReportHtml(data())).toContain('class="sum"')
  })
})
