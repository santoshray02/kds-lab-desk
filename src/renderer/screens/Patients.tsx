import { useEffect, useState } from 'react'
import { DuplicatesTab, MergeButton } from './Duplicates'
import { EditPatientButton } from './EditPatient'
import { formatAge } from '../../shared/age'
import { api, fmtDate, money, useApp, useAsync } from '../ui'
import { VisitTable } from './Today'

export function Patients({ patientId }: { patientId?: number }) {
  const { t } = useApp()
  const [tab, setTab] = useState<'people' | 'visits' | 'dups'>('people')
  if (patientId) return <PatientPage id={patientId} />
  return (
    <div className="page" data-testid="patients">
      <h1>{t('Patients & search')}</h1>
      <div className="tabs">
        <button className={`tab${tab === 'people' ? ' on' : ''}`} onClick={() => setTab('people')}>{t('Find a person')}</button>
        <button className={`tab${tab === 'visits' ? ' on' : ''}`} onClick={() => setTab('visits')} data-testid="tab-visits">{t('All visits by date / doctor')}</button>
        <button className={`tab${tab === 'dups' ? ' on' : ''}`} onClick={() => setTab('dups')} data-testid="tab-dups">{t('Possible duplicates')}</button>
      </div>
      {tab === 'people' ? <People /> : tab === 'visits' ? <Visits /> : <DuplicatesTab />}
    </div>
  )
}

function People() {
  const { t, go } = useApp()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  useEffect(() => { const id = setTimeout(() => setDq(q), 250); return () => clearTimeout(id) }, [q])
  const res = useAsync(() => api.patients.search(dq), [dq])
  return (
    <div className="col">
      <input className="input" autoFocus placeholder={t('Name, village, phone number or sample ID')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="search" />
      <div className="card">
        {res.data?.length === 0 && <div className="muted">{t('Nobody found.')}</div>}
        <table className="t">
          <thead><tr><th>{t('Name')}</th><th>{t('Age')}</th><th>{t('Phone')}</th><th>{t('Village')}</th><th>{t('Last visit')}</th><th className="num">{t('Visits')}</th></tr></thead>
          <tbody>
            {res.data?.map((p) => (
              <tr key={p.id} className="click" onClick={() => go({ name: 'patients', patientId: p.id })} data-testid="person-row">
                <td><b>{p.title ? p.title + '. ' : ''}{p.name}</b> {p.source !== 'app' && <span className="tag grey">{p.source === 'imported' ? t('imported') : t('demo')}</span>}</td>
                <td>{p.ageNow ? `${formatAge(p.ageNow)} / ${p.sex}` : p.sex}</td>
                <td className="mono">{p.phone}</td>
                <td>{p.village}</td>
                <td>{fmtDate(p.lastVisitDate)}</td>
                <td className="num">{p.visitCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Visits() {
  const { t } = useApp()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [doctor, setDoctor] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'pending' | 'done' | 'dues'>('all')
  const [docs, setDocs] = useState<string[]>([])
  useEffect(() => { api.patients.doctors('').then(setDocs) }, [])
  const res = useAsync(() => api.visits.list({ from: from || undefined, to: to || undefined, doctor: doctor || undefined, q: q || undefined, status, limit: 500 }), [from, to, doctor, q, status])
  return (
    <div className="col">
      <div className="card">
        <div className="grid4">
          <label className="f">{t('From date')}<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="f">{t('To date')}<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="f">{t('Doctor')}
            <input className="input" list="docs2" value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder={t('All')} />
            <datalist id="docs2">{docs.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
          <label className="f">{t('Show')}
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">{t('All')}</option><option value="pending">{t('Results pending')}</option><option value="done">{t('Reported')}</option><option value="dues">{t('With dues')}</option>
            </select>
          </label>
        </div>
        <label className="f" style={{ marginTop: 12 }}>{t('Name, phone or sample ID')}<input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>{res.data?.length ?? 0} {t('visits')}</div>
        {res.data && <VisitTable rows={res.data} showDate />}
      </div>
    </div>
  )
}

function PatientPage({ id }: { id: number }) {
  const { t, go } = useApp()
  const p = useAsync(() => api.patients.get(id), [id])
  const visits = useAsync(() => api.visits.list({ patientId: id, limit: 500 }), [id])
  const total = visits.data?.reduce((a, v) => a + v.due, 0) ?? 0
  if (!p.data) return <div className="page">{t('Loading…')}</div>
  const x = p.data
  return (
    <div className="page" data-testid="patient-page">
      <div className="card row wrap">
        <div className="grow">
          <h1>{x.title ? x.title + '. ' : ''}{x.name}</h1>
          <div className="muted">{x.sex === 'F' ? t('Female') : t('Male')} · {x.phone || t('no phone')} · {x.village}</div>
        </div>
        <button className="btn big" onClick={() => go({ name: 'new', personId: id })} data-testid="new-visit">➕ {t('New visit for this person')}</button>
        <EditPatientButton patientId={id} onSaved={p.reload} />
        <MergeButton person={{ id, title: x.title, name: x.name, sex: x.sex, phone: x.phone, village: x.village ?? '', source: x.source, visits: visits.data?.length ?? 0, lastVisit: null }} onDone={() => { p.reload(); visits.reload() }} />
      </div>
      {total > 0 && <div className="alert warn"><b>{t('Dues')}</b><span>{money(total)}</span></div>}
      <div className="card">
        <h2>{t('All visits')}</h2>
        {visits.data && <VisitTable rows={visits.data} showDate />}
        <div style={{ marginTop: 10 }}><button className="btn ghost" onClick={() => go({ name: 'patients' })}>← {t('Back to search')}</button></div>
      </div>
    </div>
  )
}
