import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings'
import { api, ApiError, ConfirmModal, Ctx, PinModal, PromptModal, makeT, useApp, type Route } from './ui'
import { Today } from './screens/Today'
import { NewPatient } from './screens/NewPatient'
import { VisitScreen } from './screens/Visit'
import { Patients } from './screens/Patients'
import { Owner } from './screens/Owner'
import { BackupScreen } from './screens/Backup'
import { ImportScreen } from './screens/Import'
import { SettingsScreen } from './screens/Settings'

interface Toast { id: number; msg: string; kind: string }

type Dialog =
  | { kind: 'pin'; title: string; done: (v: string | null) => void }
  | { kind: 'confirm'; opts: { title: string; body?: ReactNode; ok?: string; danger?: boolean }; done: (v: boolean) => void }
  | { kind: 'prompt'; opts: { title: string; label: string; ok?: string; minLength?: number }; done: (v: string | null) => void }

const NAV: { name: Route['name']; icon: string; label: string }[] = [
  { name: 'today', icon: '🏠', label: 'Today' },
  { name: 'new', icon: '➕', label: 'New patient' },
  { name: 'patients', icon: '🔍', label: 'Patients & search' },
  { name: 'owner', icon: '📊', label: 'Reports' },
  { name: 'backup', icon: '💾', label: 'Backup' },
  { name: 'import', icon: '📥', label: 'Import old reports' },
  { name: 'settings', icon: '⚙️', label: 'Settings' }
]

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)
  const [route, setRoute] = useState<Route>({ name: 'today' })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [pending, setPending] = useState(0)
  const [syncState, setSyncState] = useState<{ enabled: boolean; pending?: number; lastOk?: string; lastError?: string } | null>(null)
  const toastId = useRef(0)

  const reloadSettings = useCallback(async () => {
    setSettings(await api.settings.get())
  }, [])
  const refreshCounts = useCallback(() => {
    api.owner.pending().then((p) => setPending(p.unreported.length)).catch(() => undefined)
    api.sync.status().then((s) => setSyncState(s as never)).catch(() => undefined)
  }, [])

  useEffect(() => {
    reloadSettings().then(() => setReady(true))
    refreshCounts()
    const id = setInterval(refreshCounts, 30_000)
    return () => clearInterval(id)
  }, [reloadSettings, refreshCounts])

  const t = useMemo(() => makeT(settings.language), [settings.language])

  const toast = useCallback((msg: string, kind: 'ok' | 'bad' | '' = '') => {
    const id = ++toastId.current
    setToasts((x) => [...x, { id, msg, kind }])
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), kind === 'bad' ? 8000 : 6000)
  }, [])

  const ctx = useMemo(
    () => ({
      settings, reloadSettings, t, route, toast, pendingCount: pending, refreshCounts,
      go: (r: Route) => { setRoute(r); refreshCounts() },
      askPin: (title?: string) => new Promise<string | null>((done) => setDialog({ kind: 'pin', title: title ?? t('Enter PIN'), done: (v) => { setDialog(null); done(v) } })),
      confirm: (opts: { title: string; body?: ReactNode; ok?: string; danger?: boolean }) => new Promise<boolean>((done) => setDialog({ kind: 'confirm', opts, done: (v) => { setDialog(null); done(v) } })),
      prompt: (opts: { title: string; label: string; ok?: string; minLength?: number }) => new Promise<string | null>((done) => setDialog({ kind: 'prompt', opts, done: (v) => { setDialog(null); done(v) } })),
      guard: async <T,>(p: Promise<T>) => {
        try {
          return await p
        } catch (e) {
          toast(e instanceof ApiError ? e.message : String(e), 'bad')
          return undefined
        }
      }
    }),
    [settings, reloadSettings, t, route, toast, pending, refreshCounts]
  )

  if (!ready) return <div style={{ padding: 40 }}>Loading…</div>

  const cur = route.name === 'visit' ? 'today' : route.name

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <header className="topbar">
          <span className="brand">KDS Lab Desk</span>
          <span className="sub">K.D.S. Pathology · Dalsingsarai</span>
          <span className="spacer" />
          {settings.demoMode && <span className="pill warn" data-testid="demo-pill">{t('DEMO DATA')}</span>}
          {syncState?.enabled ? (
            <span className={`pill dotg${syncState.lastError ? ' off' : ''}`}>{syncState.lastError ? t('Sync waiting') : syncState.pending ? `${t('Syncing')} (${syncState.pending})` : t('Synced')}</span>
          ) : (
            <span className="pill dotg">{t('Saved on this PC')}</span>
          )}
          <button className="lang" onClick={async () => { await api.settings.set({ language: settings.language === 'en' ? 'hi' : 'en' }); reloadSettings() }} data-testid="lang">
            {settings.language === 'en' ? 'हिन्दी' : 'English'}
          </button>
        </header>
        <nav className="side">
          {NAV.map((n) => (
            <button key={n.name} className={`nav${cur === n.name ? ' on' : ''}`} onClick={() => ctx.go({ name: n.name } as Route)} data-testid={`nav-${n.name}`}>
              <span className="ico">{n.icon}</span>
              {t(n.label)}
              {n.name === 'today' && pending > 0 && <span className="badge">{pending}</span>}
            </button>
          ))}
        </nav>
        <main className="main">
          <Screen route={route} />
        </main>
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`} role="status">{x.msg}</div>
        ))}
      </div>
      {dialog?.kind === 'pin' && <PinModal title={dialog.title} onDone={dialog.done} t={t} />}
      {dialog?.kind === 'confirm' && <ConfirmModal {...dialog.opts} onDone={dialog.done} t={t} />}
      {dialog?.kind === 'prompt' && <PromptModal {...dialog.opts} onDone={dialog.done} t={t} />}
    </Ctx.Provider>
  )
}

function Screen({ route }: { route: Route }) {
  const { t } = useApp()
  switch (route.name) {
    case 'today': return <Today />
    case 'new': return <NewPatient key={route.personId ?? 'x'} personId={route.personId} />
    case 'visit': return <VisitScreen key={route.visitId} visitId={route.visitId} />
    case 'patients': return <Patients patientId={route.patientId} />
    case 'owner': return <Owner />
    case 'backup': return <BackupScreen />
    case 'import': return <ImportScreen />
    case 'settings': return <SettingsScreen />
    default: return <div>{t('Not found')}</div>
  }
}
