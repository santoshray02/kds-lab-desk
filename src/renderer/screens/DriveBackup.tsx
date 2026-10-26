import { useState } from 'react'
import { api, fmtDateTime, useApp, useAsync } from '../ui'

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

/** Nightly password-locked backup to the owner's own Google Drive (hidden app folder; nothing is kept on this PC). */
export function DriveBackupCard() {
  const { t, guard, toast, reloadSettings, askPin } = useApp()
  const st = useAsync(() => api.drive.status(), [])
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState<'' | 'connect' | 'backup'>('')
  const [restoring, setRestoring] = useState(false)
  const s = st.data

  async function pinFor(title: string): Promise<string | null | undefined> {
    const ps = await api.settings.pinStatus()
    if (!ps.ownerSet) return undefined
    return askPin(title)
  }

  async function connect() {
    const pin = await pinFor(t('PIN to connect Google Drive'))
    if (pin === null) return
    setBusy('connect')
    const r = await guard(api.drive.connect(pw, pin))
    setBusy('')
    if (r) { setPw(''); setPw2(''); toast(t('Google Drive is connected.'), 'ok'); await reloadSettings(); st.reload() }
  }
  async function backupNow() {
    setBusy('backup')
    const r = await guard(api.drive.backupNow())
    setBusy('')
    st.reload()
    await reloadSettings()
    if (r) toast(t('Backup saved on Google Drive.'), 'ok')
  }
  async function disconnect() {
    const pin = await pinFor(t('PIN to disconnect Google Drive'))
    if (pin === null) return
    const r = await guard(api.drive.disconnect(pin))
    if (r) { toast(t('Google Drive is disconnected. Old backups stay in the Drive.'), 'ok'); await reloadSettings(); st.reload() }
  }

  const stale = s?.connected && s.lastBackup && Date.now() - new Date(s.lastBackup).getTime() > 2 * 86_400_000
  const pwOk = pw.length >= 6 && pw === pw2

  return (
    <div className="card col" data-testid="drive-card">
      <h2>☁ {t('Backup to Google Drive')}</h2>
      {!s ? null : !s.available ? (
        <div className="muted">{t('Google Drive backup is not set up in this version of the program yet.')}</div>
      ) : !s.connected ? (
        <>
          <div className="muted">{t('Every night the program saves a copy, locked with your password, in your own Google Drive. It uses almost no space on this PC and nobody else can read it, not even Google.')}</div>
          <div className="alert warn"><b>⚠</b><span>{t('Use the lab’s own Google account, not a personal one, if other people use this PC. Write the backup password on paper and keep it safe: if it is lost, the backups cannot be opened by anyone.')}</span></div>
          <div className="grid2">
            <label className="f">{t('Backup password (at least 6 characters)')}<input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="drive-pw" /></label>
            <label className="f">{t('Type the password again')}<input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="drive-pw2" /></label>
          </div>
          {pw2 !== '' && pw !== pw2 && <div className="muted">{t('The two passwords are not the same.')}</div>}
          <div className="row">
            <button className="btn big" disabled={!pwOk || busy !== ''} onClick={connect} data-testid="drive-connect">{busy === 'connect' ? t('Waiting for Google… finish in the browser') : t('Connect Google Drive')}</button>
            <button className="btn ghost" onClick={() => setRestoring(true)} data-testid="drive-restore-open">{t('Restore from Google Drive…')}</button>
          </div>
          <div className="muted" style={{ fontSize: 14 }}>{t('On a new PC: connect with the same Google account and the same password, then restore.')}</div>
        </>
      ) : (
        <>
          <div className="muted">
            {t('Connected as')} <b>{s.account || t('your Google account')}</b> · {t('Last copy on Google Drive')}: <b>{s.lastBackup ? fmtDateTime(s.lastBackup) : t('not yet')}</b>
          </div>
          {s.lastError && <div className="alert bad" data-testid="drive-error"><b>⚠</b><span>{t('The last try did not work')}: {s.lastError}</span></div>}
          {stale && !s.lastError && <div className="alert warn"><b>⚠</b><span>{t('There has been no copy on Google Drive for 2 days. Keep the PC on and connected to the internet at night.')}</span></div>}
          <div className="row wrap">
            <button className="btn" disabled={busy !== ''} onClick={backupNow} data-testid="drive-now">{busy === 'backup' ? t('Saving…') : t('Back up to Google Drive now')}</button>
            <button className="btn ghost" onClick={() => setRestoring(true)} data-testid="drive-restore-open">{t('Restore from Google Drive…')}</button>
            <button className="btn ghost" onClick={disconnect} data-testid="drive-disconnect">{t('Disconnect')}</button>
          </div>
          <div className="muted" style={{ fontSize: 14 }}>{t('The newest 30 copies are kept in Google Drive. Only this program can see them; they do not show in your Drive files.')}</div>
        </>
      )}
      {restoring && <DriveRestore connected={!!s?.connected} onClose={() => setRestoring(false)} />}
    </div>
  )
}

function DriveRestore({ connected, onClose }: { connected: boolean; onClose: () => void }) {
  const { t, guard, toast, askPin } = useApp()
  const list = useAsync(() => (connected ? api.drive.list() : Promise.resolve([])), [])
  const [pick, setPick] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  async function go() {
    const ps = await api.settings.pinStatus()
    const pin = ps.ownerSet ? await askPin(t('PIN to restore a backup')) : ''
    if (pin === null) return
    setBusy(true)
    const r = await guard(api.drive.restore(pick, pw || undefined, pin || undefined))
    setBusy(false)
    if (r) toast(t('Restoring… the program will restart.'), 'ok')
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t('Restore from Google Drive')}</h2>
        {!connected && <div className="alert info"><span>{t('Connect Google Drive first (same account and password as before), then come back here.')}</span></div>}
        {connected && list.loading && <div className="muted">{t('Looking in Google Drive…')}</div>}
        {connected && list.data?.length === 0 && <div className="muted">{t('No copies found in Google Drive.')}</div>}
        {!!list.data?.length && (
          <div className="col" style={{ maxHeight: 260, overflow: 'auto', gap: 6 }}>
            {list.data.map((f) => (
              <label key={f.id} className="checkrow">
                <input type="radio" name="drivebk" checked={pick === f.id} onChange={() => setPick(f.id)} data-testid="drive-pick" /> {fmtDateTime(f.createdAt)} · {mb(f.sizeBytes)}
              </label>
            ))}
          </div>
        )}
        {!!list.data?.length && (
          <>
            <label className="f">{t('Backup password (leave empty to use the saved one)')}<input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <div className="alert warn"><b>⚠</b><span>{t('Everything typed after this backup will be replaced. Your current data is not deleted: it is kept in a “before-restore” folder next to the database. The program will restart.')}</span></div>
          </>
        )}
        <div className="row">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <div className="grow" />
          <button className="btn danger" disabled={!pick || busy} onClick={go} data-testid="drive-restore-go">{busy ? t('Restoring…') : t('Restore now')}</button>
        </div>
      </div>
    </div>
  )
}
