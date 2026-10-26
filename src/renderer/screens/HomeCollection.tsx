import { api, fmtDate, money, useApp, useAsync } from '../ui'

/** Samples still to be collected at patients' homes. Shows nothing when there are none or the feature is off. */
export function HomeJobs() {
  const { t, go, guard, toast, settings } = useApp()
  const jobs = useAsync(() => (settings.home.enabled ? api.home.pending() : Promise.resolve([])), [settings.home.enabled])
  if (!jobs.data?.length) return null
  return (
    <div className="card" data-testid="home-jobs">
      <div className="row wrap">
        <h2 className="grow">🏠 {t('Home collections to do')} ({jobs.data.length})</h2>
        <button className="btn ghost noprint" onClick={() => guard(api.home.printList())} data-testid="home-print">🖨 {t('Print the list for the collector')}</button>
      </div>
      <table className="t">
        <thead><tr><th>{t('Date')}</th><th>{t('Patient')}</th><th>{t('Address')}</th><th>{t('Time')}</th><th>{t('Tests')}</th><th className="num">{t('To collect')}</th><th /></tr></thead>
        <tbody>
          {jobs.data.map((j) => (
            <tr key={j.visitId} data-testid="home-job">
              <td>{fmtDate(j.date)}</td>
              <td><b>{j.patient}</b><div className="muted mono" style={{ fontSize: 14 }}>{j.phone}</div>{j.collector && <div className="muted" style={{ fontSize: 14 }}>{t('Collector')}: {j.collector}</div>}</td>
              <td style={{ maxWidth: 260 }}>{j.address}</td>
              <td>{j.time || '—'}</td>
              <td style={{ maxWidth: 240 }}>{j.tests}</td>
              <td className="num">{j.due > 0 ? money(j.due) : ''}</td>
              <td className="right" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn small" onClick={async () => { if (await guard(api.home.markCollected(j.visitId, true))) { toast(t('Marked as collected'), 'ok'); jobs.reload() } }} data-testid="home-collected">✔ {t('Collected')}</button>{' '}
                <button className="btn small ghost" onClick={() => go({ name: 'visit', visitId: j.visitId })}>{t('Open')}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
