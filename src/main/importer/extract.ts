import * as CFB from 'cfb'
import { unzipSync, strFromU8 } from 'fflate'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

/**
 * Plain-text extraction for the old reports. Pure JavaScript (no Word, no Python):
 * .doc (binary Word 97-2003), .docx and .pdf.
 */

/** Text of a binary .doc file. Port of tools/import/doctext.py. */
const cp1252 = new TextDecoder('windows-1252')

export function docText(buf: Buffer): string {
  const cfb = CFB.read(buf, { type: 'buffer' })
  const wdEntry = CFB.find(cfb, '/WordDocument')
  if (!wdEntry) throw new Error('not a Word document')
  const wd = Buffer.from(wdEntry.content as Uint8Array)
  const flags = wd.readUInt16LE(0x0a)
  const tblEntry = CFB.find(cfb, flags & 0x200 ? '/1Table' : '/0Table')
  if (!tblEntry) throw new Error('Word table stream missing')
  const tbl = Buffer.from(tblEntry.content as Uint8Array)
  const fcClx = wd.readUInt32LE(0x1a2)
  const lcbClx = wd.readUInt32LE(0x1a6)
  const clx = tbl.subarray(fcClx, fcClx + lcbClx)
  let i = 0
  while (clx[i] === 1) i += 3 + clx.readUInt16LE(i + 1)
  if (clx[i] !== 2) throw new Error('piece table not found')
  const lcb = clx.readUInt32LE(i + 1)
  const pct = clx.subarray(i + 5, i + 5 + lcb)
  const n = Math.floor((lcb - 4) / 12)
  const cps: number[] = []
  for (let k = 0; k <= n; k++) cps.push(pct.readUInt32LE(4 * k))
  const parts: string[] = []
  for (let k = 0; k < n; k++) {
    const fc = pct.readUInt32LE(4 * (n + 1) + 8 * k + 2)
    const len = cps[k + 1] - cps[k]
    if (fc & 0x40000000) {
      const start = (fc & 0x3fffffff) / 2
      parts.push(cp1252.decode(wd.subarray(start, start + len)))
    } else {
      parts.push(wd.subarray(fc, fc + 2 * len).toString('utf16le'))
    }
  }
  const ccpText = wd.readUInt32LE(0x4c)
  return parts.join('').slice(0, ccpText)
}

export function docLines(buf: Buffer): string[] {
  return docText(buf)
    .replace(/\x07/g, ' | ')
    .replace(/\x0b/g, '\n')
    .replace(/\x0c/g, '\n')
    .replace(/\x13[^\x14\x15]*\x14?/g, '') // field codes
    .replace(/[\x15\x01\x08]/g, '')
    .split(/\r|\n/)
}

/* ------------------------------------------------------------------ docx */

interface XNode {
  tag: string
  children: XNode[]
  text: string
}

/** Tiny XML reader: enough for word/document.xml (no DTD, no CDATA tricks). */
function parseXml(xml: string): XNode {
  const root: XNode = { tag: '#root', children: [], text: '' }
  const stack: XNode[] = [root]
  const re = /<(\/?)([A-Za-z0-9_:.-]+)([^>]*?)(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) {
      stack[stack.length - 1].text += decode(m[5])
      continue
    }
    const [, close, tag, , self] = m
    if (close) {
      if (stack.length > 1) stack.pop()
    } else {
      const node: XNode = { tag, children: [], text: '' }
      stack[stack.length - 1].children.push(node)
      if (!self) stack.push(node)
    }
  }
  return root
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&')

function walk(n: XNode, fn: (x: XNode) => void) {
  fn(n)
  for (const c of n.children) walk(c, fn)
}

function paraText(p: XNode): string {
  let s = ''
  walk(p, (x) => {
    if (x.tag === 'w:t') s += x.text
    else if (x.tag === 'w:tab') s += '\t'
    else if (x.tag === 'w:br' || x.tag === 'w:cr') s += '\n'
  })
  return s
}

export function docxLines(buf: Buffer): string[] {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'word/document.xml' })
  const xml = files['word/document.xml']
  if (!xml) throw new Error('word/document.xml missing')
  const root = parseXml(strFromU8(xml))
  const body: XNode | undefined = (() => {
    let b: XNode | undefined
    walk(root, (x) => { if (x.tag === 'w:body') b = x })
    return b
  })()
  if (!body) throw new Error('empty document')
  const lines: string[] = []
  for (const ch of body.children) {
    if (ch.tag === 'w:p') lines.push(...paraText(ch).split('\n'))
    else if (ch.tag === 'w:tbl') {
      const trs: XNode[] = []
      walk(ch, (x) => { if (x.tag === 'w:tr') trs.push(x) })
      for (const tr of trs) {
        const cells = tr.children.filter((c) => c.tag === 'w:tc').map((tc) => {
          const ps: string[] = []
          walk(tc, (x) => { if (x.tag === 'w:p') { const t = paraText(x).trim(); if (t) ps.push(t) } })
          return ps.join(' / ')
        })
        lines.push(cells.join(' | '))
      }
    }
  }
  return lines
}

/* ------------------------------------------------------------------- pdf */

interface PdfItem { str: string; x: number; y: number; w: number }

export async function pdfLines(buf: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true, verbosity: 0 })
  const doc = await task.promise
  const out: string[] = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      const items: PdfItem[] = []
      for (const it of tc.items as { str?: string; transform: number[]; width: number }[]) {
        if (!it.str || !it.str.trim()) continue
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })
      }
      // group into lines by baseline (tolerance 3pt), top to bottom
      items.sort((a, b) => b.y - a.y || a.x - b.x)
      const rows: PdfItem[][] = []
      for (const it of items) {
        const last = rows[rows.length - 1]
        if (last && Math.abs(last[0].y - it.y) <= 3) last.push(it)
        else rows.push([it])
      }
      for (const r of rows) {
        r.sort((a, b) => a.x - b.x)
        let line = ''
        let prevEnd = 0
        r.forEach((it, i) => {
          if (i > 0) line += it.x - prevEnd > 6 ? '\t' : ' '
          line += it.str.trim()
          prevEnd = it.x + it.w
        })
        out.push(line)
      }
      out.push('\f')
    }
  } finally {
    await task.destroy()
  }
  return out
}

/** Lines of text for any supported file. */
export async function extractLines(path: string, buf?: Buffer): Promise<string[]> {
  const data = buf ?? readFileSync(path)
  switch (extname(path).toLowerCase()) {
    case '.doc': return docLines(data)
    case '.docx': return docxLines(data)
    case '.pdf': return pdfLines(data)
    default: throw new Error('unsupported file type')
  }
}
