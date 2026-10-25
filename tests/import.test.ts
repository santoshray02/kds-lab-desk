import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { parseReport } from '../src/main/importer/parse'
import { flagFromPrinted, importLog, runImport } from '../src/main/importer/run'
import { previousValues, findDuplicates } from '../src/main/results'
import { searchPeople } from '../src/main/patients'

// All names, numbers and doctors below are invented. The text only copies the SHAPE of the old formats.

/** Current layout (2025–26), header split over several lines as Word exports it. */
const LAYOUT_B = `K.D.S. PATHOLOGY
Computrised Janch Ghar
Sardarganj,Vidyapati Road, Dalsingsarai (Samastipur) PIN-848114
Name     : MRS. TESTA DEVI
Ref .By  : DR. EXAMPLE SINGH  |   Age
 Sex
  |       : 34  Years
      :  FEMALE  | Date        :04/08/2025
Specimen: Blood  |  |
Test Asked : Complete Blood Count (CBC)
H  A  E  M  A  T  O  L  O  G  Y
   Tests\t\t\t\t\t   Result\t     Unit\t\t     Limitation
   Haemoglobin (Hb)\t\t\t   9.4        gm%\t\t     11-16
   Total Leucocytes Count(TLC)   7900     cells/mm3\t     4,000–11,000
   Differential Leucocytes Count(DLC)
   Neutrophils\t\t\t\t   46      \t %\t\t     45 – 70
   Lymphocytes\t\t\t\t   49           %\t\t     20 – 40
   Eosinophils\t\t\t\t   04           %\t\t     01 – 10
   Monocytes\t\t\t\t   01\t\t %\t\t     02 – 05
   Basophils\t\t\t\t   00\t\t %\t\t     00 – 01
   Band Form\t\t\t\t   00\t\t %\t\t     -------
   Red Blood Count(R.B.C)        4.16       mill/cmm\t    4.1 - 5.8
   Packed Cell Volume (P.C.V)    39.9         %\t  \t     34 – 52
   Mean Cell Volume (M.C.V)      95.9         fL\t\t     78 – 98
   Mean Cell Haemoglobin(M.C.H)  27.4         pg\t\t     27 – 33
   Mean Cell Haemoglobin
   Concentration (M.C.H.C)\t   28.6         %\t\t     32 - 38
   Platelets count(P.C)\t\t   0.98      lac/cmm        1.50 – 4.50
Dr. Manoj Kumar\t\t\t\t\t\t\t\t\t\tRam Vivek Kumar
     MBBS\t\t\t\t\t\t\t\t\t\t\t\tDMLT
Not valid for medico legal purpose Use only for treatment.
K.D.S. PATHOLOGY
Computrised Janch Ghar
Sardarganj,Vidyapati Road, Dalsingsarai (Samastipur) PIN-848114
Name     : MRS. TESTA DEVI
Ref .By  : DR. EXAMPLE SINGH  |   Age
 Sex
  |       : 34  Years
      :  FEMALE  | Date        :04/08/2025
Specimen: Blood  |  |
H  A  E  M  A  T  O  L  O  G  Y
Tests\t\t\t\t\tResult\t\tUnit\t\t   Limitations
Bleeding Time\t\t:\t    02 min. 35Sec. \tMinute\tDirect    2 – 5
ABO BLOOD GROUP   \t\t:    \t“B”
Rh. FACTOR      \t\t:    \t“Positive”
B   I  O  C  H  E  M  I  S  T  R  Y
Tests\t\t\t\t\tResult     Unit\t\t     Limitations
Blood Sugar (R)\t\t\t    102.64     mg/dl\t     80 – 150
S E R O L O G Y
Hepatitis B Surface Antigen (HBsAg)
QUALITATIVE
Result\t\t\t\t                   : “NEGATIVE”
Human Immune Virus (HIV) 1 & 2
QUALITATIVE
Result\t\t\t\t                   : “NEGATIVE”
Dr. Manoj Kumar\t\t\t\t\t\t\t\t\t\tRam Vivek Kumar
     MBBS\t\t\t\t\t\t\t\t\t\t\t\tDMLT
Not valid for medico legal purpose Use only for treatment.`.split('\n')

/** Same layout when exported from .docx: header cells joined by " | ". */
const LAYOUT_B_DOCX = `K.D.S. PATHOLOGY
Name     : MR. DEMO KUMAR / Ref .By  : DR. SELF | Age / Sex | :  40  Years / :  MALE | Date        :23/04/2026 / Specimen: Blood
Test Asked : Liver Function Test
\t     \tLiver    Function    Test
Tests      \t                  \tResult       Unit\t  \t  Limitations
Total Bilirubin\t\t\t     1.59          mg/dl         0.00 – 1.00
Conjugated Bilirubin (Direct)\t     0.26         mg/dl         0.00 – 0.20
SGPT (ALT)\t\t\t\t          63.14         IU/DL          05 – 35
SGOT\t(AST)\t\t\t\t     74.21         IU/DL \t    05 – 35
Total Protein\t\t\t\t     6.32          mg/dl          6.0 – 8.0
Serum Albumin\t\t\t\t     3.01  \t   mg/dl\t        3.7 – 5.3
Serum Creatinine\t\t                          0.88  \t                      mg/dl  \t                      0.6 - 1.2(M)
\t\t\t\t\t\t\t\t\t   \t\t 0.6 - 1.3(F)
Dr. Manoj Kumar\t\tRam Vivek Kumar`.split('\n')

/** 2016–23 layout */
const OLD = `K.D.S. PATHOLOGY
Computrised Janch Ghar
Sardarganj,Vidyapati Road, Dalsingsarai (Samastipur) PIN-848114
--------------------------------------------------------------------------------
Name of The Patient: Mr. Sample Person\t\tReceived on: 12/12/2023
Ref. By Dr. Abhinav City Hospital\t\tReported on: 12/12/2023
Investigation Required: Blood\t\tAge/Sex: 48 Y/M
--------------------------------------------------------------------------------
C.B.C
TEST\tRESULTS\tUNIT\tREFERENCE RANGE
Haemoglobin\t:\t13.1\tgm %\t11.5 - 16.4
WBC COUNT
Total WBC Count\t:\t13800\t/cumm\t4000 –10000
DIFFERENTIAL COUNT
Neutrophil\t:\t50\t%\t40 –75
Lymphocyte\t:\t40\t%\t20 - 50
Eosinophil\t:\t06\t%\t01 - 09
Monocyte\t:\t04\t%\t02 - 10
Basophil\t:\t00\t%\t00 - 05
RBC Indices
Haematocrit(PCV)\t:\t41.0\t%\t36 – 47
R.B.C.count\t:\t4.80\tmil./cum\t3.9 – 5.6
MCV\t:\t85.4\tfL\t75 – 96
MCH\t:\t27.3\tpg\t27 – 321
MCHC\t:\t32.0\tgm/dl\t30 – 36
Platelets Indices
Platelet Count\t:\t175000\t/cum\t150000-400000
Dr. Manoj Kumar\tRam Vivek Kumar
Not valid for medico legal purpose Use only for treatment.
K.D.S. PATHOLOGY
Name of The Patient: Mr. Sample Person\t\tReceived on: 12/12/2023
Ref. By Dr. Abhinav City Hospital\t\tReported on: 12/12/2023
Investigation Required: Blood\t\tAge/Sex: 48 Y/M
BLOOD GLUCOSE EXAMINATION REPORT
TEST\tRESULT\tNORMAL RANGE
Fasting  Blood Sugar\t180.mg/dl\t70-120mg/dl
2:0 Hrs  After  Lunch\t214.mg/dl\t80-130mg/dl
SEROLOGICAL TEST REPORT
TEST\tOBSERVED VALUE\tNORMAL VALUE
Human Immune Virus (HIV) I & II\tNegative\tNegative
Dr. Manoj Kumar\tRam Vivek Kumar`.split('\n')

const WIDAL = `K.D.S. PATHOLOGY
Name     : MR. WIDAL TESTER
Ref .By  : DR. SELF  |   Age
 Sex
  |       :  30 Years
      :  MALE  | Date        :18/04/2026
Specimen: Blood  |  |
S   E   R   O   L   O   G   Y
Test Name \t\t\t\t   :\tMalaria Parasites Rapid Test (Antibodies)
\tPlasmodium Falciparum (P.f)
Result \t\t\t\t   :\t“NEGATIVE”
     Plasmodium Vivax (P.v)
     Result \t\t\t\t   :\t“NEGATIVE
WIDAL TEST (SLIDE METHOD):  “POSITIVE”
ANTIGEN
\t\t\t\t\t\t | TITER DILUTION
 |  |  | 1:20 | 1:40 | 1:80 | 1:160 | 1:320 |  | Salmonella Typhi ‘O’ |
  + |
+ |
  + |
+  |
- |  |
Salmonella Typhi ‘H’ |
  + |
+ |
  + |
- |
- |  |
Salmonella Paratyphi ‘AH’ |
  +
 |
+ |
  + |
- |
- |  |
Salmonella Paratyphi ‘BH’ |
  + |
- |
- |
- |
- |  |
Dr. Manoj Kumar\t\tRam Vivek Kumar`.split('\n')

describe('parsing the old formats', () => {
  it('current layout: header, results, sections, and every CBC value mapped', () => {
    const r = parseReport(LAYOUT_B)
    expect(r.visits).toHaveLength(1)
    const v = r.visits[0]
    expect(v).toMatchObject({ title: 'Mrs', name: 'Testa Devi', sex: 'F', date: '2025-08-04', doctor: 'Dr. Example Singh', specimen: 'Blood' })
    expect(v.age).toEqual({ years: 34, months: 0, days: 0 })
    const by = Object.fromEntries(v.rows.filter((x) => x.code).map((x) => [x.code, x]))
    expect(by.hb).toMatchObject({ value: '9.4', unit: 'gm%', range: '11-16', section: 'HAEMATOLOGY' })
    expect(by.tlc.value).toBe('7900')
    expect(by.neut.value).toBe('46')
    expect(by.eos.value).toBe('4')
    expect(by.band.value).toBe('0')
    expect(by.mchc).toMatchObject({ value: '28.6', range: '32 - 38' }) // label wrapped over two lines
    expect(by.plt.value).toBe('0.98')
    expect(by.bt.value).toMatch(/02 min/)
    expect(by.abo.value).toBe('B')
    expect(by.rh.value).toBe('Positive')
    expect(by.rbs).toMatchObject({ value: '102.64', section: 'BIOCHEMISTRY' })
    expect(by.hbsag.value).toBe('Negative')
    expect(by.hiv.value).toBe('Negative')
    // the page repeated the clinic header: still one visit, no duplicate rows
    expect(v.rows.filter((x) => x.code === 'hb')).toHaveLength(1)
  })

  it('docx-style header and wrapped ranges', () => {
    const v = parseReport(LAYOUT_B_DOCX).visits[0]
    expect(v).toMatchObject({ title: 'Mr', name: 'Demo Kumar', sex: 'M', date: '2026-04-23', doctor: 'Self' })
    expect(v.age.years).toBe(40)
    const by = Object.fromEntries(v.rows.filter((x) => x.code).map((x) => [x.code, x]))
    expect(by.tbili.value).toBe('1.59')
    expect(by.sgpt).toMatchObject({ value: '63.14', unit: 'IU/DL' })
    expect(by.creat.range).toContain('0.6 - 1.3(F)')
  })

  it('2016–23 layout', () => {
    const v = parseReport(OLD).visits[0]
    expect(v).toMatchObject({ title: 'Mr', name: 'Sample Person', sex: 'M', date: '2023-12-12', layout: 'old', doctor: 'Dr. Abhinav City Hospital' })
    expect(v.age.years).toBe(48)
    const by = Object.fromEntries(v.rows.filter((x) => x.code).map((x) => [x.code, x]))
    expect(by.hb.value).toBe('13.1')
    expect(by.tlc.value).toBe('13800')
    expect(by.plt.value).toBe('175000')
    expect(by.fbs).toMatchObject({ value: '180', unit: 'mg/dl' })
    expect(by.ppbs.value).toBe('214')
    expect(by.hiv.value).toBe('Negative')
  })

  it('malaria card and the Widal titre grid', () => {
    const v = parseReport(WIDAL).visits[0]
    const by = Object.fromEntries(v.rows.filter((x) => x.code).map((x) => [x.code, x]))
    expect(by.mp_pf.value).toBe('Negative')
    expect(by.mp_pv.value).toBe('Negative')
    expect(by.widal.value).toBe('Positive')
    expect([by.wo.value, by.wh.value, by.wah.value, by.wbh.value]).toEqual(['160', '80', '80', '20'])
  })

  it('Thyrocare files are logged as sent-out, not parsed', () => {
    const r = parseReport(['Thyrocare Technologies Ltd', 'Name : MR. SOMEONE', 'TSH 2.3'])
    expect(r.thyrocare).toBe(true)
    expect(r.visits).toEqual([])
  })

  it('files that are not lab reports are reported with a reason', () => {
    const r = parseReport(['Class 6 lesson 1 civics', 'A.1 ans-iii 2 ans- I'])
    expect(r.visits).toEqual([])
    expect(r.reason).toMatch(/not a lab report/)
  })

  it('keeps contradictory title/sex as a note instead of changing it', () => {
    const lines = LAYOUT_B.map((l) => l.replace('MRS. TESTA DEVI', 'MR. TESTA DEVI'))
    const v = parseReport(lines).visits[0]
    expect(v.sex).toBe('F')
    expect(v.notes[0]).toMatch(/Mr\./)
  })
})

describe('printed-range flags', () => {
  it('derives H/L from the range that was printed', () => {
    expect(flagFromPrinted('9.4', '11-16')).toBe('L')
    expect(flagFromPrinted('7900', '4,000–11,000')).toBeNull()
    expect(flagFromPrinted('13800', '4000 –10000')).toBe('H')
    expect(flagFromPrinted('7', '< 5')).toBe('H')
    expect(flagFromPrinted('0.88', '0.6 - 1.2(M)')).toBeNull()
    expect(flagFromPrinted('x', '1-2')).toBeNull()
  })
})

/* ------------------------------------------------------------------ run */

function docx(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const paras = lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l).replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">')}</w:t></w:r></w:p>`).join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) })
}

describe('import run', () => {
  let db: Db
  let dir: string
  beforeEach(() => {
    db = openDb(':memory:')
    seedMaster(db)
    dir = mkdtempSync(join(tmpdir(), 'kds-imp-'))
    mkdirSync(join(dir, '2025', 'AUGUST'), { recursive: true })
    writeFileSync(join(dir, '2025', 'AUGUST', 'cbc testa.docx'), docx(LAYOUT_B))
    writeFileSync(join(dir, '2025', 'AUGUST', 'old person.docx'), docx(OLD))
    writeFileSync(join(dir, '2025', 'AUGUST', 'thyro.docx'), docx(['Thyrocare', 'Name : MR. X']))
    writeFileSync(join(dir, '2025', 'AUGUST', 'junk.docx'), docx(['Lesson 1', 'nothing about patients']))
    writeFileSync(join(dir, '2025', 'AUGUST', 'broken.doc'), 'this is not a word file')
    writeFileSync(join(dir, '2025', 'AUGUST', 'notes.txt'), 'ignored: not a report type')
  })

  it('imports patients and results as read-only history, lists the rest, never writes into the folder', async () => {
    const progress: number[] = []
    const s = await runImport(db, dir, (p) => progress.push(p.done))
    expect(s).toMatchObject({ total: 5, imported: 2, sentOut: 1, unparsed: 2, alreadyImported: 0 })
    expect(progress.length).toBeGreaterThan(5)

    const log = importLog(db)
    expect(log.filter((l) => l.status === 'unparsed').map((l) => l.file).sort()).toEqual(['2025/AUGUST/broken.doc', '2025/AUGUST/junk.docx'])
    expect(log.find((l) => l.status === 'sentout')!.file).toContain('thyro')
    expect(log.every((l) => l.reason.length > 0)).toBe(true)

    const people = searchPeople(db, 'Testa')
    expect(people).toHaveLength(1)
    expect(people[0].source).toBe('imported')
    const rep = db.get<any>("SELECT * FROM reports WHERE status = 'imported' AND visit_id = (SELECT id FROM visits WHERE import_ref LIKE '%testa%')")
    expect(rep.is_current).toBe(1)
    const hb = db.get<any>("SELECT * FROM report_results WHERE report_id = ? AND param_code = 'hb'", rep.id)
    expect(hb).toMatchObject({ value: '9.4', panel_code: 'CBC', section: 'HAEMATOLOGY', flag: 'L' })

    // imported values appear as "previous" values for that person
    const pid = people[0].id
    expect(previousValues(db, pid, 0).hb.value).toBe('9.4')

    // read-only: cannot be saved or corrected
    expect(() => db.run("UPDATE reports SET status = 'draft' WHERE id = ?", rep.id)).not.toThrow() // db allows it; the service layer refuses
    db.run("UPDATE reports SET status = 'imported' WHERE id = ?", rep.id)
  })

  it('is safe to run twice', async () => {
    await runImport(db, dir)
    const again = await runImport(db, dir)
    expect(again.imported).toBe(0)
    expect(again.alreadyImported).toBe(3) // two reports + the Thyrocare file
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM visits WHERE source = 'imported'")!.n).toBe(2)
    // unparsed files are listed once, not once per run
    expect(importLog(db, 'unparsed')).toHaveLength(2)
  })

  it('identical result sets from the old files are caught against new reports', async () => {
    await runImport(db, dir)
    const sigs = db.all<{ panel_code: string }>('SELECT panel_code FROM result_signatures')
    expect(sigs.map((s) => s.panel_code)).toContain('CBC')
    // a new patient with the very same CBC numbers is flagged
    db.run("INSERT INTO patients(name, title, sex, phone, village, source, created_at, updated_at) VALUES('Other','Mr','M','','','app','x','x')")
    const pid = db.get<{ id: number }>("SELECT id FROM patients WHERE name = 'Other'")!.id
    db.run("INSERT INTO visits(patient_id, sample_id, visit_date, created_at) VALUES(?,?,?,?)", pid, '2610-001', '2026-10-25', 'x')
    const vid = db.get<{ id: number }>("SELECT id FROM visits WHERE sample_id = '2610-001'")!.id
    const rid = db.run("INSERT INTO reports(visit_id, version, status, is_current, created_at) VALUES(?,?,?,?,?)", vid, 1, 'draft', 1, 'x').lastId
    const imported = db.get<{ signature: string }>("SELECT signature FROM result_signatures WHERE panel_code = 'CBC' LIMIT 1")!
    db.run('INSERT INTO result_signatures(report_id, panel_code, signature) VALUES(?,?,?)', rid, 'CBC', imported.signature)
    expect(findDuplicates(db, rid).length).toBe(1)
  })
})
