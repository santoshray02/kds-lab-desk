import { useState } from 'react'
import { api, fmtDate, money, useApp, useAsync } from '../ui'

type Method = 'cash' | 'upi' | 'card' | 'other'
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other' }

/** What the patient was charged and paid, with the receipt, the sample stickers, and "receive payment". */
export function BillCard({ visitId, testIds }: { visitId: number; testIds?: number }) {
  const { t, guard, toast, settings } = useApp()
  const g = useAsync(() => api.visits.get(visitId), [visitId, testIds])
  const [busy, setBusy] = useState('')
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [copies, setCopies] = useState(String(settings.labels.copies))
  if (!g.data) return null
  const v = g.data.visit
  const due = Math.max(0, v.total - g.data.paid)

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key)
    const r = await guard(fn())
    setBusy('')
    if (r !== undefined && done) toast(done, 'ok')
  }
  async function receive() {
    const n = Math.min(Number(amount) || 0, due)
    if (n <= 0) return
    const r = await guard(api.visits.addPayment(visitId, n, 'Received later', method))
    if (r !== undefined) { toast(t('Payment saved'), 'ok'); setPaying(false); setAmount(''); g.reload() }
  }

  return (
    <div className="card col" data-testid="bill-card">
      <div className="row wrap">
        <h2 className="grow">🧾 {t('Bill')}{v.package_name ? <span className="tag grey" style={{ marginLeft: 8 }}>📦 {v.package_name}</span> : null}</h2>
        <div className="row wrap noprint">
          <button className="btn ghost" disabled={!!busy} onClick={() => run('rc', () => api.bill.printReceipt(visitId), t('Receipt sent to the printer'))} data-testid="print-receipt">🖨 {t('Print receipt')}</button>
          <button className="btn ghost" disabled={!!busy} onClick={() => run('pdf', () => api.bill.openReceiptPdf(visitId))} data-testid="receipt-pdf">{t('Receipt as PDF')}</button>
          {settings.labels.enabled && (
            <span className="row" style={{ gap: 4 }}>
              <button className="btn ghost" disabled={!!busy} onClick={() => run('lb', () => api.bill.printLabels(visitId, Math.max(1, Math.min(20, Number(copies) || 1))), t('Stickers sent to the printer'))} data-testid="print-labels">🏷 {t('Print stickers')}</button>
              <input className="input num" style={{ width: 56, padding: '6px 8px' }} inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label={t('Number of stickers')} data-testid="label-copies" />
            </span>
          )}
        </div>
      </div>
      <div className="statgrid">
        <div className="stat"><div className="n">{money(v.total)}</div><div className="muted">{t('Bill')}{v.discount > 0 ? ` (${t('discount')} ${money(v.discount)})` : ''}</div></div>
        <div className="stat"><div className="n">{money(g.data.paid)}</div><div className="muted">{t('Paid')}</div></div>
        <div className="stat"><div className="n" style={{ color: due > 0 ? 'var(--eosin)' : undefined }} data-testid="bill-due">{money(due)}</div><div className="muted">{t('Due')}</div></div>
      </div>
      {g.data.payments.length > 0 && (
        <div className="muted" style={{ fontSize: 14 }}>
          {g.data.payments.map((p: { id: number; paid_at: string; amount: number; method: string }) => (
            <span key={p.id} style={{ marginRight: 14 }}>{fmtDate(p.paid_at.slice(0, 10))} · {t(METHOD_LABEL[p.method] ?? 'Cash')} · {money(p.amount)}</span>
          ))}
        </div>
      )}
      {due > 0 && !paying && <div className="noprint"><button className="btn" onClick={() => { setAmount(String(Math.round(due))); setPaying(true) }} data-testid="receive-open">＋ {t('Receive payment')}</button></div>}
      {paying && (
        <div className="row wrap noprint" data-testid="receive-form" onKeyDown={(e) => e.key === 'Enter' && receive()}>
          <label className="f" style={{ width: 160 }}>{t('Amount (₹)')}<input className="input num" autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} data-testid="receive-amount" /></label>
          <label className="f" style={{ width: 150 }}>{t('Paid by')}
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)} data-testid="receive-method">
              <option value="cash">{t('Cash')}</option><option value="upi">UPI</option><option value="card">{t('Card')}</option><option value="other">{t('Other')}</option>
            </select>
          </label>
          <button className="btn" style={{ alignSelf: 'end' }} onClick={receive} data-testid="receive-save">{t('Save')}</button>
          <button className="btn ghost" style={{ alignSelf: 'end' }} onClick={() => setPaying(false)}>{t('Cancel')}</button>
        </div>
      )}
    </div>
  )
}
