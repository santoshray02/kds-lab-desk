import { audit, type Db } from './db'
import { approveReport, getEntry, saveDraft } from './results'
import { clock } from './patients'
import { setSettings } from './settings'
import { createVisit } from './visits'

/** Small deterministic random generator so the demo data is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const f = (n: number, d: number) => n.toFixed(d)

interface DemoPerson {
  name: string
  title: string
  sex: 'M' | 'F'
  age: number
  phone: string
  village: string
  doctor: string
  panels: string[]
  daysAgo: number
  abnormal?: boolean
  paid?: number
}

// All names and numbers are invented. Phones use an obviously fake 98000 prefix.
const PEOPLE: DemoPerson[] = [
  { name: 'Rekha Kumari', title: 'Mrs', sex: 'F', age: 34, phone: '9800041207', village: 'Dalsingsarai', doctor: 'Dr. A. Kumar', panels: ['CBC', 'MPC', 'WIDAL', 'RBS'], daysAgo: 0, abnormal: true, paid: 650 },
  { name: 'Suresh Ray', title: 'Mr', sex: 'M', age: 40, phone: '9800041207', village: 'Dalsingsarai', doctor: 'Dr. A. Kumar', panels: ['LFT', 'LIPID'], daysAgo: 0, paid: 400 },
  { name: 'Anu', title: 'Baby', sex: 'F', age: 3, phone: '9800041207', village: 'Dalsingsarai', doctor: 'Dr. S. Prasad', panels: ['CBC', 'ESR'], daysAgo: 0, paid: 260 },
  { name: 'Mohan Lal Demo', title: 'Mr', sex: 'M', age: 52, phone: '9800012345', village: 'Sardarganj', doctor: 'Self', panels: ['KFT', 'RBS', 'URINE'], daysAgo: 1, paid: 300 },
  { name: 'Geeta Devi Demo', title: 'Mrs', sex: 'F', age: 45, phone: '9800023456', village: 'Vidyapati Nagar', doctor: 'Dr. S. Prasad', panels: ['CBC', 'LFT', 'HIV', 'HBSAG'], daysAgo: 1, paid: 1000 },
  { name: 'Ravi Kumar Demo', title: 'Mr', sex: 'M', age: 28, phone: '', village: 'Mohiuddinnagar', doctor: 'Dr. A. Kumar', panels: ['CBC', 'ABO', 'FBS'], daysAgo: 2, paid: 330 },
  { name: 'Sita Kumari Demo', title: 'Miss', sex: 'F', age: 19, phone: '9800034567', village: 'Dalsingsarai', doctor: 'Dr. M. Jha', panels: ['CBC', 'ESR', 'UPT'], daysAgo: 3, abnormal: true, paid: 360 },
  { name: 'Bablu Demo', title: 'Master', sex: 'M', age: 7, phone: '9800045678', village: 'Sardarganj', doctor: 'Dr. S. Prasad', panels: ['CBC', 'WIDAL', 'MPC'], daysAgo: 4, paid: 450 },
  { name: 'Hari Prasad Demo', title: 'Mr', sex: 'M', age: 61, phone: '9800056789', village: 'Bibhutipur', doctor: 'Dr. M. Jha', panels: ['LIPID', 'FBS', 'PPBS', 'HBA1C'], daysAgo: 5, paid: 500 },
  { name: 'Pooja Demo', title: 'Mrs', sex: 'F', age: 26, phone: '9800067890', village: 'Dalsingsarai', doctor: 'Dr. A. Kumar', panels: ['CBC', 'THYROID'], daysAgo: 6, paid: 650 },
  { name: 'Ajay Demo', title: 'Mr', sex: 'M', age: 33, phone: '9800078901', village: 'Pusa Road', doctor: 'Self', panels: ['SEMEN'], daysAgo: 8, paid: 300 },
  { name: 'Kamla Demo', title: 'Mrs', sex: 'F', age: 58, phone: '9800089012', village: 'Dalsingsarai', doctor: 'Dr. S. Prasad', panels: ['CBC', 'KFT', 'ELEC'], daysAgo: 9, abnormal: true }
]

function valuesFor(panel: string, p: DemoPerson, r: () => number): Record<string, string> {
  const adultF = p.sex === 'F'
  switch (panel) {
    case 'CBC': {
      const hb = p.abnormal ? 8.2 + r() * 1.5 : (adultF ? 12 : 14) + r() * 2
      const rbc = p.abnormal ? 3.6 + r() * 0.4 : 4.4 + r() * 0.8
      const pcv = hb * 3 + r()
      const neut = Math.round(p.abnormal ? 74 + r() * 8 : 55 + r() * 10)
      const eos = Math.round(2 + r() * 3)
      const mono = Math.round(2 + r() * 4)
      const baso = 0
      const lymph = 100 - neut - eos - mono - baso
      return {
        hb: f(hb, 1), tlc: String(Math.round((p.abnormal ? 11500 : 6500) + r() * 3000)), neut: String(neut), lymph: String(lymph),
        eos: String(eos), mono: String(mono), baso: String(baso), rbc: f(rbc, 2), pcv: f(pcv, 1), plt: f(p.abnormal ? 1.2 + r() * 0.3 : 2.1 + r() * 1.5, 2)
      }
    }
    case 'ESR': return { esr: String(Math.round(p.abnormal ? 30 + r() * 20 : 6 + r() * 8)) }
    case 'RBS': return { rbs: f(95 + r() * 60, 0) }
    case 'FBS': return { fbs: f(80 + r() * 40, 0) }
    case 'PPBS': return { ppbs: f(110 + r() * 60, 0) }
    case 'HBA1C': return { hba1c: f(5.2 + r() * 2, 1) }
    case 'LFT': return { tbili: f(0.6 + r() * 0.6, 2), dbili: f(0.1 + r() * 0.1, 2), sgpt: f(22 + r() * 25, 1), sgot: f(24 + r() * 20, 1), alp: f(90 + r() * 60, 0), tprot: f(6.4 + r() * 1, 2), albumin: f(3.8 + r() * 0.8, 2) }
    case 'KFT': return { urea: f(22 + r() * 18, 1), creat: f(0.7 + r() * 0.4, 2), uric: f(3.6 + r() * 2.2, 1), na: f(137 + r() * 6, 0), k: f(3.8 + r() * 1, 1), cl: f(100 + r() * 6, 0) }
    case 'ELEC': return { na_e: f(137 + r() * 6, 0), k_e: f(3.9 + r() * 0.9, 1), cl_e: f(100 + r() * 6, 0) }
    case 'LIPID': return { tchol: f(150 + r() * 70, 0), hdl: f(38 + r() * 20, 0), tg: f(90 + r() * 90, 0) }
    case 'WIDAL': return { widal: p.abnormal ? 'Positive' : 'Negative', wo: p.abnormal ? '80' : '0', wh: p.abnormal ? '40' : '0', wah: '0', wbh: '0' }
    case 'MPC': return { mp_pf: 'Negative', mp_pv: 'Negative' }
    case 'HIV': return { hiv: 'Negative' }
    case 'HBSAG': return { hbsag: 'Negative' }
    case 'ABO': return { abo: ['A', 'B', 'O', 'AB'][Math.floor(r() * 4)], rh: 'Positive' }
    case 'UPT': return { upt: 'Negative' }
    case 'URINE': return { u_vol: '20', u_col: 'Pale yellow', u_trans: 'Clear', u_react: 'Acidic', u_alb: 'Nil', u_sug: 'Nil', u_pus: '2-3', u_rbc: 'Nil', u_epi: '1-2', u_cast: 'Nil', u_cry: 'Nil' }
    case 'SEMEN': return { s_vol: '2.5', s_app: 'Greyish white', s_liq: '25', s_cnt: f(40 + r() * 40, 1), s_mot: f(50 + r() * 20, 0), s_morph: f(5 + r() * 5, 0), s_ph: '7.6', s_pus: '1-2', s_rbc: 'Nil' }
    default: return {}
  }
}

export function seedDemo(db: Db): { visits: number } {
  const saved = clock.now
  const real = saved()
  let n = 0
  try {
    PEOPLE.forEach((p, i) => {
      const d = new Date(real.getFullYear(), real.getMonth(), real.getDate() - p.daysAgo, 9 + (i % 6), 15)
      clock.now = () => d
      const ageObj = p.age < 1 ? { years: 0, months: 6, days: 0 } : { years: p.age, months: 0, days: 0 }
      // people sharing a phone number are the same family: reuse the visit's patient row if already created
      const existing = p.phone ? db.get<{ id: number }>('SELECT id FROM patients WHERE phone = ? AND name = ? AND source = ?', p.phone, p.name, 'demo') : undefined
      const r = createVisit(db, {
        patient: { id: existing?.id, name: p.name, title: p.title, sex: p.sex, phone: p.phone, village: p.village },
        age: ageObj, doctor: p.doctor, panelCodes: p.panels, paid: p.paid ?? 0
      })
      db.run("UPDATE patients SET source = 'demo' WHERE id = ?", r.patientId)
      db.run("UPDATE visits SET source = 'demo' WHERE id = ?", r.visitId)
      n++
      // the most recent three visits stay un-reported so the worklist has something to show
      if (p.daysAgo === 0 && i > 0) return
      const entry = getEntry(db, r.visitId)
      if (!entry.reportId) return
      const rand = rng(1000 + i * 37)
      let typed: Record<string, string> = {}
      for (const code of p.panels) typed = { ...typed, ...valuesFor(code, p, rand) }
      saveDraft(db, entry.reportId, typed)
      approveReport(db, entry.reportId, { dupReason: 'demo data' })
    })
  } finally {
    clock.now = saved
  }
  setSettings(db, { demoMode: true })
  audit(db, 'demo.seed', 'demo', null, String(n))
  return { visits: n }
}

export function clearDemo(db: Db): { visits: number } {
  const ids = db.all<{ id: number }>("SELECT id FROM visits WHERE source = 'demo'").map((r) => r.id)
  db.tx(() => {
    for (const id of ids) {
      db.run('DELETE FROM reports WHERE visit_id = ?', id)
      db.run('DELETE FROM visits WHERE id = ?', id)
    }
    db.run("DELETE FROM patients WHERE source = 'demo'")
    setSettings(db, { demoMode: false })
    audit(db, 'demo.clear', 'demo', null, String(ids.length))
  })
  return { visits: ids.length }
}
