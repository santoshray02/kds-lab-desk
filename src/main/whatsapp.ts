import { execFile } from 'node:child_process'
import type { Db } from './db'
import { AppError } from './results'
import { reportLink } from './reportsvc'
import { getSettings } from './settings'

export interface WaPlan {
  level: 'A' | 'B'
  phone: string // 91XXXXXXXXXX
  text: string
  appUrl: string
  webUrl: string
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
  return { level, phone, text, appUrl: `whatsapp://send?phone=${phone}&text=${enc}`, webUrl: `https://wa.me/${phone}?text=${enc}` }
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
