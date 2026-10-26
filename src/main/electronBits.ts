import { BrowserWindow } from 'electron'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A standard sheet, or a custom size in millimetres (receipt roll, sticker). `heightMm: 'auto'` fits the page to its content. */
export type PaperSize = 'A4' | 'Letter' | { widthMm: number; heightMm: number | 'auto' }

async function withHtml<T>(html: string, fn: (win: BrowserWindow) => Promise<T>, measure = false): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'kds-print-'))
  const file = join(dir, 'report.html')
  writeFileSync(file, html, 'utf8')
  // scripts are only switched on to measure our own generated page (everything typed into it is escaped)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: measure, offscreen: false } })
  try {
    await win.loadFile(file)
    return await fn(win)
  } finally {
    win.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
}

const needsMeasure = (p: PaperSize) => typeof p === 'object' && p.heightMm === 'auto'

async function heightMm(win: BrowserWindow, p: PaperSize): Promise<number> {
  if (typeof p !== 'object') return 0
  if (p.heightMm !== 'auto') return p.heightMm
  const px = Number(await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)'))
  return Math.max(40, Math.ceil((px * 25.4) / 96) + 8)
}

/** Render the report HTML to a PDF. The page size comes from the template's @page rule unless a custom size is given. */
export function htmlToPdf(html: string, paper: PaperSize): Promise<Buffer> {
  return withHtml(html, async (win) => {
    if (typeof paper !== 'object') return win.webContents.printToPDF({ pageSize: paper, printBackground: true, preferCSSPageSize: true })
    const h = await heightMm(win, paper)
    return win.webContents.printToPDF({ pageSize: { width: paper.widthMm / 25.4, height: h / 25.4 }, printBackground: true, preferCSSPageSize: false, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  }, needsMeasure(paper))
}

export function printHtml(html: string, opts: { silent: boolean; printerName: string; paper: PaperSize }): Promise<void> {
  return withHtml(html, async (win) => {
    const custom = typeof opts.paper === 'object'
    const size = custom ? { width: Math.round((opts.paper as { widthMm: number }).widthMm * 1000), height: Math.round((await heightMm(win, opts.paper)) * 1000) } : (opts.paper as 'A4' | 'Letter')
    return new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: opts.silent,
          printBackground: true,
          deviceName: opts.printerName || undefined,
          pageSize: size,
          margins: { marginType: 'none' }
        },
        (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(`Printing failed: ${reason}`)))
      )
    })
  }, needsMeasure(opts.paper))
}

export async function listPrinters(win: BrowserWindow): Promise<string[]> {
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((p) => p.name)
}
