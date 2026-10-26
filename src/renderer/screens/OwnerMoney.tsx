import { useEffect, useState } from 'react'
import { api, fmtDate, money, todayStr, useApp, useAsync } from '../ui'

/** Runs `fn` with the owner PIN when one is set (asking for it first); nothing happens if the PIN box is cancelled. */
function usePinned() {
  const { askPin } = useApp()
  return async <T,>(title: string, fn: (pin?: string) => Promise<T>): Promise<T | undefined> => {
    const ps = await api.settings.pinStatus()
    const pin = ps.ownerSet ? await askPin(title) : ''
    if (pin === null) return undefined
    return fn(pin || undefined)
  }
}

const monthLabel = (ym: string) => ym

/* ---------------------------------------------------------------- doctor commission */

export function Commission() {
  const { t, guard, toast, prompt, settings } = useApp()
  const pinned = usePinned()
  const [month, setMonth] = useState(todayStr().slice(0, 7))
  const r = useAsync(() => api.money.commission(month), [month])
  const pay = useAsync(() => api.money.payouts(month), [month])
  const rates = useAsync(() => api.money.rates(), [])
  const [edit, setEdit] = useState<Record<string, string>>({})
  const basis = r.data?.basis ?? settings.money.commissionBasis
  const reload = () => { r.reload(); pay.reload(); rates.reload() }

  async function saveRate(doctor: string) {
    const v = Number((edit[doctor] ?? '').replace(',', '.'))
    if (!(v >= 0 && v <= 100)) return toast(t('The rate must be between 0 and 100 per cent.'), 'bad')
    const ok = await pinned(t('PIN to change a commission rate'), (pin) => guard(api.money.setRate(doctor, v, pin)))
    if (ok) { setEdit((e) => { const n = { ...e }; delete n[doctor]; return n }); toast(t('Saved'), 'ok'); reload() }
  }
  async function payDoctor(doctor: string, balance: number) {
    const v = await prompt({ title: `${t('Pay commission')} — ${doctor}`, label: `${t('Amount (₹)')} (${t('balance')} ${Math.max(0, Math.round(balance))})`, minLength: 1 })
    const n = Number(v)
    if (!v || !(n > 0)) return
    const ok = await pinned(t('PIN to record a commission payment'), (pin) => guard(api.money.addPayout({ doctor, month, amount: n }, pin)))
    if (ok !== undefined) { toast(t('Payment saved'), 'ok'); reload() }
  }
  async function removePayout(id: number) {
    const ok = await pinned(t('PIN to remove a payment record'), (pin) => guard(api.money.deletePayout(id, pin)))
    if (ok) reload()
  }

  return (
    <div className="col" data-testid="commission">
      <div className="row wrap">
        <label className="f noprint" style={{ maxWidth: 220 }}>{t('Month')}<input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <div className="muted grow" style={{ alignSelf: 'end' }}>
          {basis === 'billed' ? t('Commission is worked out on the amount billed. Change this in Settings → Bills, stickers & money.') : t('Commission is worked out on the money actually received. Change this in Settings → Bills, stickers & money.')}
        </div>
      </div>
      <div className="statgrid">
        <div className="stat"><div className="n">{money(r.data?.totals.earned ?? 0)}</div><div className="muted">{t('Commission earned')}</div></div>
        <div className="stat"><div className="n">{money(r.data?.totals.paid ?? 0)}</div><div className="muted">{t('Paid to doctors')}</div></div>
        <div className="stat"><div className="n" style={{ color: (r.data?.totals.balance ?? 0) > 0 ? 'var(--eosin)' : undefined }} data-testid="commission-balance">{money(r.data?.totals.balance ?? 0)}</div><div className="muted">{t('Still to pay this month')}</div></div>
        <div className="stat"><div className="n">{money(r.data?.totals.balanceAll ?? 0)}</div><div className="muted">{t('Still to pay, all months')}</div></div>
      </div>
      <div className="card">
        <h2>{t('Commission by doctor')} — {monthLabel(month)}</h2>
        {r.data?.rows.length === 0 && <div className="muted">{t('No referred patients this month. “Self” patients never earn commission.')}</div>}
        <table className="t" data-testid="commission-table">
          <thead><tr><th>{t('Doctor')}</th><th className="num">{t('Rate %')}</th><th className="num">{t('Visits')}</th><th className="num">{t('Billed')}</th>{basis === 'collected' && <th className="num">{t('Money received')}</th>}<th className="num">{t('Earned')}</th><th className="num">{t('Paid')}</th><th className="num">{t('Balance')}</th><th className="num">{t('All months')}</th><th className="noprint" /></tr></thead>
          <tbody>
            {r.data?.rows.map((d) => (
              <tr key={d.doctor}>
                <td><b>{d.doctor}</b></td><td className="num">{d.pct}</td><td className="num">{d.visits}</td><td className="num">{money(d.billed)}</td>
                {basis === 'collected' && <td className="num">{money(d.collected)}</td>}
                <td className="num">{money(d.earned)}</td><td className="num">{money(d.paid)}</td>
                <td className="num" style={{ color: d.balance > 0 ? 'var(--eosin)' : undefined }}>{money(d.balance)}</td><td className="num">{money(d.balanceAll)}</td>
                <td className="right noprint"><button className="btn small" onClick={() => payDoctor(d.doctor, d.balance)} data-testid="pay-doctor">{t('Pay')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!pay.data?.length && (
        <div className="card">
          <h2>{t('Payments to doctors')} — {monthLabel(month)}</h2>
          <table className="t">
            <tbody>
              {pay.data.map((p) => (
                <tr key={p.id}><td>{fmtDate(p.paidAt.slice(0, 10))}</td><td>{p.doctor}</td><td className="num">{money(p.amount)}</td><td className="right noprint"><button className="btn small ghost" onClick={() => removePayout(p.id)}>{t('Remove')}</button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card noprint">
        <h2>{t('Doctor rates')}</h2>
        <div className="muted" style={{ marginBottom: 8 }}>{t('A new rate applies to visits registered from now on. Visits registered earlier keep the rate they had; visits made before any rate was set follow the doctor’s rate.')}</div>
        {rates.data?.length === 0 && <div className="muted">{t('No doctors yet. They appear here after their first patient.')}</div>}
        <table className="t" data-testid="rates-table">
          <tbody>
            {rates.data?.map((d) => (
              <tr key={d.doctor}>
                <td><b>{d.doctor}</b></td>
                <td style={{ width: 150 }}><input className="input num" inputMode="decimal" aria-label={`${d.doctor} ${t('Rate %')}`} value={edit[d.doctor] ?? String(d.pct)} onChange={(e) => setEdit((x) => ({ ...x, [d.doctor]: e.target.value.replace(/[^\d.,]/g, '') }))} data-testid="rate-input" /></td>
                <td>%</td>
                <td className="right">{edit[d.doctor] !== undefined && edit[d.doctor] !== String(d.pct) && <button className="btn small" onClick={() => saveRate(d.doctor)} data-testid="rate-save">{t('Save')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- cash and expenses */

export function CashBook() {
  const { t, guard, toast, settings } = useApp()
  const pinned = usePinned()
  const [date, setDate] = useState(todayStr())
  const d = useAsync(() => api.money.cashDay(date), [date])
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const cats = settings.money.expenseCategories.length ? settings.money.expenseCategories : ['Other']
  const [cat, setCat] = useState(cats[0])
  const [amt, setAmt] = useState('')
  const [what, setWhat] = useState('')
  useEffect(() => { setCounted(d.data?.closing ? String(d.data.closing.counted) : ''); setNote(d.data?.closing?.note ?? '') }, [d.data?.closing?.closedAt, date])

  async function addExp() {
    const n = Number(amt)
    if (!(n > 0)) return
    const r = await guard(api.money.addExpense({ date, category: cat, amount: n, note: what }))
    if (r !== undefined) { setAmt(''); setWhat(''); toast(t('Expense saved'), 'ok'); d.reload() }
  }
  async function delExp(id: number) {
    const ok = await pinned(t('PIN to delete an expense'), (pin) => guard(api.money.deleteExpense(id, pin)))
    if (ok) d.reload()
  }
  async function close() {
    const n = Number(counted)
    if (counted === '' || !(n >= 0)) return
    const r = await guard(api.money.closeDay(date, n, note))
    if (r) { toast(t('Day closed'), 'ok'); d.reload() }
  }
  const x = d.data
  const diff = x?.closing ? x.closing.difference : counted === '' || !x ? null : Number(counted) - x.expected
  return (
    <div className="col" data-testid="cashbook">
      <label className="f noprint" style={{ maxWidth: 220 }}>{t('Date')}<input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      <div className="statgrid">
        <div className="stat"><div className="n">{money(x?.opening ?? 0)}</div><div className="muted">{t('Cash at the start of the day')}</div></div>
        <div className="stat"><div className="n">{money(x?.cash ?? 0)}</div><div className="muted">{t('Cash received')}</div></div>
        <div className="stat"><div className="n">{money(x?.expensesTotal ?? 0)}</div><div className="muted">{t('Spent')}</div></div>
        <div className="stat"><div className="n" data-testid="expected-cash">{money(x?.expected ?? 0)}</div><div className="muted">{t('Cash that should be in the drawer')}</div></div>
      </div>
      {!!x && x.upi + x.card + x.other > 0 && (
        <div className="muted">{t('Also received, not in the drawer')}: {x.upi > 0 && `UPI ${money(x.upi)} `}{x.card > 0 && `${t('Card')} ${money(x.card)} `}{x.other > 0 && `${t('Other')} ${money(x.other)}`}</div>
      )}

      <div className="card col noprint">
        <h2>{t('Close the day')}</h2>
        <div className="grid2">
          <label className="f">{t('Cash counted in the drawer (₹)')}<input className="input num" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))} data-testid="counted" /></label>
          <label className="f">{t('Note (optional)')}<input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div className="row">
          <button className="btn" disabled={counted === ''} onClick={close} data-testid="close-day">{x?.closing ? t('Change the count') : t('Close the day')}</button>
          {diff !== null && (
            <b data-testid="cash-diff" style={{ color: Math.abs(diff) < 0.005 ? 'var(--ok, #1d6b35)' : 'var(--eosin)' }}>
              {Math.abs(diff) < 0.005 ? `✔ ${t('The cash matches.')}` : diff < 0 ? `${t('Short by')} ${money(-diff)}` : `${t('Extra')} ${money(diff)}`}
            </b>
          )}
          {x?.closing && <span className="muted">{t('Closed')} {new Date(x.closing.closedAt).toLocaleString('en-IN')}</span>}
        </div>
      </div>

      <div className="card col">
        <h2>{t('Expenses')}</h2>
        <div className="row wrap noprint" onKeyDown={(e) => e.key === 'Enter' && addExp()}>
          <label className="f" style={{ width: 200 }}>{t('What for')}
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} data-testid="exp-cat">{cats.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="f" style={{ width: 140 }}>{t('Amount (₹)')}<input className="input num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} data-testid="exp-amount" /></label>
          <label className="f grow">{t('Note (optional)')}<input className="input" value={what} onChange={(e) => setWhat(e.target.value)} /></label>
          <button className="btn" style={{ alignSelf: 'end' }} onClick={addExp} disabled={!(Number(amt) > 0)} data-testid="exp-add">＋ {t('Add')}</button>
        </div>
        {x?.expenses.length === 0 && <div className="muted">{t('No expenses on this day.')}</div>}
        <table className="t" data-testid="expense-table">
          <tbody>
            {x?.expenses.map((e) => (
              <tr key={e.id}><td>{e.category}</td><td className="muted">{e.note}</td><td className="num">{money(e.amount)}</td><td className="right noprint"><button className="btn small ghost" onClick={() => delExp(e.id)}>{t('Delete')}</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {x && (
        <div className="card">
          <b>{t('This month')}</b>: {t('received')} {money(x.month.received)} · {t('spent')} {money(x.month.expenses)} · <b data-testid="month-net">{t('left')} {money(x.month.net)}</b>
          <div className="muted" style={{ fontSize: 14 }}>{t('“Received” counts everything paid by patients (cash, UPI, card); it does not include salary or other costs not entered above.')}</div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- export */

const SHEETS: [string, string][] = [
  ['visits', 'Visits and bills'], ['payments', 'Money received'], ['patients', 'Patients'], ['expenses', 'Expenses'], ['commission', 'Doctor commission']
]

export function ExportTab() {
  const { t, guard, toast } = useApp()
  const pinned = usePinned()
  const [from, setFrom] = useState(`${todayStr().slice(0, 7)}-01`)
  const [to, setTo] = useState(todayStr())
  const [pick, setPick] = useState<Set<string>>(new Set(SHEETS.map(([k]) => k)))
  async function save() {
    const f = await pinned(t('PIN to export the records'), (pin) => guard(api.export.xlsx({ from, to, sheets: [...pick] as never }, pin)))
    if (f) toast(`${t('Saved')}: ${f}`, 'ok')
  }
  return (
    <div className="col" data-testid="export">
      <div className="card col">
        <h2>{t('Save the records as an Excel file')}</h2>
        <div className="muted">{t('For the accountant or your own sums. The file opens in Excel, LibreOffice and Google Sheets. It contains patient names and phone numbers, so keep it safe.')}</div>
        <div className="grid2">
          <label className="f">{t('From date')}<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="export-from" /></label>
          <label className="f">{t('To date')}<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="export-to" /></label>
        </div>
        <div className="col" style={{ gap: 4 }}>
          {SHEETS.map(([k, label]) => (
            <label key={k} className="checkrow"><input type="checkbox" checked={pick.has(k)} onChange={(e) => setPick((s) => { const n = new Set(s); e.target.checked ? n.add(k) : n.delete(k); return n })} data-testid={`export-${k}`} /> {t(label)}</label>
          ))}
        </div>
        <div><button className="btn big" disabled={!pick.size || !from || !to || from > to} onClick={save} data-testid="export-save">💾 {t('Save Excel file…')}</button></div>
      </div>
    </div>
  )
}
