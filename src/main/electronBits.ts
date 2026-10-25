import { BrowserWindow } from 'electron'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function withHtml<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'kds-print-'))
  const file = join(dir, 'report.html')
  writeFileSync(file, html, 'utf8')
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, offscreen: false } })
  try {
    await win.loadFile(file)
    return await fn(win)
  } finally {
    win.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Render the report HTML to a PDF. The page size comes from the template's @page rule. */
export function htmlToPdf(html: string, paper: 'A4' | 'Letter'): Promise<Buffer> {
  return withHtml(html, (win) =>
    win.webContents.printToPDF({ pageSize: paper, printBackground: true, preferCSSPageSize: true })
  )
}

export function printHtml(html: string, opts: { silent: boolean; printerName: string; paper: 'A4' | 'Letter' }): Promise<void> {
  return withHtml(html, (win) =>
    new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: opts.silent,
          printBackground: true,
          deviceName: opts.printerName || undefined,
          pageSize: opts.paper,
          margins: { marginType: 'none' }
        },
        (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(`Printing failed: ${reason}`)))
      )
    })
  )
}

export async function listPrinters(win: BrowserWindow): Promise<string[]> {
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((p) => p.name)
}
