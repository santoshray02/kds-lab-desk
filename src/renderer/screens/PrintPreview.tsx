import { useState } from 'react'
import { Modal, useApp, useAsync } from '../ui'

const PX_PER_MM = 96 / 25.4

/**
 * Shows exactly what will be printed, at the page size the printer will use, and prints from here.
 * `zoom` only makes small pages (stickers) bigger and big pages (A4) fit; it does not change what is printed.
 */
export function PrintPreview({ title, load, widthMm, heightMm, zoom = 1, note, onPrint, onClose }: {
  title: string
  load: () => Promise<string>
  widthMm: number
  /** page height; leave out for a page as tall as its content */
  heightMm?: number
  zoom?: number
  note?: string
  onPrint: () => Promise<unknown>
  onClose: () => void
}) {
  const { t, toast } = useApp()
  const page = useAsync(load, [])
  const [busy, setBusy] = useState(false)
  async function print() {
    setBusy(true)
    try {
      await onPrint()
      toast(t('Sent to the printer'), 'ok')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  const w = Math.round(widthMm * PX_PER_MM)
  const h = heightMm ? Math.round(heightMm * PX_PER_MM) : 700
  return (
    <Modal onClose={onClose} wide>
      <h2>{title}</h2>
      {note && <div className="muted" style={{ fontSize: 14 }}>{note}</div>}
      <div style={{ background: '#e5e7eb', borderRadius: 8, padding: 12, maxHeight: '58vh', overflow: 'auto', textAlign: 'center' }} data-testid="print-preview">
        {page.data ? (
          <iframe
            title={title}
            srcDoc={page.data}
            sandbox=""
            style={{ width: w, height: h, border: 0, background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,.25)', zoom, display: 'inline-block' }}
          />
        ) : <div className="muted" style={{ padding: 40 }}>{page.error || t('Loading…')}</div>}
      </div>
      <div className="row">
        <button className="btn ghost" onClick={onClose}>{t('Close')}</button>
        <div className="grow" />
        <button className="btn big" disabled={!page.data || busy} onClick={print} data-testid="preview-print">🖨 {busy ? t('Sending…') : t('Print')}</button>
      </div>
    </Modal>
  )
}
