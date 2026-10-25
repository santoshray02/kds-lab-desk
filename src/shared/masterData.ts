/**
 * Default test master. Built from the lab's 2025–26 report formats with the known errors fixed
 * (see docs/DECISIONS.md). Every range here is a DEFAULT to be reviewed by Dr. Manoj Kumar.
 */
import type { PanelDef, ParamType } from './types'
import { CHILD_MAX_DAYS, MAX_AGE_DAYS } from './types'

export type SeedBand = 'all' | 'adult' | 'child'
/** [sex, age band, low, high, text?] */
export type SeedRange = ['M' | 'F' | 'A', SeedBand, number | null, number | null, string?]

export interface SeedParam {
  code: string
  name: string
  type?: ParamType
  unit?: string
  dec?: number
  options?: string[]
  normal?: string[]
  calc?: string
  group?: string
  pMin?: number
  pMax?: number
  cLow?: number
  cHigh?: number
  ranges?: SeedRange[]
}

export interface SeedPanel {
  code: string
  name: string
  section: string
  price: number
  specimen?: string
  sentOut?: boolean
  bundle?: string[]
  params: SeedParam[]
}

export const SECTION_ORDER = [
  'HAEMATOLOGY',
  'BIOCHEMISTRY',
  'SEROLOGY',
  'URINE EXAMINATION',
  'CLINICAL PATHOLOGY',
  'MICROBIOLOGY',
  'SENT OUT'
]

export function bandDays(b: SeedBand): [number, number] {
  return b === 'child' ? [0, CHILD_MAX_DAYS] : b === 'adult' ? [CHILD_MAX_DAYS, MAX_AGE_DAYS] : [0, MAX_AGE_DAYS]
}

const A = (l: number | null, h: number | null): SeedRange[] => [['A', 'all', l, h]]
const NEG = ['Negative', 'Positive']
const REACT = ['Non-reactive', 'Reactive']

const sel = (code: string, name: string, options: string[], normal: string[], extra: Partial<SeedParam> = {}): SeedParam => ({
  code, name, type: 'select', options, normal, ...extra
})
const txt = (code: string, name: string, normal: string[] = [], options: string[] = [], unit = '', extra: Partial<SeedParam> = {}): SeedParam => ({
  code, name, type: 'text', options, normal, unit, ...extra
})
const sugar = (code: string, name: string, lo: number, hi: number): SeedParam => ({
  code, name, unit: 'mg/dL', dec: 0, pMin: 10, pMax: 1500, cLow: 50, cHigh: 400, ranges: A(lo, hi)
})

export const MASTER: SeedPanel[] = [
  {
    code: 'CBC', name: 'Complete Blood Count (CBC)', section: 'HAEMATOLOGY', price: 200, specimen: 'Blood',
    params: [
      { code: 'hb', name: 'Haemoglobin (Hb)', unit: 'g/dL', dec: 1, pMin: 1, pMax: 25, cLow: 7, cHigh: 22,
        ranges: [['M', 'adult', 13, 17], ['F', 'adult', 11.5, 16.5], ['A', 'child', 11, 14.5]] },
      { code: 'tlc', name: 'Total Leucocyte Count (TLC)', unit: '/cumm', dec: 0, pMin: 100, pMax: 500000, cLow: 1000, cHigh: 50000,
        ranges: [['A', 'adult', 4000, 11000], ['A', 'child', 5000, 14500]] },
      { code: 'neut', name: 'Neutrophils', unit: '%', dec: 0, pMin: 0, pMax: 100, group: 'Differential Leucocyte Count (DLC)',
        ranges: [['A', 'adult', 40, 75], ['A', 'child', 25, 60]] },
      { code: 'lymph', name: 'Lymphocytes', unit: '%', dec: 0, pMin: 0, pMax: 100, group: 'Differential Leucocyte Count (DLC)',
        ranges: [['A', 'adult', 20, 40], ['A', 'child', 35, 65]] },
      { code: 'eos', name: 'Eosinophils', unit: '%', dec: 0, pMin: 0, pMax: 100, group: 'Differential Leucocyte Count (DLC)', ranges: A(1, 6) },
      { code: 'mono', name: 'Monocytes', unit: '%', dec: 0, pMin: 0, pMax: 100, group: 'Differential Leucocyte Count (DLC)', ranges: A(2, 10) },
      { code: 'baso', name: 'Basophils', unit: '%', dec: 0, pMin: 0, pMax: 100, group: 'Differential Leucocyte Count (DLC)', ranges: A(0, 1) },
      { code: 'band', name: 'Band Form', unit: '%', dec: 0, pMin: 0, pMax: 100, group: 'Differential Leucocyte Count (DLC)' },
      { code: 'rbc', name: 'Red Blood Cell Count (RBC)', unit: 'mil/cumm', dec: 2, pMin: 0.5, pMax: 10,
        ranges: [['M', 'adult', 4.5, 5.9], ['F', 'adult', 3.8, 5.2], ['A', 'child', 4, 5.2]] },
      { code: 'pcv', name: 'Packed Cell Volume (PCV)', unit: '%', dec: 1, pMin: 5, pMax: 75,
        ranges: [['M', 'adult', 40, 52], ['F', 'adult', 36, 46], ['A', 'child', 34, 42]] },
      { code: 'mcv', name: 'Mean Cell Volume (MCV)', unit: 'fL', dec: 1, calc: 'mcv', pMin: 40, pMax: 150,
        ranges: [['A', 'adult', 83, 101], ['A', 'child', 75, 95]] },
      { code: 'mch', name: 'Mean Cell Haemoglobin (MCH)', unit: 'pg', dec: 1, calc: 'mch', pMin: 10, pMax: 60, ranges: A(27, 32) },
      { code: 'mchc', name: 'Mean Cell Haemoglobin Concentration (MCHC)', unit: 'g/dL', dec: 1, calc: 'mchc', pMin: 15, pMax: 50, ranges: A(31.5, 34.5) },
      { code: 'plt', name: 'Platelet Count', unit: 'lakh/cumm', dec: 2, pMin: 0.01, pMax: 20, cLow: 0.5, cHigh: 10, ranges: A(1.5, 4.5) }
    ]
  },
  {
    code: 'ESR', name: 'ESR', section: 'HAEMATOLOGY', price: 60, specimen: 'Blood',
    params: [{ code: 'esr', name: 'Erythrocyte Sedimentation Rate (ESR)', unit: 'mm/1st hr', dec: 0, pMin: 0, pMax: 200,
      ranges: [['M', 'adult', 0, 15], ['F', 'adult', 0, 20], ['A', 'child', 0, 10]] }]
  },
  {
    code: 'BTCT', name: 'BT / CT', section: 'HAEMATOLOGY', price: 80, specimen: 'Blood',
    params: [
      { code: 'bt', name: 'Bleeding Time (BT)', type: 'duration', unit: 'min', pMin: 0, pMax: 60, ranges: A(120, 300) },
      { code: 'ct', name: 'Clotting Time (CT)', type: 'duration', unit: 'min', pMin: 0, pMax: 60, ranges: A(180, 480) }
    ]
  },
  {
    code: 'ABO', name: 'ABO Blood Group + Rh Factor', section: 'HAEMATOLOGY', price: 80, specimen: 'Blood',
    params: [
      sel('abo', 'ABO Blood Group', ['A', 'B', 'AB', 'O'], []),
      sel('rh', 'Rh Factor', ['Positive', 'Negative'], [])
    ]
  },
  { code: 'FBS', name: 'Blood Sugar (Fasting)', section: 'BIOCHEMISTRY', price: 50, specimen: 'Blood', params: [sugar('fbs', 'Blood Sugar (F)', 70, 110)] },
  { code: 'PPBS', name: 'Blood Sugar (Post-prandial)', section: 'BIOCHEMISTRY', price: 50, specimen: 'Blood', params: [sugar('ppbs', 'Blood Sugar (PP)', 80, 140)] },
  { code: 'RBS', name: 'Blood Sugar (Random)', section: 'BIOCHEMISTRY', price: 50, specimen: 'Blood', params: [sugar('rbs', 'Blood Sugar (R)', 80, 150)] },
  {
    code: 'LFT', name: 'Liver Function Test (LFT)', section: 'BIOCHEMISTRY', price: 400, specimen: 'Blood',
    params: [
      { code: 'tbili', name: 'Total Bilirubin', unit: 'mg/dL', dec: 2, pMin: 0, pMax: 60, ranges: A(0, 1) },
      { code: 'dbili', name: 'Conjugated Bilirubin (Direct)', unit: 'mg/dL', dec: 2, pMin: 0, pMax: 40, ranges: A(0, 0.2) },
      { code: 'ibili', name: 'Unconjugated Bilirubin (Indirect)', unit: 'mg/dL', dec: 2, calc: 'ibili', pMin: 0, pMax: 40, ranges: A(0, 0.8) },
      { code: 'sgpt', name: 'SGPT (ALT)', unit: 'U/L', dec: 1, pMin: 1, pMax: 5000, ranges: A(5, 35) },
      { code: 'sgot', name: 'SGOT (AST)', unit: 'U/L', dec: 1, pMin: 1, pMax: 5000, ranges: A(5, 35) },
      { code: 'alp', name: 'Alkaline Phosphatase (ALP)', unit: 'U/L', dec: 0, pMin: 5, pMax: 3000,
        ranges: [['A', 'adult', 35, 170], ['A', 'child', 54, 369]] },
      { code: 'tprot', name: 'Total Protein', unit: 'g/dL', dec: 2, pMin: 1, pMax: 15, ranges: A(6, 8) },
      { code: 'albumin', name: 'Serum Albumin', unit: 'g/dL', dec: 2, pMin: 0.5, pMax: 8, ranges: A(3.7, 5.3) },
      { code: 'globulin', name: 'Globulin', unit: 'g/dL', dec: 2, calc: 'globulin', pMin: 0.1, pMax: 12, ranges: A(2.3, 3.6) },
      { code: 'agratio', name: 'Albumin / Globulin Ratio', unit: '', dec: 2, calc: 'agratio', pMin: 0.1, pMax: 10, ranges: A(1, 2.3) }
    ]
  },
  {
    code: 'KFT', name: 'Kidney Function Test (KFT)', section: 'BIOCHEMISTRY', price: 400, specimen: 'Blood',
    params: [
      { code: 'urea', name: 'Blood Urea', unit: 'mg/dL', dec: 1, pMin: 1, pMax: 500, ranges: A(10, 40) },
      { code: 'creat', name: 'Serum Creatinine', unit: 'mg/dL', dec: 2, pMin: 0.1, pMax: 30, cHigh: 10,
        ranges: [['M', 'adult', 0.7, 1.3], ['F', 'adult', 0.6, 1.1], ['A', 'child', 0.3, 0.7]] },
      { code: 'uric', name: 'Serum Uric Acid', unit: 'mg/dL', dec: 1, pMin: 0.5, pMax: 25,
        ranges: [['M', 'adult', 3.4, 7], ['F', 'adult', 2.4, 6], ['A', 'child', 2, 5.5]] },
      { code: 'na', name: 'Sodium (Na)', unit: 'mEq/L', dec: 0, pMin: 90, pMax: 190, cLow: 120, cHigh: 160, ranges: A(135, 145) },
      { code: 'k', name: 'Potassium (K)', unit: 'mEq/L', dec: 1, pMin: 1, pMax: 12, cLow: 2.8, cHigh: 6.2, ranges: A(3.5, 5.1) },
      { code: 'cl', name: 'Chloride (Cl)', unit: 'mEq/L', dec: 0, pMin: 60, pMax: 150, ranges: A(95, 110) }
    ]
  },
  {
    code: 'ELEC', name: 'Electrolytes (Na / K / Cl)', section: 'BIOCHEMISTRY', price: 250, specimen: 'Blood',
    params: [
      { code: 'na_e', name: 'Sodium (Na)', unit: 'mEq/L', dec: 0, pMin: 90, pMax: 190, cLow: 120, cHigh: 160, ranges: A(135, 145) },
      { code: 'k_e', name: 'Potassium (K)', unit: 'mEq/L', dec: 1, pMin: 1, pMax: 12, cLow: 2.8, cHigh: 6.2, ranges: A(3.5, 5.1) },
      { code: 'cl_e', name: 'Chloride (Cl)', unit: 'mEq/L', dec: 0, pMin: 60, pMax: 150, ranges: A(95, 110) }
    ]
  },
  {
    code: 'CA', name: 'Serum Calcium', section: 'BIOCHEMISTRY', price: 150, specimen: 'Blood',
    params: [{ code: 'ca', name: 'Calcium', unit: 'mg/dL', dec: 1, pMin: 2, pMax: 20, cLow: 6, cHigh: 13, ranges: A(8.5, 10.5) }]
  },
  {
    code: 'LIPID', name: 'Lipid Profile', section: 'BIOCHEMISTRY', price: 400, specimen: 'Blood',
    params: [
      { code: 'tchol', name: 'Serum Cholesterol', unit: 'mg/dL', dec: 0, pMin: 30, pMax: 1000, ranges: A(130, 200) },
      { code: 'hdl', name: 'HDL Cholesterol', unit: 'mg/dL', dec: 0, pMin: 5, pMax: 200, ranges: A(40, 70) },
      { code: 'tg', name: 'Serum Triglycerides', unit: 'mg/dL', dec: 0, pMin: 10, pMax: 5000, ranges: A(40, 150) },
      { code: 'ldl', name: 'LDL Cholesterol', unit: 'mg/dL', dec: 1, calc: 'ldl', pMin: 1, pMax: 800, ranges: A(60, 120) },
      { code: 'vldl', name: 'VLDL Cholesterol', unit: 'mg/dL', dec: 1, calc: 'vldl', pMin: 1, pMax: 1000, ranges: A(5, 30) },
      { code: 'tc_hdl', name: 'Total Cholesterol / HDL Ratio', unit: '', dec: 2, calc: 'tc_hdl', pMin: 0.5, pMax: 50, ranges: A(null, 5) },
      { code: 'ldl_hdl', name: 'LDL / HDL Cholesterol Ratio', unit: '', dec: 2, calc: 'ldl_hdl', pMin: 0.1, pMax: 40, ranges: A(null, 3.5) }
    ]
  },
  {
    code: 'HBA1C', name: 'HbA1c', section: 'BIOCHEMISTRY', price: 450, specimen: 'Blood',
    params: [{ code: 'hba1c', name: 'Glycosylated Haemoglobin (HbA1c)', unit: '%', dec: 1, pMin: 2, pMax: 20, ranges: A(4, 5.6) }]
  },
  {
    code: 'WIDAL', name: 'Widal Test (Slide method)', section: 'SEROLOGY', price: 150, specimen: 'Blood',
    params: [
      sel('widal', 'WIDAL TEST (SLIDE METHOD)', ['Positive', 'Negative'], ['Negative']),
      ...(
        [
          ['wo', "Salmonella Typhi 'O'"],
          ['wh', "Salmonella Typhi 'H'"],
          ['wah', "Salmonella Paratyphi 'AH'"],
          ['wbh', "Salmonella Paratyphi 'BH'"]
        ] as const
      ).map(([code, name]): SeedParam => ({
        code, name, type: 'titre', options: ['0', '20', '40', '80', '160', '320'], dec: 0, unit: 'titre', ranges: A(null, 40)
      }))
    ]
  },
  {
    code: 'MPC', name: 'Malaria Parasite (Rapid card)', section: 'SEROLOGY', price: 100, specimen: 'Blood',
    params: [
      sel('mp_pf', 'Plasmodium Falciparum (P.f)', NEG, ['Negative']),
      sel('mp_pv', 'Plasmodium Vivax (P.v)', NEG, ['Negative'])
    ]
  },
  {
    code: 'MPS', name: 'Malaria Slide method', section: 'SEROLOGY', price: 100, specimen: 'Blood',
    params: [sel('mp_slide', 'Malaria Slide method Test', ['Non-reactive', 'Reactive'], ['Non-reactive'])]
  },
  {
    code: 'DENGUE', name: 'Dengue (NS1 / IgG / IgM)', section: 'SEROLOGY', price: 600, specimen: 'Blood',
    params: [
      sel('dg_ns1', 'Dengue NS1 Antigen', NEG, ['Negative']),
      sel('dg_igg', 'Dengue IgG Antibody', NEG, ['Negative']),
      sel('dg_igm', 'Dengue IgM Antibody', NEG, ['Negative'])
    ]
  },
  {
    code: 'CRP', name: 'C-Reactive Protein (CRP)', section: 'SEROLOGY', price: 200, specimen: 'Blood',
    params: [
      sel('crp', 'C-Reactive Protein (CRP)', NEG, ['Negative']),
      { code: 'crp_v', name: 'CRP (quantitative)', unit: 'mg/L', dec: 1, pMin: 0, pMax: 500, ranges: A(0, 6) }
    ]
  },
  {
    code: 'ASO', name: 'ASO Titre', section: 'SEROLOGY', price: 250, specimen: 'Blood',
    params: [
      sel('aso', 'ASO', NEG, ['Negative']),
      { code: 'aso_v', name: 'ASO (quantitative)', unit: 'IU/mL', dec: 0, pMin: 0, pMax: 5000, ranges: A(0, 200) }
    ]
  },
  {
    code: 'RA', name: 'RA Factor', section: 'SEROLOGY', price: 250, specimen: 'Blood',
    params: [
      sel('ra', 'Rheumatoid Factor (RA)', NEG, ['Negative']),
      { code: 'ra_v', name: 'RA (quantitative)', unit: 'IU/mL', dec: 0, pMin: 0, pMax: 5000, ranges: A(0, 20) }
    ]
  },
  { code: 'HIV', name: 'HIV 1 & 2', section: 'SEROLOGY', price: 300, specimen: 'Blood', params: [sel('hiv', 'Human Immune Virus (HIV) 1 & 2', NEG, ['Negative'])] },
  { code: 'HBSAG', name: 'HBsAg', section: 'SEROLOGY', price: 250, specimen: 'Blood', params: [sel('hbsag', 'Hepatitis B Surface Antigen (HBsAg)', NEG, ['Negative'])] },
  { code: 'HCV', name: 'HCV', section: 'SEROLOGY', price: 350, specimen: 'Blood', params: [sel('hcv', 'Hepatitis C Virus (HCV)', NEG, ['Negative'])] },
  { code: 'VDRL', name: 'VDRL', section: 'SEROLOGY', price: 150, specimen: 'Blood', params: [sel('vdrl', 'VDRL (Syphilis)', REACT, ['Non-reactive'])] },
  { code: 'UPT', name: 'Pregnancy Test (UPT)', section: 'SEROLOGY', price: 100, specimen: 'Urine', params: [sel('upt', 'Urine Pregnancy Test', NEG, ['Negative'])] },
  {
    code: 'VIRAL', name: 'HIV / HBsAg / HCV', section: 'SEROLOGY', price: 0, bundle: ['HIV', 'HBSAG', 'HCV'], params: []
  },
  {
    code: 'URINE', name: 'Urine Routine / Microscopy (R/E)', section: 'URINE EXAMINATION', price: 100, specimen: 'Urine',
    params: [
      txt('u_vol', 'Volume', [], [], 'ml', { group: 'PHYSICAL EXAMINATION' }),
      txt('u_col', 'Colour', ['Pale yellow', 'Straw', 'Yellow'], ['Pale yellow', 'Straw', 'Yellow', 'Dark yellow', 'Red', 'Brown'], '', { group: 'PHYSICAL EXAMINATION' }),
      txt('u_trans', 'Transparency', ['Clear'], ['Clear', 'Slightly turbid', 'Turbid'], '', { group: 'PHYSICAL EXAMINATION' }),
      txt('u_react', 'Reaction', ['Acidic'], ['Acidic', 'Alkaline', 'Neutral'], '', { group: 'CHEMICAL EXAMINATION' }),
      txt('u_alb', 'Albumin', ['Nil'], ['Nil', 'Trace', '+', '++', '+++'], '', { group: 'CHEMICAL EXAMINATION' }),
      txt('u_sug', 'Reducing Sugar (R)', ['Nil'], ['Nil', 'Trace', '+', '++', '+++', '++++'], '', { group: 'CHEMICAL EXAMINATION' }),
      txt('u_pus', 'Pus Cells', [], ['Nil', '1-2', '2-3', '3-4', '4-5', '5-6', '8-10', '10-15', 'Plenty'], '/HPF', { group: 'MICROSCOPIC EXAMINATION', ranges: [['A', 'all', null, null, '< 5']] }),
      txt('u_rbc', 'RBC', ['Nil'], ['Nil', '1-2', '2-4', '4-6', 'Plenty'], '/HPF', { group: 'MICROSCOPIC EXAMINATION' }),
      txt('u_epi', 'Epithelial Cells', [], ['Nil', '1-2', '2-4', '4-5', 'Plenty'], '/HPF', { group: 'MICROSCOPIC EXAMINATION', ranges: [['A', 'all', null, null, '< 4']] }),
      txt('u_cast', 'Casts', ['Nil'], ['Nil'], '/HPF', { group: 'MICROSCOPIC EXAMINATION' }),
      txt('u_cry', 'Crystals', ['Nil'], ['Nil'], '/HPF', { group: 'MICROSCOPIC EXAMINATION' })
    ]
  },
  {
    code: 'AFB', name: 'Sputum for AFB', section: 'MICROBIOLOGY', price: 150, specimen: 'Sputum',
    params: [sel('afb', 'Sputum for AFB (Ziehl-Neelsen stain)', ['Negative', 'Scanty', '1+', '2+', '3+'], ['Negative'])]
  },
  {
    code: 'SEMEN', name: 'Semen Analysis', section: 'CLINICAL PATHOLOGY', price: 300, specimen: 'Semen',
    params: [
      txt('s_vol', 'Volume', [], [], 'mL', { ranges: A(1.5, 5) }),
      txt('s_app', 'Appearance', ['Greyish white'], ['Greyish white', 'Yellowish', 'Blood-stained']),
      txt('s_liq', 'Liquefaction time', [], [], 'min', { ranges: [['A', 'all', null, null, '< 30 min']] }),
      { code: 's_cnt', name: 'Sperm Count', unit: 'million/mL', dec: 1, pMin: 0, pMax: 500, ranges: A(15, null) },
      { code: 's_mot', name: 'Total Motility', unit: '%', dec: 0, pMin: 0, pMax: 100, ranges: A(40, null) },
      { code: 's_morph', name: 'Normal Morphology', unit: '%', dec: 0, pMin: 0, pMax: 100, ranges: A(4, null) },
      txt('s_ph', 'pH', [], [], '', { ranges: A(7.2, 8) }),
      txt('s_pus', 'Pus Cells', [], [], '/HPF'),
      txt('s_rbc', 'RBC', ['Nil'], ['Nil'], '/HPF')
    ]
  },
  {
    code: 'THYROID', name: 'Thyroid Profile (T3 / T4 / TSH)', section: 'BIOCHEMISTRY', price: 450, specimen: 'Blood',
    params: [
      { code: 't3', name: 'Total T3 (Triiodothyronine)', unit: 'ng/dL', dec: 0, pMin: 10, pMax: 1000, ranges: A(80, 200) },
      { code: 't4', name: 'Total T4 (Thyroxine)', unit: 'µg/dL', dec: 1, pMin: 0.5, pMax: 40, ranges: A(5.1, 14.1) },
      { code: 'tsh', name: 'TSH (Thyroid Stimulating Hormone)', unit: 'µIU/mL', dec: 2, pMin: 0.001, pMax: 500, ranges: A(0.4, 4.2) }
    ]
  },
  {
    code: 'VITD', name: 'Vitamin D (25-OH)', section: 'BIOCHEMISTRY', price: 1200, specimen: 'Blood',
    params: [{ code: 'vitd', name: 'Vitamin D, 25-Hydroxy', unit: 'ng/mL', dec: 1, pMin: 1, pMax: 400, ranges: A(30, 100) }]
  },
  {
    code: 'B12', name: 'Vitamin B12', section: 'BIOCHEMISTRY', price: 900, specimen: 'Blood',
    params: [{ code: 'b12', name: 'Vitamin B12 (Cyanocobalamin)', unit: 'pg/mL', dec: 0, pMin: 10, pMax: 5000, ranges: A(200, 900) }]
  },
  { code: 'OTHER_SO', name: 'Other test — sent out', section: 'SENT OUT', price: 0, sentOut: true, params: [] }
]

/** The default master as in-memory definitions (ids assigned in order). Used by tests and the demo. */
export function masterToDefs(): PanelDef[] {
  let pid = 0
  let qid = 0
  return MASTER.map((sp, i) => {
    const panelId = ++pid
    return {
      id: panelId, code: sp.code, name: sp.name, section: sp.section, price: sp.price,
      specimen: sp.specimen ?? 'Blood', sort: i, sentOut: !!sp.sentOut, active: true, bundleCodes: sp.bundle ?? [],
      params: sp.params.map((q, j) => ({
        id: ++qid, panelId, code: q.code, name: q.name, type: q.type ?? 'numeric', unit: q.unit ?? '',
        decimals: q.dec ?? 0, options: q.options ?? [], normal: q.normal ?? [], calc: q.calc ?? null,
        group: q.group ?? null, sort: j, plausibleMin: q.pMin ?? null, plausibleMax: q.pMax ?? null,
        criticalLow: q.cLow ?? null, criticalHigh: q.cHigh ?? null, rangeVersion: 1,
        ranges: (q.ranges ?? []).map(([sex, band, low, high, text]) => {
          const [a, b] = bandDays(band)
          return { sex, ageMinDays: a, ageMaxDays: b, low, high, text: text ?? null }
        })
      }))
    }
  })
}
