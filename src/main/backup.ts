import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import type { Db } from './db'

export interface BackupInfo {
  name: string
  path: string
  createdAt: string
  patients: number
  visits: number
  reports: number
  sizeBytes: number
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function dirSize(p: string): number {
  let n = 0
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name)
    n += e.isDirectory() ? dirSize(f) : statSync(f).size
  }
  return n
}

/** A consistent copy of the database (VACUUM INTO) plus attachments, in a dated folder. */
export function createBackup(db: Db, dataDir: string, destDir: string, now = new Date(), prefix = 'KDS-backup'): string {
  mkdirSync(destDir, { recursive: true })
  let dir = join(destDir, `${prefix}-${stamp(now)}`)
  for (let i = 2; existsSync(dir); i++) dir = join(destDir, `${prefix}-${stamp(now)}-${i}`)
  const tmp = `${dir}.partial`
  mkdirSync(tmp, { recursive: true })
  db.exec(`VACUUM INTO '${join(tmp, 'kds.db').replace(/'/g, "''")}'`)
  for (const sub of ['attachments']) {
    const src = join(dataDir, sub)
    if (existsSync(src)) cpSync(src, join(tmp, sub), { recursive: true })
  }
  const count = (t: string) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n
  writeFileSync(
    join(tmp, 'backup.json'),
    JSON.stringify({ app: 'KDS Lab Desk', createdAt: now.toISOString(), patients: count('patients'), visits: count('visits'), reports: count('reports') }, null, 2)
  )
  renameSync(tmp, dir)
  return dir
}

export function listBackups(dir: string, prefix = ''): BackupInfo[] {
  if (!existsSync(dir)) return []
  const out: BackupInfo[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.endsWith('.partial')) continue
    if (prefix && !e.name.startsWith(prefix)) continue
    const info = readBackupInfo(join(dir, e.name))
    if (info) out.push(info)
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function readBackupInfo(path: string): BackupInfo | null {
  const meta = join(path, 'backup.json')
  if (!existsSync(join(path, 'kds.db')) || !existsSync(meta)) return null
  try {
    const m = JSON.parse(readFileSync(meta, 'utf8'))
    return { name: path.split(/[\\/]/).pop()!, path, createdAt: m.createdAt, patients: m.patients, visits: m.visits, reports: m.reports, sizeBytes: dirSize(path) }
  } catch {
    return null
  }
}

/** Open the backup read-only and make sure it is a real, intact KDS database. */
export function validateBackup(path: string): { ok: boolean; error?: string; info?: BackupInfo } {
  const info = readBackupInfo(path)
  if (!info) return { ok: false, error: 'This folder is not a KDS Lab Desk backup.' }
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(join(path, 'kds.db'), { readOnly: true })
    const chk = db.prepare('PRAGMA integrity_check').get() as Record<string, string>
    if (Object.values(chk)[0] !== 'ok') return { ok: false, error: 'The backup file is damaged.' }
    db.prepare('SELECT COUNT(*) FROM patients').get()
    return { ok: true, info }
  } catch (e) {
    return { ok: false, error: `Cannot read the backup: ${(e as Error).message}` }
  } finally {
    db?.close()
  }
}

/** Keep only the newest `keep` backups in a folder. Returns the number removed. */
export function pruneBackups(dir: string, keep: number, prefix = 'KDS-backup'): number {
  const all = listBackups(dir, prefix)
  let n = 0
  for (const b of all.slice(keep)) {
    rmSync(b.path, { recursive: true, force: true })
    n++
  }
  return n
}

/**
 * Put a backup in place of the live data. The database must be closed first.
 * The current files are kept in `<dataDir>/before-restore-<time>` so nothing is lost.
 */
export function restoreBackup(backupPath: string, dataDir: string, now = new Date()): string {
  const v = validateBackup(backupPath)
  if (!v.ok) throw new Error(v.error)
  // copy first, so a full disk or a pulled pen drive fails before anything is moved
  const staged = join(dataDir, 'kds.db.restoring')
  cpSync(join(backupPath, 'kds.db'), staged)
  const safe = join(dataDir, `before-restore-${stamp(now)}`)
  mkdirSync(safe, { recursive: true })
  for (const f of ['kds.db', 'kds.db-wal', 'kds.db-shm']) {
    const p = join(dataDir, f)
    if (existsSync(p)) renameSync(p, join(safe, f))
  }
  if (existsSync(join(dataDir, 'attachments'))) renameSync(join(dataDir, 'attachments'), join(safe, 'attachments'))
  try {
    renameSync(staged, join(dataDir, 'kds.db'))
    if (existsSync(join(backupPath, 'attachments'))) cpSync(join(backupPath, 'attachments'), join(dataDir, 'attachments'), { recursive: true })
  } catch (e) {
    // put the old data back
    for (const f of ['kds.db', 'kds.db-wal', 'kds.db-shm', 'attachments']) {
      const kept = join(safe, f)
      if (existsSync(kept)) {
        rmSync(join(dataDir, f), { recursive: true, force: true })
        renameSync(kept, join(dataDir, f))
      }
    }
    throw e
  }
  return safe
}

/** Removable (USB) drive letters, e.g. ["E:\\"]. Empty when none or not on Windows. */
export function listRemovableDrives(): Promise<{ letter: string; label: string; freeBytes: number }[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,FreeSpace | ConvertTo-Json -Compress"],
      { timeout: 15000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve([])
        try {
          const j = JSON.parse(stdout)
          const arr = Array.isArray(j) ? j : [j]
          resolve(arr.map((d: any) => ({ letter: `${d.DeviceID}\\`, label: d.VolumeName || 'Pen drive', freeBytes: Number(d.FreeSpace) || 0 })))
        } catch {
          resolve([])
        }
      }
    )
  })
}
