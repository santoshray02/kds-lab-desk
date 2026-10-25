import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings'
import { audit, type Db } from './db'

function merge<T>(base: T, over: unknown): T {
  if (over && typeof over === 'object' && !Array.isArray(over) && base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      out[k] = k in out ? merge(out[k], v) : v
    }
    return out as T
  }
  return (over === undefined ? base : over) as T
}

export function getSettings(db: Db): Settings {
  let s: Settings = structuredClone(DEFAULT_SETTINGS)
  for (const r of db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'")) {
    try {
      (s as unknown as Record<string, unknown>)[r.key] = merge((s as unknown as Record<string, unknown>)[r.key], JSON.parse(r.value))
    } catch {
      /* ignore a corrupt value, keep the default */
    }
  }
  return s
}

export function setSettings(db: Db, patch: Partial<Settings>): Settings {
  db.tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      db.run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v))
    }
  })
  return getSettings(db)
}

/** Raw internal values (PIN hashes etc.) use keys starting with "_" and are never sent to the screen. */
function getRaw(db: Db, key: string): string | null {
  return db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? null
}
function setRaw(db: Db, key: string, value: string) {
  db.run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value)
}

function hashPin(pin: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`
}
function verifyHash(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const a = Buffer.from(hash, 'hex')
  const b = scryptSync(pin, salt, 32)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type PinRole = 'owner' | 'doctor'
const KEY: Record<PinRole, string> = { owner: '_pin_owner', doctor: '_pin_doctor' }

export function hasPin(db: Db, role: PinRole = 'owner'): boolean {
  return getRaw(db, KEY[role]) != null
}

export function setPin(db: Db, pin: string, role: PinRole = 'owner'): void {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits')
  setRaw(db, KEY[role], hashPin(pin))
  audit(db, 'pin.set', 'settings', null, role)
}

/** True when no PIN has been set yet (first run: Settings stay open until the owner sets one) or the PIN matches. */
export function checkPin(db: Db, pin: string | undefined, role: PinRole = 'owner'): boolean {
  const stored = getRaw(db, KEY[role])
  if (stored == null) return role === 'owner' // doctor PIN falls back to the owner PIN below
  return !!pin && verifyHash(pin, stored)
}

/** Approval check: with roles enabled the doctor PIN (or owner PIN as fallback) is needed. */
export function checkApprover(db: Db, pin: string | undefined): boolean {
  const s = getSettings(db)
  if (!s.rolesEnabled) return true
  if (hasPin(db, 'doctor')) return checkPin(db, pin, 'doctor')
  return checkPin(db, pin, 'owner')
}
