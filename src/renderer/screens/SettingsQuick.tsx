import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { SECTION_ORDER } from '../../shared/masterData'
import { api, Modal, money, useApp, useAsync } from '../ui'

type Group = Pick<Settings, 'receipt' | 'labels' | 'money' | 'packages'>
const pick = (s: Settings): Group => ({ receipt: s.receipt, labels: s.labels, money: s.money, packages: s.packages })
const clampInt = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, parseInt(v.replace(/\D/g, ''), 10) || lo))

/** Settings → Bills, stickers & money. Every option has a usual value and can be put back with one button. */
export function QuickSettings({ pin }: { pin?: string }) {
  const { t, settings, guard, toast, reloadSettings, confirm } = useApp()
  const [g, setG] = useState<Group>(pick(settings))
  const [printers, setPrinters] = useState<string[]>([])
  const [cats, setCats] = useState(settings.money.expenseCategories.join('\n'))
  useEffect(() => { api.app.printers().then(setPrinters).catch(() => undefined) }, [])
  const dirty = JSON.stringify(g) !== JSON.stringify(pick(settings)) || cats !== settings.money.expenseCategories.join('\n')
  const set = <K extends keyof Group>(k: K, patch: Partial<Group[K]> | Group[K]) => setG((x) => ({ ...x, [k]: typeof patch === 'object' ? { ...(x[k] as object), ...patch } : patch }) as Group)

  async function save() {
    const list = cats.split('\n').map((c) => c.trim()).filter(Boolean)
    const next: Group = { ...g, money: { ...g.money, expenseCategories: list.length ? list : DEFAULT_SETTINGS.money.expenseCategories } }
    const r = await guard(api.settings.set(next, pin))
    if (r) { await reloadSettings(); toast(t('Settings saved'), 'ok') }
  }
  async function reset() {
    if (!(await confirm({ title: t('Put the usual values back?'), body: t('Receipt, stickers and money options return to the values the program started with. Your packages are not changed.'), ok: t('Yes, put them back') }))) return
    const d = pick(DEFAULT_SETTINGS)
    setG(d)
    setCats(d.money.expenseCategories.join('\n'))
  }
  const printerSelect = (value: string, onChange: (v: string) => void, testid: string) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
      <option value="">{t('The printer chosen under General')}</option>
      {printers.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  )

  return (
    <div className="col" data-testid="quick-settings">
      <div className="muted">{t('Everything here has a usual value that works for a small lab. Change only what you need; “Put the usual values back” undoes your changes on this page.')}</div>

      <div className="card col">
        <h2>🧾 {t('Receipt (bill for the patient)')}</h2>
        <div className="grid2">
          <label className="f">{t('Paper')}
            <select className="input" value={g.receipt.style} onChange={(e) => set('receipt', { style: e.target.value as Group['receipt']['style'] })} data-testid="receipt-style">
              <option value="a4">{t('Normal sheet (A4 / Letter), receipt at the top')}</option>
              <option value="thermal">{t('Narrow roll (thermal) printer')}</option>
            </select>
          </label>
          {g.receipt.style === 'thermal'
            ? <label className="f">{t('Roll width (mm)')}<input className="input num" inputMode="numeric" value={g.receipt.thermalWidthMm} onChange={(e) => set('receipt', { thermalWidthMm: clampInt(e.target.value, 48, 110) })} data-testid="receipt-width" /></label>
            : <div />}
        </div>
        <label className="f">{t('Printer for receipts')}{printerSelect(g.receipt.printerName, (v) => set('receipt', { printerName: v }), 'receipt-printer')}</label>
        <label className="f">{t('Line at the bottom')}<input className="input" value={g.receipt.footer} onChange={(e) => set('receipt', { footer: e.target.value })} data-testid="receipt-footer" /></label>
        <label className="checkrow"><input type="checkbox" checked={g.receipt.autoPrint} onChange={(e) => set('receipt', { autoPrint: e.target.checked })} data-testid="receipt-auto" /> {t('Print the receipt by itself when a new patient is saved')}</label>
      </div>

      <div className="card col">
        <h2>🏷 {t('Sample stickers')}</h2>
        <label className="checkrow"><input type="checkbox" checked={g.labels.enabled} onChange={(e) => set('labels', { enabled: e.target.checked })} data-testid="labels-enabled" /> {t('Use sample stickers')}</label>
        {g.labels.enabled && (
          <>
            <div className="grid4">
              <label className="f">{t('Sticker width (mm)')}<input className="input num" inputMode="numeric" value={g.labels.widthMm} onChange={(e) => set('labels', { widthMm: clampInt(e.target.value, 20, 120) })} data-testid="label-width" /></label>
              <label className="f">{t('Sticker height (mm)')}<input className="input num" inputMode="numeric" value={g.labels.heightMm} onChange={(e) => set('labels', { heightMm: clampInt(e.target.value, 12, 100) })} data-testid="label-height" /></label>
              <label className="f">{t('Stickers per patient')}<input className="input num" inputMode="numeric" value={g.labels.copies} onChange={(e) => set('labels', { copies: clampInt(e.target.value, 1, 20) })} data-testid="label-copies-setting" /></label>
              <label className="f">{t('Code on the sticker')}
                <select className="input" value={g.labels.code} onChange={(e) => set('labels', { code: e.target.value as Group['labels']['code'] })} data-testid="label-code">
                  <option value="barcode">{t('Barcode (barcode scanners)')}</option><option value="qr">{t('QR code (phone camera)')}</option>
                </select>
              </label>
            </div>
            <label className="f">{t('Printer for stickers')}{printerSelect(g.labels.printerName, (v) => set('labels', { printerName: v }), 'label-printer')}</label>
            <label className="checkrow"><input type="checkbox" checked={g.labels.showAge} onChange={(e) => set('labels', { showAge: e.target.checked })} /> {t('Show age and sex')}</label>
            <label className="checkrow"><input type="checkbox" checked={g.labels.showTests} onChange={(e) => set('labels', { showTests: e.target.checked })} /> {t('Show the test codes')}</label>
            <label className="checkrow"><input type="checkbox" checked={g.labels.autoPrint} onChange={(e) => set('labels', { autoPrint: e.target.checked })} data-testid="label-auto" /> {t('Print the stickers by itself when a new patient is saved')}</label>
          </>
        )}
      </div>

      <div className="card col">
        <h2>💰 {t('Money')}</h2>
        <label className="checkrow"><input type="checkbox" checked={g.money.commission} onChange={(e) => set('money', { commission: e.target.checked })} data-testid="money-commission" /> {t('Keep doctor commission (Reports → Doctor commission)')}</label>
        {g.money.commission && (
          <label className="f">{t('Commission is worked out on')}
            <select className="input" value={g.money.commissionBasis} onChange={(e) => set('money', { commissionBasis: e.target.value as Group['money']['commissionBasis'] })} data-testid="money-basis">
              <option value="billed">{t('the amount billed (after discount)')}</option><option value="collected">{t('the money actually received')}</option>
            </select>
          </label>
        )}
        <label className="checkrow"><input type="checkbox" checked={g.money.expenses} onChange={(e) => set('money', { expenses: e.target.checked })} data-testid="money-expenses" /> {t('Keep expenses and close the cash every day (Reports → Cash & expenses)')}</label>
        {g.money.expenses && (
          <label className="f">{t('Kinds of expense (one per line)')}<textarea className="input" rows={5} value={cats} onChange={(e) => setCats(e.target.value)} data-testid="money-cats" /></label>
        )}
      </div>

      <div className="row">
        <button className="btn big" disabled={!dirty} onClick={save} data-testid="quick-save">{t('Save')}</button>
        <button className="btn ghost" onClick={reset} data-testid="quick-reset">{t('Put the usual values back')}</button>
      </div>

      <PackagesCard pin={pin} enabled={g.packages} onEnabled={(v) => set('packages', v)} />
    </div>
  )
}

/* ---------------------------------------------------------------- packages */

function PackagesCard({ pin, enabled, onEnabled }: { pin?: string; enabled: boolean; onEnabled: (v: boolean) => void }) {
  const { t, guard, toast, settings } = useApp()
  const list = useAsync(() => api.packages.listAll(), [])
  const [editing, setEditing] = useState<null | { id?: number; name: string; price: string; codes: Set<string>; active: boolean }>(null)
  return (
    <div className="card col" data-testid="packages-card">
      <div className="row">
        <h2 className="grow">📦 {t('Health packages')}</h2>
        <button className="btn ghost" onClick={() => setEditing({ name: '', price: '', codes: new Set(), active: true })} data-testid="package-new">＋ {t('New package')}</button>
      </div>
      <label className="checkrow"><input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} data-testid="packages-enabled" /> {t('Show packages on the new-patient screen (remember to press Save above)')}</label>
      {!settings.pricesReviewed && <div className="muted" style={{ fontSize: 14 }}>{t('Package prices are examples until you set the lab’s own.')}</div>}
      {list.data?.length === 0 && <div className="muted">{t('No packages yet.')}</div>}
      <table className="t" data-testid="packages-table">
        <tbody>
          {list.data?.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b> {!p.active && <span className="tag grey">{t('hidden')}</span>}<div className="muted" style={{ fontSize: 14 }}>{p.panelCodes.join(' · ')}</div></td>
              <td className="num">{money(p.price)}</td>
              <td className="right">
                <button className="btn small ghost" onClick={() => setEditing({ id: p.id, name: p.name, price: String(p.price), codes: new Set(p.panelCodes), active: p.active })}>{t('Edit')}</button>
                <button className="btn small ghost" onClick={async () => { if (await guard(api.packages.remove(p.id, pin))) list.reload() }}>{t('Delete')}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <PackageEditor value={editing} onClose={() => setEditing(null)} onSave={async (v) => {
        const r = await guard(api.packages.save({ id: v.id, name: v.name, price: Number(v.price) || 0, panelCodes: [...v.codes], active: v.active }, pin))
        if (r !== undefined) { toast(t('Saved'), 'ok'); setEditing(null); list.reload() }
      }} />}
    </div>
  )
}

function PackageEditor({ value, onClose, onSave }: { value: { id?: number; name: string; price: string; codes: Set<string>; active: boolean }; onClose: () => void; onSave: (v: typeof value) => void }) {
  const { t } = useApp()
  const master = useAsync(() => api.master.list(), [])
  const [v, setV] = useState(value)
  const panels = (master.data ?? []).filter((p) => p.active && p.bundleCodes.length === 0)
  const sum = [...v.codes].reduce((a, c) => a + (panels.find((p) => p.code === c)?.price ?? 0), 0)
  const bySection = useMemo(() => {
    const m = new Map<string, typeof panels>()
    for (const p of panels) { if (!m.has(p.section)) m.set(p.section, []); m.get(p.section)!.push(p) }
    return [...m.entries()].sort((a, b) => SECTION_ORDER.indexOf(a[0]) - SECTION_ORDER.indexOf(b[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master.data])
  const ok = v.name.trim().length > 1 && v.codes.size > 0 && Number(v.price) >= 0 && v.price !== ''
  return (
    <Modal onClose={onClose} wide>
      <h2>{v.id ? t('Edit package') : t('New package')}</h2>
      <div className="grid2">
        <label className="f">{t('Package name')}<input className="input" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="package-name" /></label>
        <label className="f">{t('Package price (₹)')}<input className="input num" inputMode="numeric" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value.replace(/\D/g, '') })} data-testid="package-price" /></label>
      </div>
      <div className="muted">{t('Tests chosen')}: {v.codes.size} · {t('if bought one by one')}: {money(sum)}{Number(v.price) > 0 && sum > 0 ? ` · ${t('package saves')} ${money(Math.max(0, sum - Number(v.price)))}` : ''}</div>
      <div className="col" style={{ maxHeight: 300, overflow: 'auto', gap: 8 }}>
        {bySection.map(([sec, ps]) => (
          <div key={sec} className="col" style={{ gap: 4 }}>
            <span className="muted" style={{ fontWeight: 700, fontSize: 13, letterSpacing: '.08em' }}>{sec}</span>
            <div className="chips">
              {ps.map((p) => (
                <button key={p.code} type="button" className={`chip${v.codes.has(p.code) ? ' on' : ''}`} aria-pressed={v.codes.has(p.code)} data-testid={`pkg-test-${p.code}`}
                  onClick={() => setV((x) => { const n = new Set(x.codes); n.has(p.code) ? n.delete(p.code) : n.add(p.code); return { ...x, codes: n } })}>
                  {p.name.replace(/ — sent out$/, '')} <small>{money(p.price)}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <label className="checkrow"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {t('Show this package on the new-patient screen')}</label>
      <div className="row"><div className="grow" /><button className="btn ghost" onClick={onClose}>{t('Cancel')}</button><button className="btn" disabled={!ok} onClick={() => onSave(v)} data-testid="package-save">{t('Save')}</button></div>
    </Modal>
  )
}
