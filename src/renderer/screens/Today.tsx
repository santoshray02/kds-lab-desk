import { formatAgeShort } from '../../shared/age'
import { api, fmtDate, money, todayStr, useApp, useAsync, type VisitItem } from '../ui'

export function statusTag(v: Pick<VisitItem, 'reportStatus'>, t: (s: string) => string) {
  switch (v.reportStatus) {
    case 'approved': return <span className="tag ok">{t('Approved')}</span>
    case 'draft': return <span className="tag pending">{t('Results pending')}</span>
    case 'imported': return <span className="tag grey">{t('Imported')}</span>
    default: return <span className="tag grey">{t('Sent out')}</span>
  }
}

export function Today() {
  const { t, go, settings, reloadSettings, toast } = useApp()
  const day = useAsync(() => api.owner.day(todayStr()), [])
  const pending = useAsync(() => api.owner.pending(), [])
  const list = useAsync(() => api.visits.list({ from: todayStr(), to: todayStr() }), [])
  const open = pending.data?.unreported.filter((p) => p.date !== todayStr()) ?? []

  const daysSincePen = settings.lastPenDriveBackup ? Math.floor((Date.now() - new Date(settings.lastPenDriveBackup).getTime()) / 86400000) : null
  const penDue = daysSincePen === null || daysSincePen >= settings.penDriveReminderDays

  return (
    <div className="page" data-testid="today">
      <div className="row">
        <h1 className="grow">{t('Today')} <span className="muted" style={{ fontSize: 18 }}>{fmtDate(todayStr())}</span></h1>
        <button className="btn big" onClick={() => go({ name: 'new' })} data-testid="new-btn">➕ {t('New patient')}</button>
      </div>

      {!settings.masterReviewed && (
        <div className="banner" data-testid="review-banner">
          <b>⚠ {t('Defaults — to be reviewed by Dr. Manoj Kumar')}</b>
          <span>{t('The test list, units and normal ranges are starting values. Doctor: please check them in Settings → Test master and tick “Reviewed”.')}</span>
          <button className="btn small" onClick={() => go({ name: 'settings' })}>{t('Open test master')}</button>
        </div>
      )}
      {penDue && (
        <div className="banner hema" data-testid="pen-banner">
          <b>💾 {t('Weekly pen-drive backup')}</b>
          <span>{daysSincePen === null ? t('No pen-drive backup has been made yet.') : `${t('Last pen-drive backup')}: ${daysSincePen} ${t('days ago')}.`}</span>
          <button className="btn small" onClick={() => go({ name: 'backup' })}>{t('Back up now')}</button>
        </div>
      )}
      {settings.demoMode && (
        <div className="banner">
          <b>{t('Demo mode')}</b><span>{t('The patients shown are invented. Remove them in Settings → Data before real use.')}</span>
          <button className="btn small ghost" onClick={async () => { await api.settings.set({ demoMode: false }); await reloadSettings(); toast(t('Banner hidden')) }}>{t('Hide')}</button>
        </div>
      )}

      <div className="statgrid">
        <div className="stat"><div className="n">{day.data?.visits.length ?? '–'}</div><div className="muted">{t('Patients today')}</div></div>
        <div className="stat"><div className="n">{pending.data?.unreported.length ?? '–'}</div><div className="muted">{t('Reports pending')}</div></div>
        <div className="stat"><div className="n">{day.data ? money(day.data.cashReceived) : '–'}</div><div className="muted">{t('Cash received today')}</div></div>
        <div className="stat"><div className="n">{pending.data?.sentOut.length ?? '–'}</div><div className="muted">{t('Sent-out awaited')}</div></div>
      </div>

      <div className="card">
        <h2>{t('Today’s patients')}</h2>
        {list.data && list.data.length === 0 && <div className="muted">{t('No patients registered today yet. Press “New patient”.')}</div>}
        {list.data && list.data.length > 0 && <VisitTable rows={list.data} />}
      </div>

      {open.length > 0 && (
        <div className="card" data-testid="older-pending">
          <h2>{t('Older reports still pending')}</h2>
          <table className="t">
            <thead><tr><th>{t('Sample ID')}</th><th>{t('Date')}</th><th>{t('Patient')}</th><th>{t('Tests')}</th></tr></thead>
            <tbody>
              {open.map((p) => (
                <tr key={p.visitId} className="click" onClick={() => go({ name: 'visit', visitId: p.visitId })}>
                  <td className="mono">{p.sampleId}</td><td>{fmtDate(p.date)}</td><td>{p.name}</td><td>{p.tests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function VisitTable({ rows, showDate }: { rows: VisitItem[]; showDate?: boolean }) {
  const { t, go } = useApp()
  return (
    <table className="t" data-testid="visit-table">
      <thead>
        <tr><th>{t('Sample ID')}</th>{showDate && <th>{t('Date')}</th>}<th>{t('Patient')}</th><th>{t('Age')}</th><th>{t('Ref. by')}</th><th>{t('Tests')}</th><th>{t('Status')}</th><th className="num">{t('Due')}</th></tr>
      </thead>
      <tbody>
        {rows.map((v) => (
          <tr key={v.id} className="click" onClick={() => go({ name: 'visit', visitId: v.id })} data-testid="visit-row">
            <td className="mono">{v.sampleId}</td>
            {showDate && <td>{fmtDate(v.date)}</td>}
            <td><b>{v.title ? v.title + '. ' : ''}{v.patientName}</b><div className="muted" style={{ fontSize: 14 }}>{v.phone}</div></td>
            <td>{formatAgeShort(v.age)} / {v.sex}</td>
            <td>{v.doctor}</td>
            <td style={{ maxWidth: 320 }}>{v.tests}</td>
            <td>{statusTag(v, t)}{v.pendingSentOut > 0 && <span className="tag pending" style={{ marginLeft: 4 }}>{t('Sent-out awaited')}</span>}</td>
            <td className="num" style={{ color: v.due > 0 ? 'var(--eosin)' : undefined }}>{v.due > 0 ? money(v.due) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
