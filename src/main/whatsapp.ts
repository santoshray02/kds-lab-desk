import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Db } from './db'
import { AppError } from './results'
import { reportLink } from './reportsvc'
import { getSettings } from './settings'

export interface WaPlan {
  reportId: number
  level: 'A' | 'B'
  phone: string // 91XXXXXXXXXX
  text: string
  appUrl: string
  webUrl: string
  target: 'web' | 'app' | 'evolution'
}

export function buildWaPlan(db: Db, reportId: number): WaPlan {
  const row = db.get<any>(
    `SELECT p.name, p.title, p.phone, v.sample_id, r.share_pin FROM reports r JOIN visits v ON v.id = r.visit_id
     JOIN patients p ON p.id = v.patient_id WHERE r.id = ?`,
    reportId
  )
  if (!row) throw new AppError('NOT_FOUND', 'Report not found')
  if (!/^\d{10}$/.test(row.phone)) throw new AppError('NO_PHONE', 'This patient has no phone number, so WhatsApp cannot be used. Print the report instead.')
  const s = getSettings(db)
  const tpl = s.language === 'hi' ? s.waMessageHi : s.waMessageEn
  const display = `${row.title ? row.title + '. ' : ''}${row.name}`
  let text = tpl.replace('{name}', display).replace('{sample}', row.sample_id)
  const link = reportLink(db, reportId)
  const level = link ? 'B' : 'A'
  if (link) {
    text += s.language === 'hi'
      ? `\nरिपोर्ट देखें / डाउनलोड करें: ${link}\nPIN: आपके फ़ोन नंबर के आख़िरी 4 अंक (${row.share_pin ?? ''})`
      : `\nView / download: ${link}\nPIN: ${row.share_pin ?? 'last 4 digits of your phone'}`
  } else {
    text += s.language === 'hi' ? '\nरिपोर्ट PDF साथ में है।' : '\nThe report PDF is attached.'
  }
  const phone = `91${row.phone}`
  const enc = encodeURIComponent(text)
  return { reportId, level, phone, text, appUrl: `whatsapp://send?phone=${phone}&text=${enc}`, webUrl: `https://web.whatsapp.com/send?phone=${phone}&text=${enc}`, target: s.waTarget === 'app' ? 'app' : s.waTarget === 'evolution' && s.evolution.url && s.evolution.instance && s.evolution.apiKey ? 'evolution' : 'web' }
}

/** Put a file on the Windows clipboard as a file (CF_HDROP) so Ctrl+V in WhatsApp attaches it. */
export function copyFileToClipboard(path: string): Promise<void> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Clipboard file copy works on Windows only'))
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$c = New-Object System.Collections.Specialized.StringCollection',
    '$c.Add($env:KDS_FILE) | Out-Null',
    '[System.Windows.Forms.Clipboard]::SetFileDropList($c)'
  ].join('; ')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { env: { ...process.env, KDS_FILE: path }, timeout: 20000 },
      (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
    )
  })
}

let fetchImpl: typeof fetch = (...a) => fetch(...a)
/** Tests swap the network here. */
export function setWaFetch(f: typeof fetch): void {
  fetchImpl = f
}

const evoBase = (url: string) => url.trim().replace(/\/+$/, '')

/**
 * Evolution API (https://github.com/EvolutionAPI/evolution-api): the lab's own gateway sends the message.
 * Level A sends the PDF as a document with the message as caption; level B sends the text with the link.
 */
export async function sendViaEvolution(db: Db, reportId: number, pdfPath: string | null): Promise<void> {
  const plan = buildWaPlan(db, reportId)
  const { url, instance, apiKey } = getSettings(db).evolution
  if (!url || !instance || !apiKey) throw new AppError('EVOLUTION', 'Evolution API is not set up (Settings → Patients and WhatsApp).')
  const headers = { 'Content-Type': 'application/json', apikey: apiKey }
  const sendMedia = plan.level === 'A' && pdfPath
  const res = await fetchImpl(`${evoBase(url)}/message/${sendMedia ? 'sendMedia' : 'sendText'}/${encodeURIComponent(instance)}`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify(
      sendMedia
        ? { number: plan.phone, mediatype: 'document', mimetype: 'application/pdf', caption: plan.text, media: readFileSync(pdfPath).toString('base64'), fileName: basename(pdfPath) }
        : { number: plan.phone, text: plan.text }
    )
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AppError('EVOLUTION', `WhatsApp gateway answered ${res.status}. ${body.slice(0, 200)}`)
  }
}

export async function testEvolution(url: string, instance: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchImpl(`${evoBase(url)}/instance/connectionState/${encodeURIComponent(instance)}`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return { ok: false, message: `The gateway answered ${res.status}. Check the address, instance name and key.` }
    const j: any = await res.json().catch(() => ({}))
    const state = j?.instance?.state ?? j?.state ?? 'unknown'
    return state === 'open' ? { ok: true, message: 'Connected: WhatsApp is linked and ready.' } : { ok: false, message: `The gateway is reachable but WhatsApp is "${state}". Scan the QR code in the Evolution manager.` }
  } catch (e) {
    return { ok: false, message: `Cannot reach the gateway: ${(e as Error).message}` }
  }
}
