import { useEffect, useState } from 'react'
import { api, fmtDateTime, useApp, useAsync } from '../ui'

export function ImportScreen() {
  const { t, guard, toast } = useApp()
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ done: number; total: number; file: string } | null>(null)
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.importer.run>> | null>(null)
  const [filter, setFilter] = useState<string>('unparsed')
  const log = useAsync(() => api.importer.log(filter === 'all' ? undefined : filter), [filter, summary])

  useEffect(() => window.kds.on('import:progress', (p) => setProg(p as never)), [])

  async function choose() {
    const f = await api.importer.chooseFolder()
    if (f) setFolder(f)
  }
  async function run() {
    setBusy(true)
    setSummary(null)
    const s = await guard(api.importer.run(folder))
    setBusy(false)
    setProg(null)
    if (s) { setSummary(s); toast(`${s.imported} ${t('reports imported')}`, 'ok') }
  }

  return (
    <div className="page" data-testid="import">
      <h1>{t('Import old Word reports')}</h1>
      <div className="card col">
        <div className="muted">{t('Choose the folder that has the old Word (.doc, .docx) and PDF reports. The files are only read, never changed. Patients and results come in as read-only history. Anything that cannot be understood is listed below, never skipped silently.')}</div>
        <div className="row wrap">
          <button className="btn ghost" onClick={choose} data-testid="import-choose">📁 {t('Choose folder…')}</button>
          <input className="input grow mono" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\…\DATE WISE PATHOLOGY" data-testid="import-folder" />
          <button className="btn big" disabled={!folder || busy} onClick={run} data-testid="import-run">{busy ? t('Importing…') : t('Start import')}</button>
        </div>
        {busy && prog && (
          <div className="col" style={{ gap: 6 }}>
            <div className="progress"><div style={{ width: `${prog.total ? (100 * prog.done) / prog.total : 0}%` }} /></div>
            <div className="muted">{prog.done} / {prog.total} · {prog.file}</div>
          </div>
        )}
      </div>

      {summary && (
        <div className="statgrid" data-testid="import-summary">
          <div className="stat"><div className="n">{summary.total}</div><div className="muted">{t('Files found')}</div></div>
          <div className="stat"><div className="n" style={{ color: 'var(--ok)' }}>{summary.imported}</div><div className="muted">{t('Imported')}</div></div>
          <div className="stat"><div className="n">{summary.sentOut}</div><div className="muted">{t('Sent-out (Thyrocare) logged')}</div></div>
          <div className="stat"><div className="n" style={{ color: summary.unparsed ? 'var(--eosin)' : undefined }}>{summary.unparsed}</div><div className="muted">{t('Could not be read')}</div></div>
        </div>
      )}
      {summary && summary.alreadyImported > 0 && <div className="alert info"><span>{summary.alreadyImported} {t('files were already imported earlier and were left as they are.')}</span></div>}

      <div className="card col">
        <div className="row">
          <h2 className="grow">{t('Import log')}</h2>
          <select className="input" style={{ maxWidth: 260 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="unparsed">{t('Could not be read')}</option>
            <option value="sentout">{t('Sent-out')}</option>
            <option value="imported">{t('Imported')}</option>
            <option value="all">{t('All')}</option>
          </select>
        </div>
        <table className="t">
          <thead><tr><th>{t('File')}</th><th>{t('Result')}</th><th>{t('Why')}</th><th>{t('When')}</th></tr></thead>
          <tbody>
            {(log.data as { id: number; file: string; status: string; reason: string; run_at: string }[] | undefined)?.map((r) => (
              <tr key={r.id}>
                <td style={{ wordBreak: 'break-all' }}>{r.file}</td>
                <td><span className={`tag ${r.status === 'imported' ? 'ok' : r.status === 'unparsed' ? 'bad' : 'grey'}`}>{r.status}</span></td>
                <td>{r.reason}</td><td>{fmtDateTime(r.run_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.data?.length === 0 && <div className="muted">{t('Nothing here.')}</div>}
      </div>
    </div>
  )
}
