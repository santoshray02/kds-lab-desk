import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { createWhatsApp, type WhatsAppLink } from '../../gateway/wa.mjs'
import { makeLimiter } from '../../gateway/server.mjs'
import { audit, type Db } from './db'
import { AppError } from './results'
import { reportLink } from './reportsvc'
import { getSettings, setSettings } from './settings'

export interface WaPlan {
  reportId: number
  level: 'A' | 'B'
  phone: string // 91XXXXXXXXXX
  text: string
  appUrl: string
  webUrl: string
  target: 'web' | 'app' | 'evolution' | 'builtin'
}

export function buildWaPlan(db: Db, reportId: number): WaPlan {
  const row = db.get<any>(
    `SELECT p.name, p.title, p.phone, v.sample_id, r.share_pin, r.version FROM reports r JOIN visits v ON v.id = r.visit_id
     JOIN patients p ON p.id = v.patient_id WHERE r.id = ?`,
    reportId
  )
  if (!row) throw new AppError('NOT_FOUND', 'Report not found')
  if (!/^\d{10}$/.test(row.phone)) throw new AppError('NO_PHONE', 'This patient has no phone number, so WhatsApp cannot be used. Print the report instead.')
  const s = getSettings(db)
  const tpl = s.language === 'hi' ? s.waMessageHi : s.waMessageEn
  const display = `${row.title ? row.title + '. ' : ''}${row.name}`
  let text = tpl.replace('{name}', display).replace('{sample}', row.sample_id)
  if (row.version > 1) text += '\n' + (s.language === 'hi' ? 'यह सुधारी हुई रिपोर्ट है, पिछली रिपोर्ट की जगह यही मान्य है।' : 'This is a corrected report. It replaces the earlier one.')
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
  return { reportId, level, phone, text, appUrl: `whatsapp://send?phone=${phone}&text=${enc}`, webUrl: `https://web.whatsapp.com/send?phone=${phone}&text=${enc}`, target: s.waBuiltin ? 'builtin' : s.waTarget === 'app' ? 'app' : s.waTarget === 'evolution' && s.evolution.url && s.evolution.instance && s.evolution.apiKey ? 'evolution' : 'web' }
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

export interface AutoSendStatus {
  status: 'none' | 'sent' | 'failed'
  at: string
  message: string
}

/** What happened the last time the report was sent automatically (from the audit log). */
export function autoSendStatus(db: Db, reportId: number): AutoSendStatus {
  const r = db.get<any>(
    "SELECT action, at, detail FROM audit_log WHERE entity = 'reports' AND entity_id = ? AND action IN ('whatsapp.auto', 'whatsapp.auto_failed') ORDER BY id DESC LIMIT 1",
    reportId
  )
  if (!r) return { status: 'none', at: '', message: '' }
  return { status: r.action === 'whatsapp.auto' ? 'sent' : 'failed', at: r.at, message: r.detail ?? '' }
}

/**
 * Called right after a report is approved. Sends it by itself when the owner turned that on and the automatic
 * gateway is set up. It never throws and never blocks approval: the outcome is written to the audit log and shown on the report.
 */
export function autoSendIfEnabled(db: Db, reportId: number, pdfPath: string | null): Promise<'off' | 'sent' | 'failed'> {
  const s = getSettings(db)
  const external = s.waTarget === 'evolution' && !!s.evolution.url && !!s.evolution.instance && !!s.evolution.apiKey
  if (!s.waAutoSend || !(s.waBuiltin || external)) return Promise.resolve('off')
  if (autoSendStatus(db, reportId).status === 'sent') return Promise.resolve('sent') // never send the same report twice by itself
  let plan: WaPlan
  try {
    plan = buildWaPlan(db, reportId)
  } catch (e) {
    return Promise.resolve('off') // no phone number: nothing to send
    void e
  }
  return sendAutomatically(db, reportId, pdfPath)
    .then(() => {
      audit(db, 'whatsapp.auto', 'reports', reportId, `${plan.level} to ${plan.phone}`)
      return 'sent' as const
    })
    .catch((e: Error) => {
      audit(db, 'whatsapp.auto_failed', 'reports', reportId, e.message.slice(0, 300))
      return 'failed' as const
    })
}

// ---- WhatsApp linked inside this program (no server, no addresses: the owner scans a QR once) ----

let link: WhatsAppLink | null = null
let authDirPath = ''
const limiter = makeLimiter({ minGapMs: 3000, jitterMs: 2000, perHour: 60 })

/** Tests put a fake WhatsApp here. */
export function setBuiltinAdapter(a: WhatsAppLink | null): void {
  link = a
}

export function initBuiltin(dataDir: string): void {
  authDirPath = join(dataDir, 'whatsapp-auth') // a login: deliberately not part of backups
}

function builtin(): WhatsAppLink {
  if (!link) link = createWhatsApp({ authDir: authDirPath || './whatsapp-auth' })
  return link
}

export interface BuiltinStatus {
  state: 'off' | 'starting' | 'waiting_qr' | 'linked' | 'reconnecting'
  qrSvg: string
  phone: string
}

export async function builtinStatus(db: Db): Promise<BuiltinStatus> {
  if (!getSettings(db).waBuiltin || !link) return { state: 'off', qrSvg: '', phone: '' }
  const st = link.state()
  const qr = link.qr()
  if (st === 'open') return { state: 'linked', qrSvg: '', phone: link.phone() }
  if (qr) return { state: 'waiting_qr', qrSvg: await QRCode.toString(qr, { type: 'svg', margin: 1, width: 280 }), phone: '' }
  return { state: st === 'close' ? 'reconnecting' : 'starting', qrSvg: '', phone: '' }
}

/** Switch it on and start connecting; the QR to scan then shows in Settings. */
export async function builtinLink(db: Db): Promise<void> {
  setSettings(db, { waBuiltin: true })
  await builtin().start()
}

/** Start again after the program restarts (only if it was linked before). */
export function builtinResume(db: Db): void {
  if (getSettings(db).waBuiltin) builtin().start().catch(() => undefined)
}

export async function builtinUnlink(db: Db): Promise<void> {
  if (link) await link.logout().catch(() => undefined)
  await link?.stop().catch(() => undefined)
  link = null
  setSettings(db, { waBuiltin: false, waAutoSend: false })
}

export async function builtinStop(): Promise<void> {
  await link?.stop().catch(() => undefined)
}

const noWa = () => new AppError('WA_OFFLINE', 'WhatsApp is not connected right now. Check the internet, or link WhatsApp again in Settings.')

export async function sendViaBuiltin(db: Db, reportId: number, pdfPath: string | null): Promise<void> {
  const plan = buildWaPlan(db, reportId)
  if (!link || link.state() !== 'open') throw noWa()
  const sendDoc = plan.level === 'A' && pdfPath
  try {
    await limiter(() =>
      sendDoc
        ? link!.sendDocument(plan.phone, { buffer: readFileSync(pdfPath), mimetype: 'application/pdf', fileName: basename(pdfPath), caption: plan.text })
        : link!.sendText(plan.phone, plan.text)
    )
  } catch (e) {
    if ((e as { code?: string }).code === 'NO_WHATSAPP') throw new AppError('NO_WHATSAPP', 'This phone number is not on WhatsApp. Print the report instead.')
    throw e instanceof AppError ? e : new AppError('WA_FAILED', 'WhatsApp could not send this message. Try again in a minute.')
  }
}

/** Send with whichever automatic method is set up (linked WhatsApp, or the advanced external gateway). */
export function sendAutomatically(db: Db, reportId: number, pdfPath: string | null): Promise<void> {
  return buildWaPlan(db, reportId).target === 'builtin' ? sendViaBuiltin(db, reportId, pdfPath) : sendViaEvolution(db, reportId, pdfPath)
}
