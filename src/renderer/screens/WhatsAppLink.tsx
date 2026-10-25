import { useEffect } from 'react'
import type { Settings } from '../../shared/settings'
import { api, useApp, useAsync } from '../ui'

/** Link the lab's WhatsApp by scanning a QR code, like WhatsApp Web. No addresses, no keys. */
export function WhatsAppLink({ s, set, setS, pin }: {
  s: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  setS: (f: (x: Settings) => Settings) => void
  pin?: string
}) {
  const { t, guard, toast, confirm } = useApp()
  const st = useAsync(() => api.whatsapp.linkStatus(), [])
  useEffect(() => {
    const id = setInterval(() => st.reload(), 2000)
    return () => clearInterval(id)
  }, [])
  const state = st.data?.state ?? 'off'

  async function link() {
    if (await guard(api.whatsapp.link(pin))) st.reload()
  }
  async function unlink() {
    const ok = await confirm({ title: t('Unlink WhatsApp?'), body: t('Reports will no longer be sent from this computer. You can link again any time.'), ok: t('Unlink'), danger: true })
    if (ok && (await guard(api.whatsapp.unlink(pin)))) { toast(t('WhatsApp unlinked'), 'ok'); st.reload() }
  }

  return (
    <div className="col" data-testid="wa-link">
      <h3 style={{ margin: '4px 0 0' }}>{t('Send reports on WhatsApp')}</h3>

      {state === 'off' && (
        <>
          <div className="muted">{t('Link the lab’s WhatsApp once, like WhatsApp Web. After that, reports go to the patient’s WhatsApp with the PDF attached, with no copy and paste.')}</div>
          <div><button className="btn" onClick={link} data-testid="wa-link-btn">📱 {t('Link WhatsApp')}</button></div>
        </>
      )}

      {state === 'starting' && <div className="muted">{t('Getting ready… please wait a few seconds.')}</div>}

      {state === 'waiting_qr' && (
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div style={{ background: '#fff', padding: 8, borderRadius: 10, border: '1px solid var(--line)', width: 300 }} data-testid="wa-qr" dangerouslySetInnerHTML={{ __html: st.data!.qrSvg }} />
          <ol className="grow" style={{ fontSize: 18, lineHeight: 1.7, margin: 0, paddingLeft: 22 }}>
            <li>{t('Open WhatsApp on the lab phone.')}</li>
            <li>{t('Tap the three dots (⋮), then “Linked devices”.')}</li>
            <li>{t('Tap “Link a device” and point the phone at this code.')}</li>
            <li className="muted">{t('The code changes every minute. This page updates by itself.')}</li>
          </ol>
        </div>
      )}

      {state === 'reconnecting' && <div className="muted">⚠ {t('Connecting to WhatsApp again… check that the internet is on.')}</div>}

      {(state === 'linked' || state === 'reconnecting') && (
        <>
          {state === 'linked' && <div className="ok-text" style={{ fontSize: 18 }} data-testid="wa-linked">✓ {t('WhatsApp is linked')}{st.data?.phone ? ` (+${st.data.phone})` : ''}. {t('The green “Send on WhatsApp” button now sends the PDF by itself.')}</div>}
          <label className="checkrow"><input type="checkbox" checked={s.waAutoSend} onChange={(e) => set('waAutoSend', e.target.checked)} data-testid="wa-auto" /> {t('Send the report on WhatsApp by itself as soon as it is approved')}</label>
          <div><button className="btn ghost" onClick={unlink}>{t('Unlink WhatsApp')}</button></div>
        </>
      )}

      <details>
        <summary className="muted" style={{ cursor: 'pointer' }}>{t('Advanced (for the computer helper)')}</summary>
        <div className="col" style={{ marginTop: 8 }}>
          <label className="f" style={{ maxWidth: 420 }}>{t('If WhatsApp is not linked, open it in')}
            <select className="input" value={s.waTarget === 'app' ? 'app' : 'web'} onChange={(e) => set('waTarget', e.target.value as 'web' | 'app')} data-testid="wa-target">
              <option value="web">{t('Browser (WhatsApp Web)')}</option>
              <option value="app">{t('WhatsApp Desktop app')}</option>
            </select>
          </label>
          <label className="checkrow"><input type="checkbox" checked={s.waTarget === 'evolution'} onChange={(e) => set('waTarget', e.target.checked ? 'evolution' : 'web')} /> {t('Use a separate WhatsApp sending program on another computer')}</label>
          {s.waTarget === 'evolution' && (
            <div className="grid4">
              <label className="f">{t('Gateway address')}<input className="input" placeholder="http://localhost:8080" value={s.evolution.url} onChange={(e) => setS((x) => ({ ...x, evolution: { ...x.evolution, url: e.target.value } }))} /></label>
              <label className="f">{t('Instance name')}<input className="input" value={s.evolution.instance} onChange={(e) => setS((x) => ({ ...x, evolution: { ...x.evolution, instance: e.target.value } }))} /></label>
              <label className="f">{t('API key')}<input className="input" type="password" value={s.evolution.apiKey} onChange={(e) => setS((x) => ({ ...x, evolution: { ...x.evolution, apiKey: e.target.value } }))} /></label>
              <div style={{ alignSelf: 'end' }}><button className="btn ghost" onClick={async () => { const r = await guard(api.whatsapp.testEvolution(s.evolution.url, s.evolution.instance, s.evolution.apiKey)); if (r) toast(t(r.message), r.ok ? 'ok' : '') }}>{t('Test the gateway')}</button></div>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
