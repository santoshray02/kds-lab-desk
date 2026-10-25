/** Maps the many ways the old reports spell a test to the codes of the test master. */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

type Rule = [RegExp, string]

const URINE_RULES: Rule[] = [
  [/^volume/, 'u_vol'],
  [/^colou?r/, 'u_col'],
  [/^(transparency|appearance|turbidity)/, 'u_trans'],
  [/^rea[a-z]*(ction)?$/, 'u_react'],
  [/^(albumin|protein)/, 'u_alb'],
  [/^(reducingsugar|sugar|glucose)/, 'u_sug'],
  [/^pus/, 'u_pus'],
  [/^(rbc|redblood)/, 'u_rbc'],
  [/^epithelial/, 'u_epi'],
  [/^cast/, 'u_cast'],
  [/^crystal/, 'u_cry']
]

const RULES: Rule[] = [
  // haematology
  [/^(haemoglobin|hemoglobin|hb)(hb)?$/, 'hb'],
  [/^(totalleucocyte|totalleukocyte|totalwbc|totalwhite|tlc$|wbc)/, 'tlc'],
  [/^(neutrophil|polymorph)/, 'neut'],
  [/^lymphocyte/, 'lymph'],
  [/^eosinophil/, 'eos'],
  [/^monocyte/, 'mono'],
  [/^basophil/, 'baso'],
  [/^bandform|^band$/, 'band'],
  [/^(redbloodcount|redbloodcell|rbccount|rbc$|rbc[a-z]*count|rbcmil)/, 'rbc'],
  [/^(packedcellvolume|haematocrit|hematocrit|pcv|hct)/, 'pcv'],
  [/^(meancellvolume|mcv)/, 'mcv'],
  [/^(concentrationmchc|meancellhaemoglobinconcentration|mchc)/, 'mchc'],
  [/^(meancellhaemoglobin|mch)/, 'mch'],
  [/^(platelet|pletlet|plt)/, 'plt'],
  [/^(esr|erythrocytesed|rateesr)/, 'esr'],
  [/^bleedingtime/, 'bt'],
  [/^clottingtime/, 'ct'],
  // biochemistry
  [/^(fasting|fbs)/, 'fbs'],
  [/hrs?after|afterlunch|afterbreakfast|afterfood|postlunch|postmeal/, 'ppbs'],
  [/^(random|rbs)/, 'rbs'],
  [/^bloodsugar(r|random|rbs)/, 'rbs'],
  [/^bloodsugar(f|fasting|fbs)/, 'fbs'],
  [/^bloodsugar(pp|ppbs|postprandial)/, 'ppbs'],
  [/^(randomblood|randombs|rbs|bsr$)/, 'rbs'],
  [/^(fastingblood|fastingbs|fbs|bsf$)/, 'fbs'],
  [/^(postprandial|ppbs|pp$)/, 'ppbs'],
  [/^(totalbilirubin|sbilirubin(total)?|serumbilirubin|bilirubintotal)/, 'tbili'],
  [/^(conjugat|directbilirubin|sbilirubindirect|bilirubindirect)/, 'dbili'],
  [/^(unconjugat|indirect|bilirubinindirect)/, 'ibili'],
  [/^(sgpt|alt$|alanine)/, 'sgpt'],
  [/^(sgot|ast$|aspartate)/, 'sgot'],
  [/^(alkalinephosph|alkphosph|alp$)/, 'alp'],
  [/^(totalprotein|sprotein|proteintotal)/, 'tprot'],
  [/^(serumalbumin|albumin$|salbumin)/, 'albumin'],
  [/^globulin/, 'globulin'],
  [/^(albuminglobulin|agratio|a\/g)/, 'agratio'],
  [/^(bloodurea|urea|serumurea)/, 'urea'],
  [/^(serumcreatinine|screatinine|creatinine|serumcritinine|critinine|scritinine)/, 'creat'],
  [/^(serumuricacid|suricacid|uricacid)/, 'uric'],
  [/^(serum)?sodium/, 'na'],
  [/^(serum)?potassium/, 'k'],
  [/^(serum)?chloride/, 'cl'],
  [/^(s|serum)?calcium/, 'ca'],
  [/^(serumcholesterol|totalcholesterol$|cholesterol$)/, 'tchol'],
  [/^(totalcholesterolhdl|cholesterolhdl)/, 'tc_hdl'],
  [/^ldlhdl/, 'ldl_hdl'],
  [/^hdl/, 'hdl'],
  [/^(serumtriglyceride|triglyceride)/, 'tg'],
  [/^ldl/, 'ldl'],
  [/^vldl/, 'vldl'],
  [/^(hba1c|glycosylated|glycated)/, 'hba1c'],
  // serology
  [/^(humanimmune|hiv|hivi)/, 'hiv'],
  [/^(hepatitisbsurface|hbsag|hepatitisb)/, 'hbsag'],
  [/^(hepatitisc|hcv|antihcv)/, 'hcv'],
  [/^(vdrl|venerealdisease)/, 'vdrl'],
  [/^(pregnancy|upt)/, 'upt'],
  [/^(dengue)?ns1/, 'dg_ns1'],
  [/^dengueigg|^igg/, 'dg_igg'],
  [/^dengueigm|^igm/, 'dg_igm'],
  [/^(crp|creactive)/, 'crp'],
  [/^aso/, 'aso'],
  [/^(raf|rafactor|rheumatoid|ra$)/, 'ra'],
  [/^(plasmodiumfalciparum|pf$|p\.f)/, 'mp_pf'],
  [/^(plasmodiumvivax|pv$|p\.v)/, 'mp_pv'],
  [/^(malariaslide|malariaslidemethod)/, 'mp_slide'],
  [/^(rhfactor|rh$|rhesus)/, 'rh'],
  [/^(abobloodgroup|bloodgroup|abo)/, 'abo'],
  [/^widaltest|^widal/, 'widal'],
  [/^salmonellatyphio/, 'wo'],
  [/^salmonellatyphih/, 'wh'],
  [/^salmonellaparatyphiah/, 'wah'],
  [/^salmonellaparatyphibh/, 'wbh'],
  [/^afb|^sputum/, 'afb']
]

/** Resolve a row label to a master code. `urine` switches on the urine-microscopy meanings. */
export function mapName(label: string, urine: boolean): string | null {
  const n = norm(label)
  if (!n) return null
  if (urine) {
    for (const [re, code] of URINE_RULES) if (re.test(n)) return code
  }
  for (const [re, code] of RULES) {
    if (re.test(n)) {
      // "RBC" / "Albumin" outside a urine page are blood tests, handled above; urine-only codes never come from here
      return code
    }
  }
  return null
}

export const SECTION_WORDS: [RegExp, string][] = [
  [/haematolog|hematolog|c\.?b\.?c\b|completebloodcount/, 'HAEMATOLOGY'],
  [/urolog|urineexam|urinere|urinerou/, 'URINE EXAMINATION'],
  [/biochem|liverfunction|lipidprofile|glucose|kidney|renal|sugar|lft|kft/, 'BIOCHEMISTRY'],
  [/serolog/, 'SEROLOGY'],
  [/microbiolog|culture/, 'MICROBIOLOGY'],
  [/semen|clinicalpath/, 'CLINICAL PATHOLOGY']
]

export function sectionOf(heading: string): string | null {
  const n = norm(heading)
  for (const [re, name] of SECTION_WORDS) if (re.test(n)) return name
  return null
}

export { norm as normalizeLabel }
