import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ageToDays, formatAge, sexLabel } from '../../shared/age'
import { resolveResults } from '../../shared/checks'
import type { PanelDef, ParamDef } from '../../shared/types'
import { api, ApiError, enterNext, fmtDate, fmtDateTime, money, useApp, useAsync, type Entry } from '../ui'

export function VisitScreen({ visitId }: { visitId: number }) {
  const { t, go } = useApp()
  const entry = useAsync(() => api.results.entry(visitId), [visitId])
  if (entry.loading && !entry.data) return <div className="page">{t('Loading…')}</div>
  if (!entry.data) return <div className="page"><div className="alert bad">{entry.error || t('Not found')}</div></div>
  const e = entry.data
  return (
    <div className="page">
      <PatientStrip e={e} />
      {e.status === 'draft' ? (
        <EntryView key={`${e.reportId}`} e={e} reload={entry.reload} />
      ) : e.status === 'approved' || e.status === 'imported' ? (
        <ApprovedView e={e} reload={entry.reload} />
      ) : (
        <div className="alert info"><b>ℹ</b><span>{t('All tests on this visit are sent to another lab. There are no results to type here.')}</span></div>
      )}
      <SentOut e={e} reload={entry.reload} />
      <div className="row noprint">
        <button className="btn ghost" onClick={() => go({ name: 'today' })}>← {t('Back')}</button>
        <button className="btn ghost" onClick={() => go({ name: 'patients', patientId: e.visit.patientId })}>{t('Patient history')}</button>
      </div>
    </div>
  )
}

function PatientStrip({ e }: { e: Entry }) {
  const { t } = useApp()
  const v = e.visit
  return (
    <div className="card row wrap" data-testid="patient-strip">
      <div className="grow">
        <h1 style={{ textTransform: 'uppercase' }}>{v.title ? v.title + '. ' : ''}{v.patientName}</h1>
        <div className="muted">
          {formatAge(v.age)} · {sexLabel(v.sex)} · {t('Ref. by')} {v.doctor} · {fmtDate(v.date)}
        </div>
      </div>
      <div className="right">
        <div className="muted">{t('Sample ID')}</div>
        <div className="mono" style={{ fontSize: 26, fontWeight: 800, color: 'var(--hema)' }} data-testid="sample-id">{v.sampleId}</div>
      </div>
      <div>
        {e.status === 'draft' && <span className="tag pending">{t('Results pending')}</span>}
        {e.status === 'approved' && <span className="tag ok">🔒 {t('Approved')}{e.version > 1 ? ` · v${e.version}` : ''}</span>}
        {e.status === 'imported' && <span className="tag grey">{t('Imported (read-only)')}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ entry */

function EntryView({ e, reload }: { e: Entry; reload: () => void }) {
  const { t, toast, guard, settings, askPin, confirm, prompt, go } = useApp()
  const [typed, setTyped] = useState<Record<string, string>>(e.typed)
  const [dups, setDups] = useState(e.duplicates)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const typedRef = useRef(typed)
  typedRef.current = typed
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ageDays = ageToDays(e.visit.age)
  const resolved = useMemo(() => resolveResults(e.panels, typed, e.visit.sex, ageDays), [e.panels, typed, e.visit.sex, ageDays])
  const errors = resolved.issues.filter((i) => i.severity === 'error')
  const crit = resolved.issues.filter((i) => i.severity === 'critical')
  const warns = resolved.issues.filter((i) => i.severity === 'warn')

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    setSaveState('saving')
    try {
      const r = await api.results.save(e.reportId!, typedRef.current)
      setDups(r.duplicates)
      setSaveState('saved')
    } catch (err) {
      setSaveState('dirty')
      toast(err instanceof ApiError ? err.message : String(err), 'bad')
    }
  }, [e.reportId, toast])

  function set(code: string, v: string) {
    setTyped((m) => ({ ...m, [code]: v }))
    setSaveState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); api.results.save(e.reportId!, typedRef.current).catch(() => undefined) } }, [e.reportId])

  async function approve(dupReason?: string, pin?: string): Promise<void> {
    await flush()
    try {
      await api.results.approve(e.reportId!, { pin, dupReason })
      toast(t('Report approved and locked.'), 'ok')
      reload()
    } catch (err) {
      if (!(err instanceof ApiError)) return toast(String(err), 'bad')
      if (err.code === 'DUPLICATE') {
        const hits = err.data as { sampleId: string; patientName: string; date: string }[]
        const reason = await prompt({
          title: t('Same results as another patient'),
          label: `${t('These numbers are identical to')} ${hits.map((h) => `${h.sampleId} (${h.patientName}, ${fmtDate(h.date)})`).join(', ')}. ${t('Type the reason to continue')}:`,
          ok: t('Approve with this reason'), minLength: 3
        })
        if (reason) return approve(reason, pin)
      } else if (err.code === 'PIN') {
        const p = await askPin(t('Doctor PIN to approve'))
        if (p) return approve(dupReason, p)
      } else toast(err.message, 'bad')
    }
  }

  async function startApprove() {
    if (errors.length) return toast(t('Fix the red values first.'), 'bad')
    const ok = await confirm({
      title: t('Approve and lock this report?'),
      body: (
        <div className="col">
          <span>{t('After approval nothing can be edited. A correction will make a new version and keep this one.')}</span>
          {crit.length > 0 && <div className="alert crit">⚠ {crit.map((c) => c.message).join(' · ')} — {t('please inform the doctor.')}</div>}
          {dups.length > 0 && <div className="alert bad"><b>{t('Duplicate')}</b><span>{t('Identical to another patient’s report — you will be asked for a reason.')}</span></div>}
        </div>
      ),
      ok: t('Approve report')
    })
    if (!ok) return
    let pin: string | undefined
    if (settings.rolesEnabled) {
      const p = await askPin(t('Doctor PIN to approve'))
      if (!p) return
      pin = p
    }
    await approve(undefined, pin)
  }

  async function discard() {
    if (!(await confirm({ title: t('Cancel this correction?'), body: t('The approved version stays as it is.'), danger: true }))) return
    await guard(api.results.discardCorrection(e.reportId!))
    reload()
  }

  return (
    <div onKeyDown={(ev) => enterNext(ev)} className="col" data-testid="entry-view">
      {e.hasCorrectionDraft && (
        <div className="alert warn"><b>{t('Correction in progress')}</b><span>{t('Reason')}: {e.correctionReason}. {t('The earlier approved version stays valid until you approve this one.')}</span>
          <button className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={discard}>{t('Cancel correction')}</button></div>
      )}

      {e.panels.map((panel) => (
        <PanelCard key={panel.code} panel={panel} e={e} typed={typed} set={set} resolved={resolved} />
      ))}

      <div className="col" data-testid="issues">
        {crit.map((i) => <div className="alert crit" key={i.message} data-testid="critical-alert">⚠ {i.message} — {t('please inform the doctor.')}</div>)}
        {errors.map((i) => <div className="alert bad" key={i.message} data-testid="error-alert"><b>✖</b><span>{i.message}</span></div>)}
        {warns.map((i) => <div className="alert warn" key={i.message} data-testid="warn-alert"><b>⚠</b><span>{i.message}</span></div>)}
        {dups.map((d) => (
          <div className="alert bad" key={d.panelCode + d.sampleId} data-testid="dup-alert">
            <b>{t('Check:')}</b>
            <span>{t('these values are exactly the same as sample')} <b>{d.sampleId}</b> ({t('a different patient')}, {fmtDate(d.date)}). {t('Please re-read the analyzer before saving.')}</span>
          </div>
        ))}
      </div>

      <div className="row noprint">
        <span className="muted" data-testid="save-state">{saveState === 'saved' ? `✓ ${t('Saved on this PC')}` : saveState === 'saving' ? t('Saving…') : t('Typing…')}</span>
        <div className="grow" />
        <button className="btn big" onClick={startApprove} disabled={errors.length > 0} data-testid="approve">{t('Approve report')}</button>
      </div>
    </div>
  )
}

function PanelCard({ panel, e, typed, set, resolved }: { panel: PanelDef; e: Entry; typed: Record<string, string>; set: (c: string, v: string) => void; resolved: ReturnType<typeof resolveResults> }) {
  const { t } = useApp()
  let lastGroup: string | null = null
  const rows = resolved.rows.filter((r) => r.panel.code === panel.code)
  return (
    <div className="card" data-testid={`panel-${panel.code}`}>
      <h2>{panel.name} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>{panel.section}</span></h2>
      <table className="t res">
        <thead><tr><th>{t('Test')}</th><th>{t('Result')}</th><th>{t('Unit')}</th><th>{t('Range')}</th><th>{t('Previous')}</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const p = r.param
            const g = p.group && p.group !== lastGroup ? p.group : null
            lastGroup = p.group
            const prev = e.previous[p.code]
            const crit = r.eval.critical
            return [
              g && <tr className="grp" key={`g-${p.code}`}><td colSpan={5}>{g}</td></tr>,
              <tr key={p.code} data-testid={`row-${p.code}`}>
                <td className="name">{p.name}</td>
                <td className="val">
                  <div className="vwrap">
                    <ValueInput p={p} value={typed[p.code] ?? ''} placeholder={resolved.calculated[p.code] ?? ''} bad={r.eval.state === 'invalid'} auto={r.auto} onChange={(v) => set(p.code, v)} />
                    {crit ? <span className="flag C" title={t('Critical value')} data-testid={`flag-${p.code}`}>!!</span>
                      : r.eval.flag ? <span className={`flag ${r.eval.flag}`} data-testid={`flag-${p.code}`}>{r.eval.flag === 'A' ? '●' : r.eval.flag}</span> : null}
                  </div>
                </td>
                <td className="unit">{p.unit}</td>
                <td className="rng">{r.eval.rangeText}{p.calc && <span className="muted"> · auto</span>}</td>
                <td className="prev" title={prev ? `${prev.sampleId}` : ''}>{prev ? <><b className={prev.flag ? 'flagtext' : ''}>{prev.value}</b> <span>({fmtDate(prev.date)})</span></> : ''}</td>
              </tr>
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function ValueInput({ p, value, placeholder, bad, auto, onChange }: { p: ParamDef; value: string; placeholder: string; bad: boolean; auto: boolean; onChange: (v: string) => void }) {
  if (p.type === 'select') {
    return (
      <select className={`input${bad ? ' bad' : ''}`} data-nav data-testid={`in-${p.code}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (p.type === 'titre') {
    return (
      <div className="titres" data-testid={`in-${p.code}`}>
        {p.options.map((o) => (
          <button key={o} type="button" data-nav className={value === o ? 'on' : ''} onClick={() => onChange(o)} aria-pressed={value === o}>{o === '0' ? 'Nil' : `1:${o}`}</button>
        ))}
      </div>
    )
  }
  if (p.type === 'text') {
    return (
      <>
        <input className="input" list={`dl-${p.code}`} data-nav data-testid={`in-${p.code}`} value={value} onChange={(e) => onChange(e.target.value)} />
        {p.options.length > 0 && <datalist id={`dl-${p.code}`}>{p.options.map((o) => <option key={o} value={o} />)}</datalist>}
      </>
    )
  }
  return (
    <input
      className={`input num${bad ? ' bad' : ''}${auto || (p.calc && !value) ? ' auto' : ''}`}
      inputMode={p.type === 'duration' ? 'text' : 'decimal'}
      data-nav
      data-testid={`in-${p.code}`}
      value={value}
      placeholder={p.type === 'duration' ? 'm:ss' : placeholder}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,:]/g, ''))}
    />
  )
}

/* --------------------------------------------------------------- approved */

function ApprovedView({ e, reload }: { e: Entry; reload: () => void }) {
  const { t, toast, guard, askPin, prompt, settings, go } = useApp()
  const versions = useAsync(() => api.results.versions(e.visit.id), [e.visit.id, e.reportId])
  const [selected, setSelected] = useState<number | null>(null)
  const reportId = selected ?? e.reportId!
  const html = useAsync(() => api.report.html(reportId), [reportId])
  const [busy, setBusy] = useState('')
  const hasPhone = e.phone.length === 10
  const imported = e.status === 'imported'
  const sel = (versions.data ?? []).find((v) => v.id === reportId)

  async function print() {
    setBusy('print')
    const ok = await guard(api.report.print(reportId))
    setBusy('')
    if (ok) toast(t('Sent to the printer.'), 'ok')
  }
  async function pdf() {
    const p = await guard(api.report.saveAs(reportId))
    if (p) toast(`${t('PDF saved')}: ${p}`, 'ok')
  }
  async function openPdf() {
    await guard(api.report.openPdf(reportId))
  }
  async function wa() {
    setBusy('wa')
    const r = await guard(api.whatsapp.send(reportId))
    setBusy('')
    if (!r) return
    if (r.level === 'A') toast(r.copied ? t('Press Ctrl+V then Enter in WhatsApp (the PDF is copied).') : t('WhatsApp opened. The PDF could not be copied; attach it from the saved file.'), r.copied ? 'ok' : '')
    else toast(t('WhatsApp opened with the report link. Press Enter to send.'), 'ok')
  }
  async function correct() {
    const pin = settings ? await (async () => { const s = await api.settings.pinStatus(); return s.ownerSet ? askPin(t('PIN to correct a report')) : '' })() : ''
    if (pin === null) return
    const reason = await prompt({ title: t('Correct this report'), label: t('Reason for the correction (kept with the report)'), ok: t('Start correction') })
    if (!reason) return
    const r = await guard(api.results.startCorrection(e.visit.id, reason, pin || undefined))
    if (r) { toast(t('A new version is open for editing.'), 'ok'); reload() }
  }

  return (
    <div className="col" data-testid="approved-view">
      {sel && !sel.is_current && <div className="alert warn"><b>{t('Older version')}</b><span>{t('This version was replaced by a newer one on')} {fmtDateTime(sel.superseded_at)}. {t('It is kept for the record only.')}</span></div>}
      {imported && <div className="alert info"><b>ℹ</b><span>{t('Imported from an old Word/PDF report. It is shown for history and cannot be edited.')}</span></div>}
      <div className="card col">
        <div className="row wrap noprint">
          <button className="btn" onClick={print} disabled={busy === 'print'} data-testid="print">🖨 {t('Print')}</button>
          <button className="btn ghost" onClick={pdf} data-testid="save-pdf">⬇ {t('Save PDF')}</button>
          <button className="btn ghost" onClick={openPdf} data-testid="open-pdf">{t('Open PDF')}</button>
          <button className="btn wa" onClick={wa} disabled={!hasPhone || busy === 'wa' || imported} title={hasPhone ? '' : t('No phone number')} data-testid="whatsapp">{t('Send on WhatsApp')}</button>
          {!hasPhone && !imported && <span className="muted">{t('No phone number: print only.')}</span>}
          <div className="grow" />
          {!imported && sel?.is_current !== 0 && <button className="btn ghost" onClick={correct} data-testid="correct">✎ {t('Correct report')}</button>}
        </div>
        {(versions.data?.length ?? 0) > 1 && (
          <div className="row wrap noprint">
            <span className="muted">{t('Versions')}:</span>
            {versions.data!.map((v) => (
              <button key={v.id} className={`chip${v.id === reportId ? ' on' : ''}`} onClick={() => setSelected(v.id)}>
                v{v.version} {v.is_current ? `(${t('current')})` : `(${t('old')})`} <small>{fmtDateTime(v.approved_at)}</small>
              </button>
            ))}
          </div>
        )}
        {sel && sel.version > 1 && sel.reason && <div className="muted">{t('Reason')}: {sel.reason}</div>}
        {html.data ? <iframe className="preview" title="report" srcDoc={html.data} sandbox="" data-testid="preview" /> : <div>{t('Loading…')}</div>}
      </div>
      <div className="row noprint">
        <button className="btn ghost" onClick={() => go({ name: 'new' })}>➕ {t('New patient')}</button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- sent out */

function SentOut({ e, reload }: { e: Entry; reload: () => void }) {
  const { t, guard, toast } = useApp()
  if (!e.sentOut.length) return null
  return (
    <div className="card col" data-testid="sentout">
      <h2>{t('Sent-out tests')}</h2>
      <div className="muted">{t('These tests are done by another lab. Log where they were sent and attach the original PDF exactly as received.')}</div>
      <table className="t">
        <thead><tr><th>{t('Test')}</th><th>{t('Sent to')}</th><th>{t('Sent on')}</th><th>{t('Received')}</th><th /></tr></thead>
        <tbody>
          {e.sentOut.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td><input className="input" style={{ minHeight: 38 }} defaultValue={s.sentTo ?? ''} placeholder={t('Lab name')} onBlur={async (ev) => { if (ev.target.value !== (s.sentTo ?? '')) { await guard(api.visits.markSentOut(s.id, { sentTo: ev.target.value })); reload() } }} /></td>
              <td><input className="input" style={{ minHeight: 38 }} type="date" defaultValue={s.sentAt ?? ''} onBlur={async (ev) => { if (ev.target.value && ev.target.value !== s.sentAt) { await guard(api.visits.markSentOut(s.id, { sentAt: ev.target.value })); reload() } }} /></td>
              <td>{s.receivedAt ? <span className="tag ok">{fmtDate(s.receivedAt)}</span> : <span className="tag pending">{t('Awaited')}</span>}</td>
              <td className="right">
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {s.attachment && <button className="btn small ghost" onClick={() => api.visits.openAttachment(s.attachment!)}>{t('Open PDF')}</button>}
                  <button className="btn small ghost" onClick={async () => { const r = await guard(api.visits.attachSentOut(s.id)); if (r) { toast(t('Original report attached.'), 'ok'); reload() } }}>{s.attachment ? t('Replace PDF') : t('Attach received PDF')}</button>
                  {!s.receivedAt && <button className="btn small ghost" onClick={async () => { await guard(api.visits.markSentOut(s.id, { receivedAt: new Date().toISOString().slice(0, 10) })); reload() }}>{t('Mark received')}</button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 14 }}>{money(0) && ''}{t('Give the patient the received PDF as it is. This program never creates another lab’s report.')}</div>
    </div>
  )
}
