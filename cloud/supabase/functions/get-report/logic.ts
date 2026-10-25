import { hashPin } from './hash.ts'

/** Pure decision logic of the report page, kept free of Deno/Supabase APIs so it can be unit tested. */

export interface ReportRecord {
  share_code: string
  version: number
  status: string
  is_current: boolean
  approved_at: string | null
  pin_salt: string | null
  pin_hash: string | null
  pdf_path: string | null
  visit_id: number
}

export const MAX_FAILS = 5
export const WINDOW_MINUTES = 15

export type Decision =
  | { kind: 'not_found' }
  | { kind: 'locked'; retryAfterMinutes: number }
  | { kind: 'bad_pin'; attemptsLeft: number }
  | { kind: 'ok'; path: string }

/** `recentFails` = failed attempts for this code within WINDOW_MINUTES. */
export async function decide(rec: ReportRecord | null, pin: string, recentFails: number): Promise<Decision> {
  if (!rec || !rec.pdf_path) return { kind: 'not_found' }
  if (recentFails >= MAX_FAILS) return { kind: 'locked', retryAfterMinutes: WINDOW_MINUTES }
  if (!/^\d{4}$/.test(pin) || !rec.pin_hash || !rec.pin_salt) return { kind: 'bad_pin', attemptsLeft: Math.max(0, MAX_FAILS - recentFails - 1) }
  const h = await hashPin(rec.share_code, pin, rec.pin_salt)
  if (h !== rec.pin_hash) return { kind: 'bad_pin', attemptsLeft: Math.max(0, MAX_FAILS - recentFails - 1) }
  return { kind: 'ok', path: rec.pdf_path }
}

/** What anybody holding the link (or scanning the QR) may learn without the PIN. */
export function publicStatus(rec: ReportRecord | null, newerExists: boolean) {
  if (!rec) return { found: false }
  if (rec.status === 'withdrawn') return { found: true, state: 'withdrawn by the lab', version: rec.version, issuedOn: rec.approved_at ? rec.approved_at.slice(0, 10) : null }
  const state = rec.status !== 'approved' ? 'not issued' : rec.is_current && !newerExists ? 'valid' : 'replaced by a corrected version'
  return { found: true, state, version: rec.version, issuedOn: rec.approved_at ? rec.approved_at.slice(0, 10) : null }
}
