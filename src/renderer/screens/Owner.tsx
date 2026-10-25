import { useState } from 'react'
import { Overview } from './Overview'
import { api, fmtDate, money, todayStr, useApp, useAsync } from '../ui'

export function Owner() {
  const { t } = useApp()
  const [tab, setTab] = useState<'overview' | 'day' | 'dues' | 'doctors' | 'pending'>('overview')
  const tabs: [typeof tab, string][] = [['overview', 'Overview'], ['day', 'Day register'], ['dues', 'Cash & dues'], ['doctors', 'Doctor-wise (monthly)'], ['pending', 'Pending']]
  return (
    <div className="page" data-testid="owner">
      <div className="row noprint">
        <h1 className="grow">{t('Reports')}</h1>
        <button className="btn ghost" onClick={() => window.print()}>🖨 {t('Print this page')}</button>
      </div>
      <div className="tabs noprint">
        {tabs.map(([k, label]) => <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)} data-testid={`tab-${k}`}>{t(label)}</button>)}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'day' && <Day />}
      {tab === 'dues' && <Dues />}
      {tab === 'doctors' && <Doctors />}
      {tab === 'pending' && <Pending />}
    </div>
  )
}

function Day() {
  const { t, go } = useApp()
  const [date, setDate] = useState(todayStr())
  const r = useAsync(() => api.owner.day(date), [date])
  return (
    <div className="col">
      <label className="f noprint" style={{ maxWidth: 220 }}>{t('Date')}<input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      <div className="statgrid">
        <div className="stat"><div className="n">{r.data?.visits.length ?? 0}</div><div className="muted">{t('Patients')}</div></div>
        <div className="stat"><div className="n">{money(r.data?.billed ?? 0)}</div><div className="muted">{t('Billed')}</div></div>
        <div className="stat"><div className="n" data-testid="cash">{money(r.data?.cashReceived ?? 0)}</div><div className="muted">{t('Cash received')}</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--eosin)' }}>{money(r.data?.dueOnDay ?? 0)}</div><div className="muted">{t('Due')}</div></div>
      </div>
      <div className="card">
        <h2>{t('Register for')} {fmtDate(date)}</h2>
        <table className="t">
          <thead><tr><th>{t('Sample ID')}</th><th>{t('Patient')}</th><th>{t('Ref. by')}</th><th>{t('Tests')}</th><th className="num">{t('Bill')}</th><th className="num">{t('Paid today')}</th><th className="num">{t('Due')}</th></tr></thead>
          <tbody>
            {r.data?.visits.map((v) => (
              <tr key={v.id} className="click" onClick={() => go({ name: 'visit', visitId: v.id })}>
                <td className="mono">{v.sampleId}</td><td>{v.name}</td><td>{v.doctor}</td><td>{v.tests}</td>
                <td className="num">{money(v.total)}</td><td className="num">{money(v.paidToday)}</td><td className="num">{v.due ? money(v.due) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Dues() {
  const { t, go, guard, toast, prompt } = useApp()
  const r = useAsync(() => api.owner.dues(), [])
  const day = useAsync(() => api.owner.day(todayStr()), [])
  return (
    <div className="col">
      <div className="statgrid">
        <div className="stat"><div className="n">{money(day.data?.cashReceived ?? 0)}</div><div className="muted">{t('Cash received today')}</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--eosin)' }} data-testid="dues-total">{money(r.data?.total ?? 0)}</div><div className="muted">{t('Total dues')}</div></div>
      </div>
      <div className="card">
        <h2>{t('Pending payments')}</h2>
        {r.data?.rows.length === 0 && <div className="muted">{t('No dues. ')}</div>}
        <table className="t">
          <thead><tr><th>{t('Date')}</th><th>{t('Sample ID')}</th><th>{t('Patient')}</th><th>{t('Phone')}</th><th className="num">{t('Bill')}</th><th className="num">{t('Paid')}</th><th className="num">{t('Due')}</th><th /></tr></thead>
          <tbody>
            {r.data?.rows.map((d) => (
              <tr key={d.visitId}>
                <td>{fmtDate(d.date)}</td><td className="mono">{d.sampleId}</td><td><a href="#" onClick={(e) => { e.preventDefault(); go({ name: 'visit', visitId: d.visitId }) }}>{d.name}</a></td><td className="mono">{d.phone}</td>
                <td className="num">{money(d.total)}</td><td className="num">{money(d.paid)}</td><td className="num" style={{ color: 'var(--eosin)' }}>{money(d.due)}</td>
                <td className="right noprint"><button className="btn small" onClick={async () => {
                  const v = await prompt({ title: `${t('Receive payment')} — ${d.name}`, label: `${t('Amount (₹), due')} ${Math.round(d.due)}`, minLength: 1 })
                  const n = Number(v)
                  if (v && n > 0) { await guard(api.visits.addPayment(d.visitId, Math.min(n, d.due), 'Received later')); toast(t('Payment saved'), 'ok'); r.reload(); day.reload() }
                }}>{t('Receive')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Doctors() {
  const { t } = useApp()
  const [ym, setYm] = useState(todayStr().slice(0, 7))
  const r = useAsync(() => api.owner.doctors(ym), [ym])
  const total = r.data?.reduce((a, d) => a + d.visits, 0) ?? 0
  return (
    <div className="col">
      <label className="f noprint" style={{ maxWidth: 220 }}>{t('Month')}<input className="input" type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>
      <div className="card">
        <h2>{t('Patients referred, by doctor')} — {ym}</h2>
        <table className="t" data-testid="doctor-table">
          <thead><tr><th>{t('Doctor')}</th><th className="num">{t('Visits')}</th><th className="num">{t('Different patients')}</th><th className="num">{t('Billed')}</th></tr></thead>
          <tbody>
            {r.data?.map((d) => <tr key={d.doctor}><td><b>{d.doctor}</b></td><td className="num">{d.visits}</td><td className="num">{d.patients}</td><td className="num">{money(d.billed)}</td></tr>)}
            <tr><td><b>{t('Total')}</b></td><td className="num"><b>{total}</b></td><td /><td className="num"><b>{money(r.data?.reduce((a, d) => a + d.billed, 0) ?? 0)}</b></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Pending() {
  const { t, go } = useApp()
  const r = useAsync(() => api.owner.pending(), [])
  return (
    <div className="col">
      <div className="card">
        <h2>{t('Registered but not reported')} ({r.data?.unreported.length ?? 0})</h2>
        <table className="t">
          <thead><tr><th>{t('Sample ID')}</th><th>{t('Date')}</th><th>{t('Patient')}</th><th>{t('Tests')}</th><th className="num">{t('Days waiting')}</th></tr></thead>
          <tbody>
            {r.data?.unreported.map((p) => (
              <tr key={p.visitId} className="click" onClick={() => go({ name: 'visit', visitId: p.visitId })}>
                <td className="mono">{p.sampleId}</td><td>{fmtDate(p.date)}</td><td>{p.name}</td><td>{p.tests}</td><td className="num">{p.ageDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>{t('Sent out, report not yet received')} ({r.data?.sentOut.length ?? 0})</h2>
        <table className="t" data-testid="sentout-table">
          <thead><tr><th>{t('Sample ID')}</th><th>{t('Patient')}</th><th>{t('Test')}</th><th>{t('Sent to')}</th><th>{t('Sent on')}</th></tr></thead>
          <tbody>
            {r.data?.sentOut.map((p) => (
              <tr key={p.visitTestId} className="click" onClick={() => go({ name: 'visit', visitId: p.visitId })}>
                <td className="mono">{p.sampleId}</td><td>{p.name}</td><td>{p.test}</td><td>{p.sentTo || '—'}</td><td>{fmtDate(p.sentAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
