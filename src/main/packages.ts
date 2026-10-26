import { audit, type Db } from './db'

export interface HealthPackage {
  id: number
  name: string
  price: number
  panelCodes: string[]
  active: boolean
}

const row = (r: any): HealthPackage => ({ id: r.id, name: r.name, price: r.price, panelCodes: JSON.parse(r.panel_codes), active: !!r.active })

export function listPackages(db: Db, opts: { includeInactive?: boolean } = {}): HealthPackage[] {
  return db.all<any>(`SELECT * FROM packages ${opts.includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`).map(row)
}

export function savePackage(db: Db, p: { id?: number; name: string; price: number; panelCodes: string[]; active?: boolean }, actor = ''): number {
  const name = p.name.trim()
  if (name.length < 2) throw new Error('Give the package a name')
  if (!(p.price >= 0)) throw new Error('The price is not valid')
  const codes = [...new Set(p.panelCodes)]
  if (codes.length < 1) throw new Error('Choose at least one test for the package')
  for (const c of codes) if (!db.get('SELECT 1 AS x FROM test_panels WHERE code = ?', c)) throw new Error(`Unknown test ${c}`)
  const clash = db.get<{ id: number }>('SELECT id FROM packages WHERE name = ? COLLATE NOCASE', name)
  if (clash && clash.id !== p.id) throw new Error('There is already a package with this name')
  return db.tx(() => {
    let id = p.id ?? 0
    if (p.id) {
      if (!db.get('SELECT 1 AS x FROM packages WHERE id = ?', p.id)) throw new Error('Package not found')
      db.run('UPDATE packages SET name = ?, price = ?, panel_codes = ?, active = ? WHERE id = ?', name, Math.round(p.price), JSON.stringify(codes), p.active === false ? 0 : 1, p.id)
    } else {
      const sort = (db.get<{ m: number | null }>('SELECT MAX(sort) AS m FROM packages')?.m ?? 0) + 1
      id = db.run('INSERT INTO packages(name, price, panel_codes, active, sort) VALUES(?,?,?,?,?)', name, Math.round(p.price), JSON.stringify(codes), p.active === false ? 0 : 1, sort).lastId
    }
    audit(db, p.id ? 'package.edit' : 'package.add', 'packages', id, `${name} ${p.price}`, actor)
    return id
  })
}

/** Old bills keep the package name they were made with, so a package can simply be deleted. */
export function removePackage(db: Db, id: number, actor = ''): void {
  const r = db.get<{ name: string }>('SELECT name FROM packages WHERE id = ?', id)
  if (!r) return
  db.run('DELETE FROM packages WHERE id = ?', id)
  audit(db, 'package.remove', 'packages', id, r.name, actor)
}

/** Starter packages with example prices (about 15% under the single-test prices), made only once, on an empty list. */
export function seedPackages(db: Db): void {
  if (db.get('SELECT 1 AS x FROM packages LIMIT 1')) return
  const starters: [string, string[]][] = [
    ['Fever panel', ['CBC', 'MPC', 'WIDAL', 'URINE']],
    ['Diabetes check', ['FBS', 'PPBS', 'HBA1C', 'URINE']],
    ['Full body checkup', ['CBC', 'FBS', 'LFT', 'KFT', 'LIPID', 'URINE']],
    ['Before an operation', ['CBC', 'BTCT', 'ABO', 'RBS', 'HIV', 'HBSAG', 'HCV']]
  ]
  db.tx(() => {
    for (const [name, codes] of starters) {
      const prices = codes.map((c) => db.get<{ price: number }>('SELECT price FROM test_panels WHERE code = ?', c)?.price)
      if (prices.some((p) => p == null)) continue
      const sum = (prices as number[]).reduce((a, b) => a + b, 0)
      savePackage(db, { name, price: Math.round((sum * 0.85) / 10) * 10, panelCodes: codes })
    }
  })
}
