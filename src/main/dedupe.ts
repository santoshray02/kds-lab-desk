import { audit, enqueue, nowIso, type Db } from './db'
import { getPatient, type PatientRow } from './patients'

export interface DupPerson {
  id: number
  title: string
  name: string
  sex: string
  phone: string
  village: string
  source: string
  visits: number
  lastVisit: string | null
}

export interface DupPair {
  a: DupPerson
  b: DupPerson
  reason: string
}

const TITLES = /^(mr|mrs|miss|ms|master|baby|dr|smt|shri|sri|shrimati|kumari|md)\b\.?\s*/i

/** A name as a person would compare it: no title, no dots or spaces, lower case. */
export function normName(name: string): string {
  let n = name.trim().toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ')
  for (let i = 0; i < 2; i++) n = n.replace(TITLES, '')
  return n.replace(/[^\p{L}\p{N}]/gu, '')
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 3) return 4
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

const person = (db: Db, r: PatientRow): DupPerson => {
  const v = db.get<{ n: number; d: string | null }>('SELECT COUNT(*) n, MAX(visit_date) d FROM visits WHERE patient_id = ? AND cancelled = 0', r.id)!
  return { id: r.id, title: r.title, name: r.name, sex: r.sex, phone: r.phone, village: r.village, source: r.source, visits: v.n, lastVisit: v.d }
}

/**
 * People who may be the same person registered twice: the same name (ignoring titles and spelling of dots and spaces) and sex
 * with the same phone, a missing phone or the same village; or the same phone and sex with a name one letter apart (brothers like Anil and Sunil stay apart).
 */
export function findDuplicates(db: Db, limit = 100): DupPair[] {
  const rows = db.all<PatientRow>('SELECT * FROM patients ORDER BY id')
  const pairs = new Map<string, { a: PatientRow; b: PatientRow; reason: string }>()
  const add = (a: PatientRow, b: PatientRow, reason: string) => {
    const k = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`
    if (!pairs.has(k)) pairs.set(k, a.id < b.id ? { a, b, reason } : { a: b, b: a, reason })
  }
  const byName = new Map<string, PatientRow[]>()
  const byPhone = new Map<string, PatientRow[]>()
  for (const r of rows) {
    const n = normName(r.name)
    if (n.length < 3) continue
    const k = `${r.sex}|${n}`
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k)!.push(r)
    if (r.phone) {
      const pk = `${r.sex}|${r.phone}`
      if (!byPhone.has(pk)) byPhone.set(pk, [])
      byPhone.get(pk)!.push(r)
    }
  }
  for (const g of byName.values()) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = g[i], b = g[j]
      if (a.phone && a.phone === b.phone) add(a, b, 'Same name and phone number')
      else if (!a.phone || !b.phone) add(a, b, 'Same name; one has no phone number')
      else if (a.village && a.village.toLowerCase() === b.village.toLowerCase()) add(a, b, 'Same name and village')
    }
  }
  for (const g of byPhone.values()) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const na = normName(g[i].name), nb = normName(g[j].name)
      const d = editDistance(na, nb)
      if (d === 1 || (d === 2 && Math.min(na.length, nb.length) >= 14)) add(g[i], g[j], 'Same phone number and a very similar name')
    }
  }
  return [...pairs.values()].slice(0, limit).map((p) => ({ a: person(db, p.a), b: person(db, p.b), reason: p.reason }))
}

/**
 * Join two records of one person: all visits of `dropId` move to `keepId`, missing details are filled from the other record,
 * and the extra record is removed. Reports of the moved visits will print the kept person's name and details.
 */
export function mergePatients(db: Db, keepId: number, dropId: number, actor = ''): { moved: number } {
  if (keepId === dropId) throw new Error('Choose two different people')
  const keep = getPatient(db, keepId)
  const drop = getPatient(db, dropId)
  if (!keep || !drop) throw new Error('Person not found')
  if (keep.sex !== drop.sex) throw new Error('One record is Male and the other Female. Correct the sex with "Edit details" first, then merge.')
  return db.tx(() => {
    const visitIds = db.all<{ id: number }>('SELECT id FROM visits WHERE patient_id = ?', dropId).map((v) => v.id)
    db.run('UPDATE visits SET patient_id = ? WHERE patient_id = ?', keepId, dropId)
    db.run(
      'UPDATE patients SET phone = CASE WHEN phone = \'\' THEN ? ELSE phone END, village = CASE WHEN village = \'\' THEN ? ELSE village END, title = CASE WHEN title = \'\' THEN ? ELSE title END, updated_at = ? WHERE id = ?',
      drop.phone, drop.village, drop.title, nowIso(), keepId
    )
    for (const vid of visitIds) {
      // printed copies must carry the kept person's name: drop cached PDFs and tell the cloud
      for (const r of db.all<{ id: number; status: string }>('SELECT id, status FROM reports WHERE visit_id = ?', vid)) {
        db.run('UPDATE reports SET pdf_path = NULL WHERE id = ?', r.id)
        if (r.status === 'approved') enqueue(db, 'report', r.id)
      }
      enqueue(db, 'visit', vid)
    }
    db.run('DELETE FROM patients WHERE id = ?', dropId)
    enqueue(db, 'patient', keepId)
    enqueue(db, 'patient', dropId, 'delete')
    audit(db, 'patient.merge', 'patients', keepId, `${drop.name} (#${dropId}, ${visitIds.length} visits) -> ${keep.name} (#${keepId})`, actor)
    return { moved: visitIds.length }
  })
}
