import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup, validateBackup } from './backup'
import { audit, type Db } from './db'
import { DriveClient, DriveError, type RemoteFile, type SecretStore } from './gdrive'
import { lockBackup, unlockBackup, WrongPassword } from './lockedBackup'
import { AppError } from './results'
import { getSettings, setSettings } from './settings'

export interface CloudDeps {
  drive: DriveClient
  secrets: SecretStore
}

/** How many nightly copies stay on Google Drive. */
export const KEEP_ON_DRIVE = 30
export const MIN_PASSWORD = 6

const stamp = (d: Date) => d.toISOString().replace(/[:T]/g, '-').slice(0, 19)

function asAppError(e: unknown): never {
  if (e instanceof DriveError) throw new AppError('DRIVE', e.message)
  if (e instanceof WrongPassword) throw new AppError('PASSWORD', e.message)
  throw e
}

export function driveStatus(db: Db, d: CloudDeps) {
  const s = getSettings(db).driveBackup
  return { available: d.drive.configured, connected: s.connected && !!d.secrets.read(), account: s.account, lastBackup: s.lastBackup, lastError: s.lastError }
}

/** Sign in with Google and remember the backup password (encrypted by Windows for this user). */
export async function connectDrive(db: Db, d: CloudDeps, password: string, openBrowser: (url: string) => void) {
  if (password.length < MIN_PASSWORD) throw new AppError('INVALID', `The backup password needs at least ${MIN_PASSWORD} characters.`)
  try {
    const { refreshToken, email } = await d.drive.authorize(openBrowser)
    d.secrets.write({ refreshToken, password })
    setSettings(db, { driveBackup: { connected: true, account: email, lastBackup: '', lastError: '' } })
    audit(db, 'drive.connect', 'backup', null, email)
  } catch (e) {
    asAppError(e)
  }
  return driveStatus(db, d)
}

/** Forgets the sign-in on this PC and at Google. Backups already on Drive stay there. */
export async function disconnectDrive(db: Db, d: CloudDeps) {
  await d.drive.revoke()
  d.secrets.clear()
  const s = getSettings(db).driveBackup
  setSettings(db, { driveBackup: { ...s, connected: false } })
  audit(db, 'drive.disconnect', 'backup', null, s.account)
  return driveStatus(db, d)
}

/** Makes a copy, locks it with the password, uploads it, and trims Drive to the newest 30. Records success or the error. */
export async function runDriveBackup(db: Db, dataDir: string, d: CloudDeps, now = new Date()): Promise<RemoteFile[]> {
  const secrets = d.secrets.read()
  if (!secrets) throw new AppError('DRIVE', 'Google Drive is not connected.')
  const tmp = mkdtempSync(join(tmpdir(), 'kds-drive-'))
  try {
    const dir = createBackup(db, dataDir, tmp, now, 'KDS-backup')
    await d.drive.upload(`KDS-backup-${stamp(now)}.kdsb`, lockBackup(dir, secrets.password))
    const all = await d.drive.list()
    for (const old of all.slice(KEEP_ON_DRIVE)) await d.drive.remove(old.id)
    setSettings(db, { driveBackup: { ...getSettings(db).driveBackup, lastBackup: now.toISOString(), lastError: '' } })
    return all.slice(0, KEEP_ON_DRIVE)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setSettings(db, { driveBackup: { ...getSettings(db).driveBackup, lastError: msg } })
    return asAppError(e)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

let running = false

/** Called every few minutes: uploads when connected and the last upload is over 20 hours old. Never throws. */
export async function driveBackupIfDue(db: Db, dataDir: string, d: CloudDeps, now = new Date()): Promise<boolean> {
  const s = getSettings(db).driveBackup
  if (running || !s.connected) return false
  if (s.lastBackup && now.getTime() - new Date(s.lastBackup).getTime() < 20 * 3600 * 1000) return false
  running = true
  try {
    await runDriveBackup(db, dataDir, d, now)
    return true
  } catch {
    return false // the reason is saved in settings and shown on the Backup screen
  } finally {
    running = false
  }
}

export async function listDriveBackups(d: CloudDeps): Promise<RemoteFile[]> {
  try {
    return await d.drive.list()
  } catch (e) {
    return asAppError(e)
  }
}

/** Downloads one backup and unlocks it into a new temporary folder. The caller restores it and then deletes `tmp`. */
export async function fetchDriveBackup(d: CloudDeps, id: string, password?: string): Promise<{ path: string; tmp: string }> {
  const pw = password ?? d.secrets.read()?.password
  if (!pw) throw new AppError('PASSWORD', 'Type the backup password.')
  const tmp = mkdtempSync(join(tmpdir(), 'kds-restore-'))
  try {
    unlockBackup(await d.drive.download(id), pw, tmp)
    const dir = join(tmp)
    const v = validateBackup(dir)
    if (!v.ok) throw new AppError('INVALID', v.error ?? 'The backup is not valid.')
    return { path: dir, tmp }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true })
    return asAppError(e)
  }
}
