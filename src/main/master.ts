import { MASTER, bandDays } from '../shared/masterData'
import type { PanelDef, ParamDef, RangeRow } from '../shared/types'
import { audit, nowIso, type Db } from './db'

export function seedMaster(db: Db): void {
  const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM test_panels')!.n
  if (n > 0) return
  const now = nowIso()
  db.tx(() => {
    MASTER.forEach((sp, i) => {
      const pid = db.run(
        'INSERT INTO test_panels(code, name, section, price, specimen, sort, sent_out, bundle_codes) VALUES(?,?,?,?,?,?,?,?)',
        sp.code, sp.name, sp.section, sp.price, sp.specimen ?? 'Blood', i, sp.sentOut ? 1 : 0, JSON.stringify(sp.bundle ?? [])
      ).lastId
      sp.params.forEach((q, j) => {
        const qid = db.run(
          `INSERT INTO test_params(panel_id, code, name, type, unit, decimals, options, normal, calc, grp, sort,
            plausible_min, plausible_max, critical_low, critical_high) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          pid, q.code, q.name, q.type ?? 'numeric', q.unit ?? '', q.dec ?? 0, JSON.stringify(q.options ?? []),
          JSON.stringify(q.normal ?? []), q.calc ?? null, q.group ?? null, j, q.pMin ?? null, q.pMax ?? null, q.cLow ?? null, q.cHigh ?? null
        ).lastId
        for (const [sex, band, low, high, text] of q.ranges ?? []) {
          const [a, b] = bandDays(band)
          db.run(
            'INSERT INTO ref_ranges(param_id, version, sex, age_min_days, age_max_days, low, high, text, valid_from, reason) VALUES(?,?,?,?,?,?,?,?,?,?)',
            qid, 1, sex, a, b, low, high, text ?? null, now, 'Default'
          )
        }
      })
    })
    audit(db, 'master.seed', 'master')
  })
}

export function loadMaster(db: Db, opts: { includeInactive?: boolean } = {}): PanelDef[] {
  const panels = db.all<any>(`SELECT * FROM test_panels ${opts.includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`)
  const params = db.all<any>('SELECT * FROM test_params ORDER BY panel_id, sort, id')
  const ranges = db.all<any>('SELECT * FROM ref_ranges WHERE valid_to IS NULL ORDER BY param_id, id')
  const rangesByParam = new Map<number, any[]>()
  for (const r of ranges) {
    if (!rangesByParam.has(r.param_id)) rangesByParam.set(r.param_id, [])
    rangesByParam.get(r.param_id)!.push(r)
  }
  const paramsByPanel = new Map<number, ParamDef[]>()
  for (const q of params) {
    const rr = rangesByParam.get(q.id) ?? []
    const def: ParamDef = {
      id: q.id, panelId: q.panel_id, code: q.code, name: q.name, type: q.type, unit: q.unit, decimals: q.decimals,
      options: JSON.parse(q.options), normal: JSON.parse(q.normal), calc: q.calc, group: q.grp, sort: q.sort,
      plausibleMin: q.plausible_min, plausibleMax: q.plausible_max, criticalLow: q.critical_low, criticalHigh: q.critical_high,
      rangeVersion: rr.length ? Math.max(...rr.map((r) => r.version)) : 1,
      ranges: rr.map((r): RangeRow => ({ sex: r.sex, ageMinDays: r.age_min_days, ageMaxDays: r.age_max_days, low: r.low, high: r.high, text: r.text }))
    }
    if (!paramsByPanel.has(q.panel_id)) paramsByPanel.set(q.panel_id, [])
    paramsByPanel.get(q.panel_id)!.push(def)
  }
  return panels.map((p) => ({
    id: p.id, code: p.code, name: p.name, section: p.section, price: p.price, specimen: p.specimen, sort: p.sort,
    sentOut: !!p.sent_out, active: !!p.active, bundleCodes: JSON.parse(p.bundle_codes), params: paramsByPanel.get(p.id) ?? []
  }))
}

export interface ParamEdit {
  paramId: number
  unit?: string
  decimals?: number
  ranges?: RangeRow[]
  criticalLow?: number | null
  criticalHigh?: number | null
  reason?: string
}

/** Replace a parameter's ranges with a new version; the old rows are kept with valid_to set. */
export function editParam(db: Db, e: ParamEdit, actor = ''): void {
  const q = db.get<any>('SELECT * FROM test_params WHERE id = ?', e.paramId)
  if (!q) throw new Error('Parameter not found')
  db.tx(() => {
    if (e.unit !== undefined || e.decimals !== undefined || e.criticalLow !== undefined || e.criticalHigh !== undefined) {
      db.run(
        'UPDATE test_params SET unit = ?, decimals = ?, critical_low = ?, critical_high = ? WHERE id = ?',
        e.unit ?? q.unit, e.decimals ?? q.decimals,
        e.criticalLow !== undefined ? e.criticalLow : q.critical_low,
        e.criticalHigh !== undefined ? e.criticalHigh : q.critical_high, e.paramId
      )
    }
    if (e.ranges) {
      const now = nowIso()
      const cur = db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM ref_ranges WHERE param_id = ?', e.paramId)?.v ?? 0
      db.run('UPDATE ref_ranges SET valid_to = ? WHERE param_id = ? AND valid_to IS NULL', now, e.paramId)
      for (const r of e.ranges) {
        db.run(
          'INSERT INTO ref_ranges(param_id, version, sex, age_min_days, age_max_days, low, high, text, valid_from, reason) VALUES(?,?,?,?,?,?,?,?,?,?)',
          e.paramId, cur + 1, r.sex, r.ageMinDays, r.ageMaxDays, r.low, r.high, r.text ?? null, now, e.reason ?? ''
        )
      }
    }
    audit(db, 'master.edit_param', 'test_params', e.paramId, JSON.stringify({ code: q.code, reason: e.reason ?? '' }), actor)
  })
}

export function setPanelPrice(db: Db, panelId: number, price: number): void {
  db.run('UPDATE test_panels SET price = ? WHERE id = ?', price, panelId)
  audit(db, 'master.price', 'test_panels', panelId, String(price))
}

export function setPanelActive(db: Db, panelId: number, active: boolean): void {
  db.run('UPDATE test_panels SET active = ? WHERE id = ?', active ? 1 : 0, panelId)
  audit(db, 'master.active', 'test_panels', panelId, String(active))
}

export function rangeHistory(db: Db, paramId: number) {
  return db.all('SELECT version, sex, age_min_days, age_max_days, low, high, text, valid_from, valid_to, reason FROM ref_ranges WHERE param_id = ? ORDER BY version DESC, id', paramId)
}
