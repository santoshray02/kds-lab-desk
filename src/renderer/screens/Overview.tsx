import { useState } from 'react'
import { api, fmtDate, money, useApp, useAsync } from '../ui'

const INDIGO = '#3a3a8c'
const TEAL = '#127c96'
const GRID = '#e3e6f0'
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function niceMax(v: number): number {
  if (v <= 0) return 100
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}
const short = (n: number) => (n >= 100000 ? `${+(n / 100000).toFixed(1)}L` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(Math.round(n)))

function Delta({ now, before, t }: { now: number; before: number; t: (s: string) => string }) {
  if (!before) return <div className="muted small">{t('no earlier data to compare')}</div>
  const pct = Math.round(((now - before) / before) * 100)
  const up = pct >= 0
  return <div className="small" style={{ color: up ? 'var(--ok)' : 'var(--eosin)' }}>{up ? '▲' : '▼'} {Math.abs(pct)}% {t('vs the period before')}</div>
}

function Kpi({ label, value, children, id }: { label: string; value: string; children?: React.ReactNode; id?: string }) {
  return <div className="stat" data-testid={id}><div className="n">{value}</div><div className="muted">{label}</div>{children}</div>
}

function DailyChart({ days, t }: { days: { date: string; billed: number; cash: number; visits: number }[]; t: (s: string) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 1000, H = 240, L = 46, R = 8, T = 10, B = 26
  const max = niceMax(Math.max(...days.map((d) => Math.max(d.billed, d.cash))))
  const iw = W - L - R, ih = H - T - B
  const slot = iw / days.length
  const bw = Math.max(2, Math.min(22, slot - 3))
  const x = (i: number) => L + slot * i + slot / 2
  const y = (v: number) => T + ih - (v / max) * ih
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.cash).toFixed(1)}`).join(' ')
  const every = Math.ceil(days.length / 8)
  const h = hover != null ? days[hover] : null
  return (
    <div style={{ position: 'relative' }}>
      <div className="legend"><span><i style={{ background: INDIGO }} />{t('Billed')}</span><span><i style={{ background: TEAL, height: 3 }} />{t('Cash collected')}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('Daily billing and cash collected')} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke={GRID} /><text x={L - 6} y={y(max * f) + 4} fontSize="11" textAnchor="end" fill="#5d6378">{short(max * f)}</text></g>
        ))}
        {days.map((d, i) => (
          <g key={d.date}>
            {d.billed > 0 && <rect x={x(i) - bw / 2} y={y(d.billed)} width={bw} height={Math.max(1, T + ih - y(d.billed))} rx={Math.min(3, bw / 2)} fill={INDIGO} opacity={hover == null || hover === i ? 1 : 0.45} />}
            {i % every === 0 && <text x={x(i)} y={H - 8} fontSize="11" textAnchor="middle" fill="#5d6378">{d.date.slice(8)}/{d.date.slice(5, 7)}</text>}
            <rect x={x(i) - slot / 2} y={T} width={slot} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        <path d={line} fill="none" stroke={TEAL} strokeWidth="2" strokeLinejoin="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} stroke="#8a90a8" strokeDasharray="3 3" />}
        {hover != null && <circle cx={x(hover)} cy={y(days[hover].cash)} r="4.5" fill={TEAL} stroke="#fff" strokeWidth="2" />}
      </svg>
      {h && (
        <div className="tip" style={{ left: `${Math.min(78, Math.max(2, (x(hover!) / W) * 100 - 8))}%` }}>
          <b>{fmtDate(h.date)}</b><br />{t('Billed')} {money(h.billed)}<br />{t('Cash collected')} {money(h.cash)}<br />{h.visits} {t('visits')}
        </div>
      )}
    </div>
  )
}

function HBars({ rows }: { rows: { label: string; value: number; extra?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.label} className="hb" title={`${r.label}: ${r.value}${r.extra ? ' · ' + r.extra : ''}`}>
          <div className="lb">{r.label}</div>
          <div className="tr"><div className="fl" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <div className="vl">{r.value}</div>
        </div>
      ))}
    </div>
  )
}

export function Overview() {
  const { t } = useApp()
  const [n, setN] = useState(30)
  const r = useAsync(() => api.owner.insights(n), [n])
  const d = r.data
  const tot = d?.totals
  const collectedPct = tot && tot.billed > 0 ? Math.round(((tot.billed - tot.due) / tot.billed) * 100) : 0
  const maxWd = Math.max(1, ...(d?.weekday ?? [0]))
  return (
    <div className="col" data-testid="overview">
      <div className="seg noprint">
        {[7, 30, 90].map((k) => <button key={k} className={`segb${n === k ? ' on' : ''}`} onClick={() => setN(k)}>{t(k === 7 ? 'Last 7 days' : k === 30 ? 'Last 30 days' : 'Last 90 days')}</button>)}
      </div>
      {d && tot && (
        <>
          <div className="statgrid">
            <Kpi label={t('Billed')} value={money(tot.billed)} id="kpi-billed"><Delta now={tot.billed} before={d.previous.billed} t={t} /></Kpi>
            <Kpi label={t('Cash collected')} value={money(tot.cash)}><Delta now={tot.cash} before={d.previous.cash} t={t} /></Kpi>
            <Kpi label={t('Patients visits')} value={String(tot.visits)}><Delta now={tot.visits} before={d.previous.visits} t={t} /></Kpi>
            <Kpi label={t('Average bill')} value={money(tot.avgBill)}><div className="muted small">{tot.turnaroundHours != null ? `${t('Average time to report')}: ${tot.turnaroundHours < 1 ? t('under 1 hour') : `${tot.turnaroundHours} ${t('hours')}`}` : ''}</div></Kpi>
          </div>
          <div className="card">
            <h2>{t('Daily billing and cash collected')}</h2>
            {tot.visits === 0 ? <div className="muted">{t('No visits in this period yet.')}</div> : <DailyChart days={d.days} t={t} />}
          </div>
          <div className="grid2">
            <div className="card">
              <h2>{t('Most done tests')}</h2>
              {d.topTests.length === 0 ? <div className="muted">–</div> : <HBars rows={d.topTests.map((x) => ({ label: x.name, value: x.count, extra: money(x.revenue) }))} />}
            </div>
            <div className="card">
              <h2>{t('Who refers patients')}</h2>
              {d.doctors.length === 0 ? <div className="muted">–</div> : <HBars rows={d.doctors.map((x) => ({ label: x.doctor, value: x.visits }))} />}
            </div>
          </div>
          <div className="grid2">
            <div className="card">
              <h2>{t('Busiest days of the week')}</h2>
              <div className="cols">
                {d.weekday.map((c, i) => (
                  <div key={i} className="colb" title={`${t(WEEK[i])}: ${c}`}>
                    <div className="vl">{c || ''}</div>
                    <div className="bar" style={{ height: `${(c / maxWd) * 100}%` }} />
                    <div className="lb">{t(WEEK[i])}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h2>{t('Money collected vs still due')}</h2>
              <div className="split" title={`${collectedPct}%`}>
                <div style={{ width: `${collectedPct}%`, background: TEAL }} />
                <div style={{ width: `${100 - collectedPct}%`, background: 'var(--eosin)' }} />
              </div>
              <div className="legend" style={{ marginTop: 8 }}>
                <span><i style={{ background: TEAL }} />{t('Collected')} {money(tot.billed - tot.due)} ({collectedPct}%)</span>
                <span><i style={{ background: 'var(--eosin)' }} />{t('Due')} {money(tot.due)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
