import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyFileToClipboard } from '../src/main/whatsapp'

// Windows only: puts a file on the clipboard (CF_HDROP) the way WhatsApp's Ctrl+V expects, then reads it back.
describe.skipIf(process.platform !== 'win32')('WhatsApp clipboard helper', () => {
  it('copies a PDF file to the Windows clipboard as a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kds-clip-'))
    const file = join(dir, 'sample report.pdf')
    writeFileSync(file, '%PDF-1.4 test')
    await copyFileToClipboard(file)
    const out = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', 'Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }'], { encoding: 'utf8' })
    expect(out.trim().toLowerCase()).toBe(file.toLowerCase())
  }, 30000)
})
