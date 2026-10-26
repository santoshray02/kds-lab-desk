import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

type Param = string | number | bigint | null | Buffer | Uint8Array | boolean | undefined

const norm = (p: Param[]) => p.map((x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x)) as (string | number | bigint | null | Buffer | Uint8Array)[]

/** Thin helper around node:sqlite so services stay short and testable against ':memory:'. */
export class Db {
  readonly raw: DatabaseSync
  private depth = 0

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA foreign_keys = ON;')
    if (path !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  }

  all<T = Record<string, any>>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...norm(params)).map((r) => ({ ...r })) as T[]
  }
  get<T = Record<string, any>>(sql: string, ...params: Param[]): T | undefined {
    const r = this.raw.prepare(sql).get(...norm(params))
    return r ? ({ ...r } as T) : undefined
  }
  run(sql: string, ...params: Param[]): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(...norm(params))
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }
  }
  exec(sql: string) {
    this.raw.exec(sql)
  }

  /** Run `fn` inside a transaction; nested calls join the outer one. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    this.depth++
    try {
      const out = fn()
      this.raw.exec('COMMIT')
      return out
    } catch (e) {
      this.raw.exec('ROLLBACK')
      throw e
    } finally {
      this.depth--
    }
  }

  close() {
    this.raw.close()
  }
}

export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE test_panels(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, section TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0, specimen TEXT NOT NULL DEFAULT 'Blood', sort INTEGER NOT NULL DEFAULT 0,
  sent_out INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, bundle_codes TEXT NOT NULL DEFAULT '[]');
CREATE TABLE test_params(
  id INTEGER PRIMARY KEY, panel_id INTEGER NOT NULL REFERENCES test_panels(id), code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, type TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', decimals INTEGER NOT NULL DEFAULT 0,
  options TEXT NOT NULL DEFAULT '[]', normal TEXT NOT NULL DEFAULT '[]', calc TEXT, grp TEXT, sort INTEGER NOT NULL DEFAULT 0,
  plausible_min REAL, plausible_max REAL, critical_low REAL, critical_high REAL);
-- every edit to a parameter's ranges writes a new version; old rows get valid_to
CREATE TABLE ref_ranges(
  id INTEGER PRIMARY KEY, param_id INTEGER NOT NULL REFERENCES test_params(id), version INTEGER NOT NULL,
  sex TEXT NOT NULL, age_min_days INTEGER NOT NULL, age_max_days INTEGER NOT NULL, low REAL, high REAL, text TEXT,
  valid_from TEXT NOT NULL, valid_to TEXT, reason TEXT);
CREATE INDEX ix_ranges_param ON ref_ranges(param_id, valid_to);

CREATE TABLE doctors(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, uses INTEGER NOT NULL DEFAULT 0, last_used TEXT);

CREATE TABLE patients(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', sex TEXT NOT NULL DEFAULT 'M',
  phone TEXT NOT NULL DEFAULT '', village TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX ix_patients_phone ON patients(phone);
CREATE INDEX ix_patients_name ON patients(name COLLATE NOCASE);

CREATE TABLE visits(
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), sample_id TEXT NOT NULL UNIQUE,
  visit_date TEXT NOT NULL, age_y INTEGER NOT NULL DEFAULT 0, age_m INTEGER NOT NULL DEFAULT 0, age_d INTEGER NOT NULL DEFAULT 0,
  doctor TEXT NOT NULL DEFAULT 'Self', specimen TEXT NOT NULL DEFAULT 'Blood', total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'app',
  import_ref TEXT, cancelled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX ix_visits_patient ON visits(patient_id);
CREATE INDEX ix_visits_date ON visits(visit_date);
CREATE INDEX ix_visits_doctor ON visits(doctor COLLATE NOCASE);

CREATE TABLE visit_tests(
  id INTEGER PRIMARY KEY, visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE, panel_id INTEGER,
  panel_code TEXT NOT NULL, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sent_out INTEGER NOT NULL DEFAULT 0,
  sent_to TEXT, sent_at TEXT, received_at TEXT, attachment TEXT);
CREATE INDEX ix_vt_visit ON visit_tests(visit_id);

CREATE TABLE payments(
  id INTEGER PRIMARY KEY, visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  amount REAL NOT NULL, paid_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE INDEX ix_pay_visit ON payments(visit_id);
CREATE INDEX ix_pay_date ON payments(paid_at);

CREATE TABLE reports(
  id INTEGER PRIMARY KEY, visit_id INTEGER NOT NULL REFERENCES visits(id), version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, approved_at TEXT,
  approved_by TEXT, reason TEXT, dup_reason TEXT, superseded_at TEXT, pdf_path TEXT, share_code TEXT, share_pin TEXT,
  UNIQUE(visit_id, version));
CREATE INDEX ix_reports_visit ON reports(visit_id);

CREATE TABLE report_results(
  id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  panel_code TEXT, panel_name TEXT NOT NULL, section TEXT NOT NULL, param_code TEXT, name TEXT NOT NULL, grp TEXT,
  type TEXT NOT NULL DEFAULT 'numeric', value TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', range_text TEXT NOT NULL DEFAULT '',
  flag TEXT, critical INTEGER NOT NULL DEFAULT 0, auto INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
CREATE INDEX ix_rr_report ON report_results(report_id);
CREATE INDEX ix_rr_param ON report_results(param_code);

CREATE TABLE result_signatures(
  id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  panel_code TEXT NOT NULL, signature TEXT NOT NULL);
CREATE INDEX ix_sig ON result_signatures(signature);

CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '', entity_id INTEGER, detail TEXT NOT NULL DEFAULT '');

CREATE TABLE outbox(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, op TEXT NOT NULL,
  payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_try TEXT, done_at TEXT, last_error TEXT);
CREATE INDEX ix_outbox_pending ON outbox(done_at, next_try);

CREATE TABLE import_log(
  id INTEGER PRIMARY KEY, run_at TEXT NOT NULL, file TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  visit_id INTEGER, file_hash TEXT);
CREATE INDEX ix_import_file ON import_log(file_hash);
`
  },
  {
    id: 2,
    name: 'vitals on visits',
    sql: `
ALTER TABLE visits ADD COLUMN height_cm REAL;
ALTER TABLE visits ADD COLUMN weight_kg REAL;
ALTER TABLE visits ADD COLUMN bp_sys INTEGER;
ALTER TABLE visits ADD COLUMN bp_dia INTEGER;
ALTER TABLE visits ADD COLUMN pulse INTEGER;
ALTER TABLE visits ADD COLUMN temp_f REAL;
ALTER TABLE visits ADD COLUMN spo2 INTEGER;
`
  }
]

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const done = new Set(db.all<{ id: number }>('SELECT id FROM schema_migrations').map((r) => r.id))
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue
    db.tx(() => {
      db.exec(m.sql)
      db.run('INSERT INTO schema_migrations(id, name, applied_at) VALUES(?,?,?)', m.id, m.name, new Date().toISOString())
    })
  }
}

export function openDb(path: string): Db {
  const db = new Db(path)
  migrate(db)
  return db
}

/** The app's clock; tests replace `now` so dates stay fixed. */
export const clock = { now: () => new Date() }
export const nowIso = () => clock.now().toISOString()

export function audit(db: Db, action: string, entity = '', entityId: number | null = null, detail = '', actor = ''): void {
  db.run('INSERT INTO audit_log(at, actor, action, entity, entity_id, detail) VALUES(?,?,?,?,?,?)', nowIso(), actor, action, entity, entityId, detail)
}

/** Queue a change for cloud sync (does nothing until sync is configured, but is always recorded). */
export function enqueue(db: Db, entity: string, entityId: number, op: 'upsert' | 'delete' = 'upsert', payload: unknown = {}): void {
  db.run('INSERT INTO outbox(at, entity, entity_id, op, payload) VALUES(?,?,?,?,?)', nowIso(), entity, entityId, op, JSON.stringify(payload))
}
