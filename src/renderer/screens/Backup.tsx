import { useState } from 'react'
import { api, fmtDateTime, useApp, useAsync } from '../ui'
import { DriveBackupCard } from './DriveBackup'

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

export function BackupScreen() {
  const { t, guard, toast, settings, reloadSettings, askPin } = useApp()
  const list = useAsync(() => api.backup.list(), [])
  const drives = useAsync(() => api.backup.drives(), [])
  const [busy, setBusy] = useState(false)
  const [wizard, setWizard] = useState<null | { path: string; info: { createdAt: string; patients: number; visits: number; reports: number } }>(null)

  async function toPen(dest: string) {
    setBusy(true)
    const p = await guard(api.backup.toFolder(dest))
    setBusy(false)
    if (p) { toast(`${t('Backup saved to')} ${p}. ${t('You can remove the pen drive.')}`, 'ok'); await reloadSettings(); list.reload() }
  }
  async function toFolder() {
    const f = await api.backup.chooseFolder()
    if (f) await toPen(f)
  }
  async function now() {
    setBusy(true)
    const p = await guard(api.backup.run())
    setBusy(false)
    if (p) { toast(t('Backup made on this PC.'), 'ok'); list.reload() }
  }
  async function pick(path?: string) {
    const v = path ? await api.backup.validate(path) : await api.backup.chooseBackup()
    if (!v) return
    if (!v.ok || !v.info) return toast(v.error ?? t('Not a valid backup'), 'bad')
    setWizard({ path: path ?? v.info.path, info: v.info })
  }
  async function restore() {
    if (!wizard) return
    const s = await api.settings.pinStatus()
    const pin = s.ownerSet ? await askPin(t('PIN to restore a backup')) : ''
    if (pin === null) return
    const r = await guard(api.backup.restore(wizard.path, pin || undefined))
    if (r) toast(t('Restoring… the program will restart.'), 'ok')
  }

  const all = [...(list.data?.nightly ?? []), ...(list.data?.manual ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="page" data-testid="backup">
      <h1>{t('Backup')}</h1>

      <div className="card col">
        <h2>💾 {t('Backup to pen drive')}</h2>
        <div className="muted">
          {t('Last pen-drive backup')}: <b>{settings.lastPenDriveBackup ? fmtDateTime(settings.lastPenDriveBackup) : t('never')}</b> · {t('Last automatic night backup')}: <b>{settings.lastNightlyBackup ? fmtDateTime(settings.lastNightlyBackup) : t('not yet')}</b>
        </div>
        <div className="row wrap">
          {drives.data?.map((d) => (
            <button key={d.letter} className="btn big" disabled={busy} onClick={() => toPen(d.letter)} data-testid="drive-btn">💾 {t('Backup to')} {d.letter} {d.label}</button>
          ))}
          <button className={`btn ${drives.data?.length ? 'ghost' : 'big'}`} disabled={busy} onClick={toFolder} data-testid="folder-btn">📁 {t('Choose a folder / pen drive…')}</button>
          <button className="btn ghost" onClick={() => drives.reload()}>↻ {t('Look for pen drive again')}</button>
        </div>
        {drives.data?.length === 0 && <div className="muted">{t('No pen drive found. Plug it in and press “Look again”, or choose a folder.')}</div>}
        <div className="muted" style={{ fontSize: 14 }}>{t('Every night the program also makes a copy on this PC and keeps the last 30.')}</div>
      </div>

      <DriveBackupCard />

      <div className="card col">
        <div className="row">
          <h2 className="grow">{t('Copies on this PC')}</h2>
          <button className="btn ghost" disabled={busy} onClick={now} data-testid="backup-now">{t('Make a copy now')}</button>
        </div>
        <table className="t">
          <thead><tr><th>{t('Made on')}</th><th className="num">{t('Patients')}</th><th className="num">{t('Visits')}</th><th className="num">{t('Reports')}</th><th className="num">{t('Size')}</th><th /></tr></thead>
          <tbody>
            {all.map((b) => (
              <tr key={b.path}>
                <td>{fmtDateTime(b.createdAt)} <span className="tag grey">{b.name.startsWith('KDS-nightly') ? t('night') : t('manual')}</span></td>
                <td className="num">{b.patients}</td><td className="num">{b.visits}</td><td className="num">{b.reports}</td><td className="num">{mb(b.sizeBytes)}</td>
                <td className="right"><button className="btn small ghost" onClick={() => pick(b.path)}>{t('Restore…')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.length === 0 && <div className="muted">{t('No copies yet.')}</div>}
        <div className="muted" style={{ fontSize: 14 }}>{list.data?.nightlyDir}</div>
      </div>

      <div className="card col">
        <h2>♻ {t('Restore from a backup')}</h2>
        <div className="muted">{t('Use this on a new PC or after a problem. Choose the backup folder (its name starts with KDS-backup).')}</div>
        <div><button className="btn ghost" onClick={() => pick()} data-testid="restore-pick">{t('Choose backup folder…')}</button></div>
      </div>

      {wizard && (
        <div className="overlay">
          <div className="modal">
            <h2>{t('Restore this backup?')}</h2>
            <div className="alert info"><span>
              {t('Backup made on')} <b>{fmtDateTime(wizard.info.createdAt)}</b><br />
              {wizard.info.patients} {t('patients')}, {wizard.info.visits} {t('visits')}, {wizard.info.reports} {t('reports')}
            </span></div>
            <div className="alert warn"><b>⚠</b><span>{t('Everything typed after this backup will be replaced. Your current data is not deleted: it is kept in a “before-restore” folder next to the database. The program will restart.')}</span></div>
            <div className="row">
              <button className="btn ghost" onClick={() => setWizard(null)}>{t('Cancel')}</button>
              <div className="grow" />
              <button className="btn danger" onClick={restore} data-testid="restore-go">{t('Restore now')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
