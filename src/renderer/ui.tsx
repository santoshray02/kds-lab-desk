import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { api, ApiError } from './api'
import type { Settings } from '../shared/settings'
import { HI } from './i18n'

export type Route =
  | { name: 'today' }
  | { name: 'new'; personId?: number }
  | { name: 'visit'; visitId: number }
  | { name: 'patients'; patientId?: number }
  | { name: 'owner' }
  | { name: 'backup' }
  | { name: 'import' }
  | { name: 'settings' }

interface AppCtx {
  settings: Settings
  reloadSettings(): Promise<void>
  t(s: string): string
  go(r: Route): void
  route: Route
  toast(msg: string, kind?: 'ok' | 'bad' | ''): void
  askPin(title?: string): Promise<string | null>
  confirm(opts: { title: string; body?: ReactNode; ok?: string; danger?: boolean }): Promise<boolean>
  prompt(opts: { title: string; label: string; ok?: string; minLength?: number }): Promise<string | null>
  /** shows API errors as a red toast and returns undefined */
  guard<T>(p: Promise<T>): Promise<T | undefined>
  pendingCount: number
  refreshCounts(): void
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)

export function makeT(lang: 'en' | 'hi') {
  return (s: string) => (lang === 'hi' ? HI[s] ?? s : s)
}

/* ---------- modal helpers ---------- */

export function Modal({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

export function PinModal({ title, onDone, t }: { title: string; onDone: (pin: string | null) => void; t: (s: string) => string }) {
  const [pin, setPin] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <Modal onClose={() => onDone(null)}>
      <h2>{title}</h2>
      <label className="f">
        {t('4-digit PIN')}
        <input
          ref={ref}
          className="input num"
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && pin.length === 4 && onDone(pin)}
          data-testid="pin-input"
        />
      </label>
      <div className="row">
        <button className="btn ghost" onClick={() => onDone(null)}>{t('Cancel')}</button>
        <div className="grow" />
        <button className="btn" disabled={pin.length !== 4} onClick={() => onDone(pin)} data-testid="pin-ok">{t('OK')}</button>
      </div>
    </Modal>
  )
}

export function PromptModal({ title, label, ok, minLength = 3, onDone, t }: { title: string; label: string; ok?: string; minLength?: number; onDone: (v: string | null) => void; t: (s: string) => string }) {
  const [v, setV] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <Modal onClose={() => onDone(null)}>
      <h2>{title}</h2>
      <label className="f">
        {label}
        <input ref={ref} className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim().length >= minLength && onDone(v.trim())} data-testid="prompt-input" />
      </label>
      <div className="row">
        <button className="btn ghost" onClick={() => onDone(null)}>{t('Cancel')}</button>
        <div className="grow" />
        <button className="btn" disabled={v.trim().length < minLength} onClick={() => onDone(v.trim())} data-testid="prompt-ok">{ok ?? t('OK')}</button>
      </div>
    </Modal>
  )
}

export function ConfirmModal({ title, body, ok, danger, onDone, t }: { title: string; body?: ReactNode; ok?: string; danger?: boolean; onDone: (v: boolean) => void; t: (s: string) => string }) {
  return (
    <Modal onClose={() => onDone(false)}>
      <h2>{title}</h2>
      {body && <div>{body}</div>}
      <div className="row">
        <button className="btn ghost" onClick={() => onDone(false)}>{t('Cancel')}</button>
        <div className="grow" />
        <button className={`btn${danger ? ' danger' : ''}`} onClick={() => onDone(true)} data-testid="confirm-ok" autoFocus>{ok ?? t('OK')}</button>
      </div>
    </Modal>
  )
}

/* ---------- keyboard flow: Enter moves to the next field ---------- */

export function enterNext(e: KeyboardEvent<HTMLElement>, onLast?: () => void) {
  if (e.key !== 'Enter') return
  const el = e.target as HTMLElement
  if (el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') return
  e.preventDefault()
  const root = e.currentTarget
  const fields = Array.from(root.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])')).filter((f) => f.offsetParent !== null)
  const i = fields.indexOf(el)
  if (i >= 0 && i < fields.length - 1) {
    fields[i + 1].focus()
    if (fields[i + 1] instanceof HTMLInputElement) (fields[i + 1] as HTMLInputElement).select?.()
  } else if (i === fields.length - 1) onLast?.()
}

/* ---------- small pieces ---------- */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
      {hint && <span style={{ fontWeight: 400 }}>{hint}</span>}
    </label>
  )
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export const money = (n: number) => `₹ ${Math.round(n).toLocaleString('en-IN')}`
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; reload: () => void; loading: boolean; error: string } {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    fn()
      .then((d) => live && (setData(d), setError('')))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return { data, reload, loading, error }
}

export { api, ApiError }
export type { Entry, VisitItem, Person } from './api'
