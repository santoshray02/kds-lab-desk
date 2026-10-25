import { useState } from 'react'
import { api, fmtDate, useApp, useAsync } from '../ui'

/** Free up to a monthly number of approved reports; more needs a licence code from K.D.S. Pathology. */
export function Licence({ pin }: { pin?: string }) {
  const { t, guard, toast, confirm } = useApp()
  const st = useAsync(() => api.license.status(), [])
  const [code, setCode] = useState('')
  const s = st.data
  if (!s) return <div className="card">{t('Loading…')}</div>

  const pct = s.limit ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0
  const planName = s.plan === 'unlimited' ? t('Unlimited licence') : s.plan === 'monthly' ? t('Licensed') : t('Free plan')

  async function activate() {
    const r = await guard(api.license.activate(code, pin))
    if (r) { toast(t('Licence saved. Thank you!'), 'ok'); setCode(''); st.reload() }
  }
  async function remove() {
    if (await confirm({ title: t('Remove this licence?'), body: t('The free plan will apply again.'), ok: t('Remove'), danger: true })) {
      if (await guard(api.license.remove(pin))) st.reload()
    }
  }

  return (
    <div className="col" data-testid="licence">
      <div className="card col">
        <h2>{t('Your plan')}</h2>
        <div style={{ fontSize: 24, fontWeight: 700 }} data-testid="plan-name">{planName}{s.licensee ? ` — ${s.licensee}` : ''}</div>
        {s.plan === 'unlimited' && <div className="ok-text">✓ {t('No limit on reports.')}</div>}
        {s.limit != null && (
          <>
            <div>
              <b data-testid="used">{s.used}</b> {t('of')} <b>{s.limit}</b> {s.plan === 'free' ? t('free reports used this month') : t('reports used this month')}
              <span className="muted"> · {t('starts again on')} {fmtDate(s.resetsOn)}</span>
            </div>
            <div className="split" style={{ height: 16 }} title={`${pct}%`}>
              <div style={{ width: `${pct}%`, background: s.blocked ? 'var(--eosin)' : s.nearLimit ? '#b26a00' : '#127c96' }} />
              <div style={{ width: `${100 - pct}%`, background: '#eceef6' }} />
            </div>
          </>
        )}
        {s.expiresOn && <div className="muted">{s.expired ? t('Licence ended on') : t('Licence valid until')} {fmtDate(s.expiresOn)}</div>}
        {s.message && <div className={`alert ${s.blocked ? 'bad' : 'info'}`}><b>{s.blocked ? '⛔' : 'ℹ'}</b><span>{s.message}</span></div>}
        <div className="muted">{t('Reports that are already approved can always be opened, printed, searched and sent. Only approving new reports pauses at the limit.')}</div>
      </div>

      <div className="card col">
        <h2>{t('Enter a licence code')}</h2>
        <div className="muted">{t('K.D.S. Pathology sends you a code by WhatsApp or email. Paste it here.')}</div>
        <textarea className="input mono" rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="KDS1.…" data-testid="licence-code" />
        <div className="row">
          <button className="btn" disabled={code.trim().length < 20} onClick={activate} data-testid="licence-activate">{t('Save licence')}</button>
          {s.licenseId && <button className="btn ghost" onClick={remove}>{t('Remove licence')}</button>}
        </div>
        <div className="muted">{t('To get a licence, contact K.D.S. Pathology:')} <b>{s.contact}</b></div>
      </div>
    </div>
  )
}
