import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { SECTION_ORDER } from '../../shared/masterData'
import { rangeText } from '../../shared/ranges'
import { CHILD_MAX_DAYS, MAX_AGE_DAYS, type PanelDef, type ParamDef, type RangeRow } from '../../shared/types'
import { api, fmtDateTime, money, useApp, useAsync } from '../ui'

type Tab = 'general' | 'master' | 'security' | 'cloud' | 'data'

export function SettingsScreen() {
  const { t } = useApp()
  const [pin, setPin] = useState<string | undefined>(undefined)
  const [unlocked, setUnlocked] = useState(false)
  const [tab, setTab] = useState<Tab>('general')
  const status = useAsync(() => api.settings.pinStatus(), [unlocked])

  useEffect(() => {
    if (status.data && !status.data.ownerSet) setUnlocked(true)
  }, [status.data])

  if (!status.data) return <div className="page">{t('Loading…')}</div>
  if (!unlocked) return <Unlock onOk={(p) => { setPin(p); setUnlocked(true) }} />

  const tabs: [Tab, string][] = [['general', 'General'], ['master', 'Test master & prices'], ['security', 'PIN & users'], ['cloud', 'Cloud sync'], ['data', 'Data & updates']]
  return (
    <div className="page" data-testid="settings">
      <h1>{t('Settings')}</h1>
      {!status.data.ownerSet && (
        <div className="banner hema"><b>🔒 {t('No PIN is set.')}</b><span>{t('Set a 4-digit PIN under “PIN & users” so only the owner can change settings, ranges and corrections.')}</span></div>
      )}
      <div className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)} data-testid={`stab-${k}`}>{t(l)}</button>)}
      </div>
      {tab === 'general' && <General pin={pin} />}
      {tab === 'master' && <MasterTab pin={pin} />}
      {tab === 'security' && <Security pin={pin} onPin={(p) => setPin(p)} refresh={status.reload} />}
      {tab === 'cloud' && <Cloud pin={pin} />}
      {tab === 'data' && <DataTab pin={pin} />}
    </div>
  )
}

function Unlock({ onOk }: { onOk: (pin: string) => void }) {
  const { t, toast } = useApp()
  const [v, setV] = useState('')
  async function go() {
    if (await api.settings.checkPin(v)) onOk(v)
    else { toast(t('Wrong PIN'), 'bad'); setV('') }
  }
  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1>{t('Settings')}</h1>
      <div className="card col">
        <h2>🔒 {t('Enter the 4-digit PIN')}</h2>
        <input className="input num" type="password" inputMode="numeric" maxLength={4} autoFocus value={v} data-testid="unlock-pin"
          onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && v.length === 4 && go()} />
        <button className="btn" disabled={v.length !== 4} onClick={go} data-testid="unlock-ok">{t('Open settings')}</button>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- general */

function General({ pin }: { pin?: string }) {
  const { t, settings, reloadSettings, toast, guard } = useApp()
  const [s, setS] = useState<Settings>(settings)
  const [printers, setPrinters] = useState<string[]>([])
  useEffect(() => { api.app.printers().then(setPrinters).catch(() => undefined) }, [])
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }))
  const lab = (k: keyof Settings['lab'], v: string) => setS((x) => ({ ...x, lab: { ...x.lab, [k]: v } }))
  async function save() {
    const r = await guard(api.settings.set({
      lab: s.lab, paper: s.paper, letterhead: s.letterhead, letterheadTopMm: s.letterheadTopMm, letterheadBottomMm: s.letterheadBottomMm,
      phoneRequired: s.phoneRequired, waMessageEn: s.waMessageEn, waMessageHi: s.waMessageHi, waTarget: s.waTarget, silentPrint: s.silentPrint, printerName: s.printerName,
      penDriveReminderDays: s.penDriveReminderDays
    }, pin))
    if (r) { await reloadSettings(); toast(t('Settings saved'), 'ok') }
  }
  return (
    <div className="col">
      <div className="card col">
        <h2>{t('Report header and signatures')}</h2>
        <div className="grid2">
          <label className="f">{t('Lab name')}<input className="input" value={s.lab.name} onChange={(e) => lab('name', e.target.value)} /></label>
          <label className="f">{t('Line under the name')}<input className="input" value={s.lab.tagline} onChange={(e) => lab('tagline', e.target.value)} /></label>
        </div>
        <div className="grid4">
          <label className="f">{t('Phone (printed on header)')}<input className="input" value={s.lab.phone} onChange={(e) => lab('phone', e.target.value)} /></label>
          <label className="f">{t('Email (printed on header)')}<input className="input" value={s.lab.email} onChange={(e) => lab('email', e.target.value)} /></label>
          <label className="f">{t('Opening hours')}<input className="input" value={s.lab.timings} onChange={(e) => lab('timings', e.target.value)} /></label>
          <label className="f">{t('Registration no. (optional)')}<input className="input" value={s.lab.regNo} onChange={(e) => lab('regNo', e.target.value)} /></label>
        </div>
        <div><button className="btn ghost" onClick={async () => { const f = await guard(api.report.saveLetterhead()); if (f) toast(t('Letterhead saved'), 'ok') }} data-testid="save-letterhead">{t('Save blank letterhead PDF')}</button></div>
        <label className="f">{t('Address line')}<input className="input" value={s.lab.address} onChange={(e) => lab('address', e.target.value)} /></label>
        <div className="grid4">
          <label className="f">{t('Left signature')}<input className="input" value={s.lab.doctorName} onChange={(e) => lab('doctorName', e.target.value)} /></label>
          <label className="f">{t('Qualification')}<input className="input" value={s.lab.doctorQual} onChange={(e) => lab('doctorQual', e.target.value)} /></label>
          <label className="f">{t('Right signature')}<input className="input" value={s.lab.techName} onChange={(e) => lab('techName', e.target.value)} /></label>
          <label className="f">{t('Qualification')}<input className="input" value={s.lab.techQual} onChange={(e) => lab('techQual', e.target.value)} /></label>
        </div>
        <label className="f">{t('Footer line')}<input className="input" value={s.lab.footer} onChange={(e) => lab('footer', e.target.value)} /></label>
      </div>

      <div className="card col">
        <h2>{t('Paper and printing')}</h2>
        <div className="grid2">
          <label className="f">{t('Paper size')}
            <select className="input" value={s.paper} onChange={(e) => set('paper', e.target.value as 'A4' | 'Letter')} data-testid="paper"><option value="A4">A4</option><option value="Letter">Letter</option></select>
          </label>
          <label className="f">{t('Printer')}
            <select className="input" value={s.printerName} onChange={(e) => set('printerName', e.target.value)}>
              <option value="">{t('Windows default printer')}</option>
              {printers.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <label className="checkrow"><input type="checkbox" checked={s.letterhead} onChange={(e) => set('letterhead', e.target.checked)} data-testid="letterhead" /> {t('Pre-printed letterhead paper (leave the top and bottom blank)')}</label>
        {s.letterhead && (
          <div className="grid2">
            <label className="f">{t('Blank space at top (mm)')}<input className="input num" type="number" min={0} max={120} value={s.letterheadTopMm} onChange={(e) => set('letterheadTopMm', Number(e.target.value))} /></label>
            <label className="f">{t('Blank space at bottom (mm)')}<input className="input num" type="number" min={0} max={80} value={s.letterheadBottomMm} onChange={(e) => set('letterheadBottomMm', Number(e.target.value))} /></label>
          </div>
        )}
        <label className="f" style={{ maxWidth: 420 }}>{t('Analyzer')}
          <select className="input" value="manual" onChange={() => undefined} data-testid="analyzer"><option value="manual">{t('Values typed by hand')}</option></select>
          <span style={{ fontWeight: 400 }}>{t('Reading values from the analyzer over USB can be added later for supported models.')}</span>
        </label>
        <label className="checkrow"><input type="checkbox" checked={s.silentPrint} onChange={(e) => set('silentPrint', e.target.checked)} /> {t('Print straight to the printer without the print window')}</label>
      </div>

      <div className="card col">
        <h2>{t('Patients and WhatsApp')}</h2>
        <label className="checkrow"><input type="checkbox" checked={s.phoneRequired} onChange={(e) => set('phoneRequired', e.target.checked)} data-testid="phone-required" /> {t('Phone number is required for every patient')}</label>
        <label className="f" style={{ maxWidth: 420 }}>{t('Open WhatsApp in')}
          <select className="input" value={s.waTarget} onChange={(e) => set('waTarget', e.target.value as 'web' | 'app')} data-testid="wa-target">
            <option value="web">{t('Browser (WhatsApp Web)')}</option>
            <option value="app">{t('WhatsApp Desktop app')}</option>
          </select>
        </label>
        <label className="f">{t('WhatsApp message (English). {name} and {sample} are filled in.')}<textarea className="input" rows={2} value={s.waMessageEn} onChange={(e) => set('waMessageEn', e.target.value)} /></label>
        <label className="f">{t('WhatsApp message (Hindi)')}<textarea className="input" rows={2} value={s.waMessageHi} onChange={(e) => set('waMessageHi', e.target.value)} /></label>
        <label className="f" style={{ maxWidth: 260 }}>{t('Remind about pen-drive backup every (days)')}<input className="input num" type="number" min={1} max={60} value={s.penDriveReminderDays} onChange={(e) => set('penDriveReminderDays', Number(e.target.value))} /></label>
      </div>
      <div className="row"><button className="btn big" onClick={save} data-testid="save-settings">{t('Save settings')}</button>
        <button className="btn ghost" onClick={() => setS({ ...s, lab: DEFAULT_SETTINGS.lab })}>{t('Reset header text')}</button></div>
    </div>
  )
}

/* ------------------------------------------------------ master editor */

interface EditRange { sex: 'M' | 'F' | 'A'; band: 'all' | 'adult' | 'child' | 'custom'; min: number; max: number; low: string; high: string; text: string }

function toEdit(r: RangeRow): EditRange {
  const band = r.ageMinDays === 0 && r.ageMaxDays >= MAX_AGE_DAYS ? 'all' : r.ageMinDays === 0 && r.ageMaxDays === CHILD_MAX_DAYS ? 'child' : r.ageMinDays === CHILD_MAX_DAYS && r.ageMaxDays >= MAX_AGE_DAYS ? 'adult' : 'custom'
  return { sex: r.sex, band, min: r.ageMinDays, max: r.ageMaxDays, low: r.low == null ? '' : String(r.low), high: r.high == null ? '' : String(r.high), text: r.text ?? '' }
}
function fromEdit(e: EditRange): RangeRow {
  const [a, b] = e.band === 'all' ? [0, MAX_AGE_DAYS] : e.band === 'child' ? [0, CHILD_MAX_DAYS] : e.band === 'adult' ? [CHILD_MAX_DAYS, MAX_AGE_DAYS] : [e.min, e.max]
  const num = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s))
  return { sex: e.sex, ageMinDays: a, ageMaxDays: b, low: num(e.low), high: num(e.high), text: e.text.trim() || null }
}

function MasterTab({ pin }: { pin?: string }) {
  const { t, settings, reloadSettings, toast, guard, prompt } = useApp()
  const master = useAsync(() => api.master.list(), [])
  const [sel, setSel] = useState<number | null>(null)
  const panels = master.data ?? []
  const grouped = useMemo(() => {
    const m = new Map<string, PanelDef[]>()
    for (const p of panels) { if (!m.has(p.section)) m.set(p.section, []); m.get(p.section)!.push(p) }
    return [...m.entries()].sort((a, b) => SECTION_ORDER.indexOf(a[0]) - SECTION_ORDER.indexOf(b[0]))
  }, [panels])
  const panel = panels.find((p) => p.id === sel) ?? null

  return (
    <div className="col">
      {!settings.masterReviewed ? (
        <div className="banner" data-testid="master-banner">
          <b>⚠ {t('Defaults — to be reviewed by Dr. Manoj Kumar')}</b>
          <span>{t('Check each test, unit and range below. When the doctor is satisfied, tick “Reviewed”.')}</span>
        </div>
      ) : (
        <div className="alert good"><b>✓</b><span>{t('Reviewed by the doctor on')} {fmtDateTime(settings.masterReviewedAt)}</span></div>
      )}
      <label className="checkrow"><input type="checkbox" checked={settings.masterReviewed} data-testid="reviewed"
        onChange={async (e) => { if (await guard(api.master.setReviewed(e.target.checked, pin))) await reloadSettings() }} /> {t('Reviewed by Dr. Manoj Kumar')}</label>
      <label className="checkrow"><input type="checkbox" checked={settings.pricesReviewed}
        onChange={async (e) => { if (await guard(api.master.setPricesReviewed(e.target.checked, pin))) await reloadSettings() }} /> {t('Prices are the lab’s own (not the example rates)')}</label>

      <div className="grid2" style={{ gridTemplateColumns: '360px 1fr', alignItems: 'start' }}>
        <div className="card" style={{ maxHeight: 640, overflow: 'auto' }}>
          {grouped.map(([sec, list]) => (
            <div key={sec} className="col" style={{ gap: 4, marginBottom: 10 }}>
              <span className="muted" style={{ fontWeight: 700, fontSize: 13, letterSpacing: '.08em' }}>{sec}</span>
              {list.map((p) => (
                <button key={p.id} className={`nav${sel === p.id ? ' on' : ''}`} style={{ minHeight: 42, fontSize: 16, opacity: p.active ? 1 : 0.5 }} onClick={() => setSel(p.id)} data-testid={`mp-${p.code}`}>
                  {p.name}
                  <span style={{ marginLeft: 'auto', fontSize: 14 }}>{p.price ? money(p.price) : ''}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="col">
          {!panel && <div className="card muted">{t('Choose a test on the left to see or change its units and ranges.')}</div>}
          {panel && (
            <>
              <div className="card row wrap">
                <h2 className="grow">{panel.name}</h2>
                <label className="f" style={{ width: 150 }}>{t('Price (₹)')}
                  <input className="input num" type="number" min={0} defaultValue={panel.price} key={panel.id + ':' + panel.price}
                    onBlur={async (e) => { const v = Number(e.target.value); if (v !== panel.price) { await guard(api.master.setPrice(panel.id, v, pin)); master.reload() } }} data-testid="price-input" />
                </label>
                <label className="checkrow"><input type="checkbox" checked={panel.active} onChange={async (e) => { await guard(api.master.setActive(panel.id, e.target.checked, pin)); master.reload() }} /> {t('In use')}</label>
                {panel.params.length > 0 && (
                  <label className="f" style={{ width: 230 }}>{t('This test is')}
                    <select className="input" value={panel.sentOut ? 'out' : 'in'} onChange={async (e) => { await guard(api.master.setSentOut(panel.id, e.target.value === 'out', pin)); master.reload() }} data-testid="sent-out-toggle">
                      <option value="in">{t('Done in this lab')}</option>
                      <option value="out">{t('Sent to another lab')}</option>
                    </select>
                  </label>
                )}
              </div>
              {panel.params.map((p) => (
                <ParamEditor key={`${p.id}:${p.rangeVersion}:${p.unit}`} p={p} onSave={async (edit) => {
                  const reason = await prompt({ title: `${t('Save changes to')} ${p.name}`, label: t('Reason for the change (kept in the history)'), minLength: 3 })
                  if (!reason) return
                  if (await guard(api.master.editParam({ paramId: p.id, ...edit, reason }, pin))) { toast(t('Saved. New reports will use these values; old reports stay as printed.'), 'ok'); master.reload() }
                }} />
              ))}
              {panel.params.length === 0 && <div className="card muted">{panel.sentOut ? t('Sent-out test: no ranges here. The other lab’s own report is attached.') : t('Bundle: ticks several tests together.')}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ParamEditor({ p, onSave }: { p: ParamDef; onSave: (e: { unit: string; decimals: number; ranges: RangeRow[]; criticalLow: number | null; criticalHigh: number | null }) => void }) {
  const { t } = useApp()
  const [unit, setUnit] = useState(p.unit)
  const [dec, setDec] = useState(p.decimals)
  const [ranges, setRanges] = useState<EditRange[]>(p.ranges.map(toEdit))
  const [cl, setCl] = useState(p.criticalLow == null ? '' : String(p.criticalLow))
  const [ch, setCh] = useState(p.criticalHigh == null ? '' : String(p.criticalHigh))
  const dirty = unit !== p.unit || dec !== p.decimals || JSON.stringify(ranges.map(fromEdit)) !== JSON.stringify(p.ranges.map((r) => fromEdit(toEdit(r)))) || cl !== (p.criticalLow == null ? '' : String(p.criticalLow)) || ch !== (p.criticalHigh == null ? '' : String(p.criticalHigh))
  const upd = (i: number, patch: Partial<EditRange>) => setRanges((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const numeric = p.type === 'numeric' || p.type === 'titre' || p.type === 'duration'
  return (
    <div className="card col" data-testid={`pe-${p.code}`}>
      <div className="row wrap">
        <b className="grow">{p.name}</b>
        <span className="muted">{p.type}{p.calc ? ' · auto' : ''} · {t('range version')} {p.rangeVersion}</span>
      </div>
      <div className="grid4">
        <label className="f">{t('Unit')}<input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="unit-input" /></label>
        {numeric && <label className="f">{t('Decimals')}<input className="input num" type="number" min={0} max={4} value={dec} onChange={(e) => setDec(Number(e.target.value))} /></label>}
        {numeric && <label className="f">{t('Critical below')}<input className="input num" value={cl} onChange={(e) => setCl(e.target.value)} /></label>}
        {numeric && <label className="f">{t('Critical above')}<input className="input num" value={ch} onChange={(e) => setCh(e.target.value)} /></label>}
      </div>
      {!numeric && <div className="muted">{t('Normal value(s)')}: {p.normal.join(', ') || '—'}</div>}
      {(numeric || ranges.length > 0) && (
        <table className="t">
          <thead><tr><th>{t('For')}</th><th>{t('Age')}</th><th className="num">{t('From')}</th><th className="num">{t('To')}</th><th>{t('Or text')}</th><th /></tr></thead>
          <tbody>
            {ranges.map((r, i) => (
              <tr key={i}>
                <td><select className="input" style={{ minHeight: 40 }} value={r.sex} onChange={(e) => upd(i, { sex: e.target.value as EditRange['sex'] })}><option value="A">{t('Everyone')}</option><option value="M">{t('Men')}</option><option value="F">{t('Women')}</option></select></td>
                <td><select className="input" style={{ minHeight: 40 }} value={r.band} onChange={(e) => upd(i, { band: e.target.value as EditRange['band'] })}><option value="all">{t('All ages')}</option><option value="adult">{t('Adult (12+)')}</option><option value="child">{t('Child (under 12)')}</option>{r.band === 'custom' && <option value="custom">{t('Custom')}</option>}</select></td>
                <td><input className="input num" style={{ minHeight: 40 }} value={r.low} onChange={(e) => upd(i, { low: e.target.value })} data-testid="range-low" /></td>
                <td><input className="input num" style={{ minHeight: 40 }} value={r.high} onChange={(e) => upd(i, { high: e.target.value })} data-testid="range-high" /></td>
                <td><input className="input" style={{ minHeight: 40 }} value={r.text} onChange={(e) => upd(i, { text: e.target.value })} /></td>
                <td><button className="btn small ghost" onClick={() => setRanges((x) => x.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        {numeric && <button className="btn small ghost" onClick={() => setRanges((r) => [...r, { sex: 'A', band: 'all', min: 0, max: MAX_AGE_DAYS, low: '', high: '', text: '' }])}>+ {t('Add range')}</button>}
        <span className="muted">{t('Prints as')}: {p.ranges.map((r) => rangeText(p, r)).join(' | ') || '—'}</span>
        <div className="grow" />
        <button className="btn small" disabled={!dirty} onClick={() => onSave({ unit, decimals: dec, ranges: ranges.map(fromEdit), criticalLow: cl.trim() === '' ? null : Number(cl), criticalHigh: ch.trim() === '' ? null : Number(ch) })} data-testid="save-param">{t('Save')}</button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- security */

function Security({ pin, onPin, refresh }: { pin?: string; onPin: (p: string) => void; refresh: () => void }) {
  const { t, toast, guard, settings, reloadSettings } = useApp()
  const st = useAsync(() => api.settings.pinStatus(), [])
  const [np, setNp] = useState('')
  const [dp, setDp] = useState('')
  return (
    <div className="col">
      <div className="card col">
        <h2>🔒 {t('Owner PIN')}</h2>
        <div className="muted">{t('The PIN protects Settings, the range list and corrections to approved reports. Write it down and keep it safe: it cannot be recovered.')}</div>
        <div className="row wrap">
          <input className="input num" style={{ maxWidth: 200 }} type="password" inputMode="numeric" maxLength={4} placeholder="0000" value={np} data-testid="new-pin" onChange={(e) => setNp(e.target.value.replace(/\D/g, ''))} />
          <button className="btn" disabled={np.length !== 4} data-testid="set-pin" onClick={async () => {
            if (await guard(api.settings.setPin(np, pin))) { toast(t('PIN saved'), 'ok'); onPin(np); setNp(''); st.reload(); refresh() }
          }}>{st.data?.ownerSet ? t('Change PIN') : t('Set PIN')}</button>
        </div>
      </div>
      <div className="card col">
        <h2>{t('Doctor and technician logins (optional)')}</h2>
        <label className="checkrow"><input type="checkbox" checked={settings.rolesEnabled} data-testid="roles"
          onChange={async (e) => { if (await guard(api.settings.set({ rolesEnabled: e.target.checked }, pin))) reloadSettings() }} /> {t('Only the doctor (with the doctor PIN) can approve reports')}</label>
        <div className="row wrap">
          <input className="input num" style={{ maxWidth: 200 }} type="password" inputMode="numeric" maxLength={4} placeholder={t('Doctor PIN')} value={dp} onChange={(e) => setDp(e.target.value.replace(/\D/g, ''))} />
          <button className="btn ghost" disabled={dp.length !== 4} onClick={async () => { if (await guard(api.settings.setPin(dp, pin, 'doctor'))) { toast(t('Doctor PIN saved'), 'ok'); setDp(''); st.reload() } }}>{t('Set doctor PIN')}</button>
          <span className="muted">{st.data?.doctorSet ? t('Doctor PIN is set.') : t('Not set: the owner PIN is used.')}</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- cloud */

function Cloud({ pin }: { pin?: string }) {
  const { t, settings, reloadSettings, guard, toast } = useApp()
  const [c, setC] = useState(settings.cloud)
  const status = useAsync(() => api.sync.status(), [])
  const st = status.data as { enabled: boolean; pending?: number; failed?: number; lastOk?: string; lastError?: string } | undefined
  return (
    <div className="col">
      <div className="alert info"><b>ℹ</b><span>{t('Cloud sync is off until set up. Everything works without it. Follow docs/CLOUD-SETUP.md with a family helper to create the free cloud account, then paste the two values here.')}</span></div>
      <div className="card col">
        <h2>☁ {t('Cloud connection (Supabase)')}</h2>
        <label className="f">{t('Project URL')}<input className="input mono" value={c.url} onChange={(e) => setC({ ...c, url: e.target.value })} placeholder="https://xxxx.supabase.co" data-testid="cloud-url" /></label>
        <label className="f">{t('Service key (secret — stays on this PC)')}<input className="input mono" type="password" value={c.key} onChange={(e) => setC({ ...c, key: e.target.value })} data-testid="cloud-key" /></label>
        <label className="f">{t('Report page address (where patients open their report)')}<input className="input mono" value={c.reportBase} onChange={(e) => setC({ ...c, reportBase: e.target.value })} placeholder="https://kds-reports.example.com" /></label>
        <label className="checkrow"><input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} data-testid="cloud-enabled" /> {t('Turn cloud sync on')}</label>
        <div className="row wrap">
          <button className="btn" onClick={async () => { if (await guard(api.settings.set({ cloud: c }, pin))) { await reloadSettings(); toast(t('Saved'), 'ok'); status.reload() } }} data-testid="cloud-save">{t('Save')}</button>
          <button className="btn ghost" onClick={async () => { const r = await guard(api.sync.test(c.url, c.key)) as { ok: boolean; message?: string } | undefined; if (r) toast(r.ok ? t('Connection works.') : `${t('Could not connect')}: ${r.message ?? ''}`, r.ok ? 'ok' : 'bad') }}>{t('Test connection')}</button>
          <button className="btn ghost" onClick={async () => { await guard(api.sync.now()); status.reload(); toast(t('Sync tried.'), 'ok') }}>{t('Sync now')}</button>
          <button className="btn ghost" onClick={async () => { const n = await guard(api.sync.resendAll()); if (n !== undefined) { toast(`${n} · ${t('Queued for upload')}`, 'ok'); status.reload() } }}>{t('Send everything again')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('Status')}</h2>
        {st?.enabled ? (
          <div className="col" style={{ gap: 4 }}>
            <div>{t('Waiting to upload')}: <b>{st.pending ?? 0}</b> · {t('Failed, will retry')}: <b>{st.failed ?? 0}</b></div>
            <div className="muted">{t('Last successful sync')}: {st.lastOk ? fmtDateTime(st.lastOk) : t('never')}</div>
            {st.lastError && <div className="alert warn"><span>{st.lastError}</span></div>}
          </div>
        ) : <div className="muted">{t('Sync is off.')}</div>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- data */

function DataTab({ pin }: { pin?: string }) {
  const { t, guard, toast, settings, reloadSettings, go } = useApp()
  const info = useAsync(() => api.app.info(), [])
  const [u, setU] = useState(settings.updates)
  return (
    <div className="col">
      <div className="card col">
        <h2>{t('This program')}</h2>
        <div>KDS Lab Desk {info.data?.version} · {t('data folder')}: <span className="mono">{info.data?.dataDir}</span></div>
        <div><button className="btn ghost" onClick={() => info.data && api.app.openFolder(info.data.dataDir)}>{t('Open data folder')}</button></div>
      </div>
      <div className="card col">
        <h2>{t('Demo data')}</h2>
        <div className="muted">{t('Invented patients so the program can be shown or practised on. They can be removed in one click and never mix with real records.')}</div>
        <div className="row">
          <button className="btn ghost" data-testid="load-demo" onClick={async () => { const r = await guard(api.demo.seed()); if (r) { await reloadSettings(); toast(`${r.visits} ${t('demo visits added')}`, 'ok') } }}>{t('Load demo patients')}</button>
          <button className="btn danger" data-testid="clear-demo" onClick={async () => { const r = await guard(api.demo.clear(pin)); if (r) { await reloadSettings(); toast(`${r.visits} ${t('demo visits removed')}`, 'ok') } }}>{t('Remove demo patients')}</button>
        </div>
      </div>
      <div className="card col">
        <h2>{t('Automatic updates')}</h2>
        <div className="muted">{t('The program looks for a newer version when it starts and updates itself.')}</div>
        <label className="f">{t('Update address')}<input className="input mono" value={u.url} onChange={(e) => setU({ ...u, url: e.target.value })} placeholder="https://…/releases/" /></label>
        <label className="checkrow"><input type="checkbox" checked={u.enabled} onChange={(e) => setU({ ...u, enabled: e.target.checked })} /> {t('Check for updates when the program starts')}</label>
        <div><button className="btn" onClick={async () => { if (await guard(api.settings.set({ updates: u }, pin))) { await reloadSettings(); toast(t('Saved (applies after restart)'), 'ok') } }}>{t('Save')}</button></div>
      </div>
      <div className="row"><button className="btn ghost" onClick={() => go({ name: 'backup' })}>{t('Go to Backup')}</button></div>
    </div>
  )
}
