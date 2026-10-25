// HTTP side of the KDS WhatsApp gateway. It knows nothing about WhatsApp itself: it talks to an adapter `wa`:
//   wa.state()                      -> 'open' | 'connecting' | 'close'
//   wa.qr()                         -> current QR text or ''
//   wa.sendText(number, text)       -> Promise<void>   (throws Error with .code = 'NO_WHATSAPP' for numbers not on WhatsApp)
//   wa.sendDocument(number, { buffer, mimetype, fileName, caption }) -> Promise<void>
// The routes match the Evolution API calls KDS Lab Desk already uses, so either gateway works.
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const MAX_BODY = 25 * 1024 * 1024

function same(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

function send(res, code, obj, type = 'application/json') {
  const body = type === 'application/json' ? JSON.stringify(obj) : String(obj)
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }))
        req.destroy()
        return
      }
      parts.push(c)
    })
    req.on('end', () => {
      try {
        resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {})
      } catch {
        reject(Object.assign(new Error('Body must be JSON'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

const cleanNumber = (n) => {
  const d = String(n ?? '').replace(/\D/g, '')
  return d.length >= 11 && d.length <= 15 ? d : null
}

/**
 * Sends are done one at a time with a pause between them (a burst of messages is what gets numbers blocked),
 * and at most `perHour` per hour.
 */
export function makeLimiter({ minGapMs = 3000, jitterMs = 2000, perHour = 60, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  let chain = Promise.resolve()
  const sent = []
  return function run(job) {
    const result = chain.then(async () => {
      const t = now()
      while (sent.length && t - sent[0] > 3600_000) sent.shift()
      if (sent.length >= perHour) throw Object.assign(new Error(`Hourly limit of ${perHour} messages reached. Try later.`), { status: 429 })
      const wait = sent.length ? Math.max(0, sent[sent.length - 1] + minGapMs + Math.random() * jitterMs - t) : 0
      if (wait) await sleep(wait)
      const out = await job()
      sent.push(now())
      return out
    })
    chain = result.catch(() => undefined)
    return result
  }
}

const SEND_TIMEOUT_MS = 90_000

/** A hung WhatsApp call must never block the queue behind it. */
function withTimeout(promise, ms, what) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${what} timed out. Check the gateway's internet.`), { status: 504 })), ms) })
  ]).finally(() => clearTimeout(timer))
}

export function createServer({ wa, apiKey, instance = 'kds', limiter = makeLimiter(), sendTimeoutMs = SEND_TIMEOUT_MS }) {
  if (!apiKey || String(apiKey).length < 16) throw new Error('API_KEY must be set and at least 16 characters long')

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const path = url.pathname.replace(/\/+$/, '') || '/'
      const authed = same(req.headers['apikey'], apiKey) || same(url.searchParams.get('key'), apiKey)

      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, whatsapp: wa.state(), uptimeSeconds: Math.round(process.uptime()) })
      if (!authed) return send(res, 401, { error: 'Wrong or missing API key' })

      // the page the owner opens once to link WhatsApp (Settings → Linked devices → Link a device)
      if (req.method === 'GET' && path === '/qr') {
        const state = wa.state()
        if (state === 'open') return send(res, 200, '<h2 style="font-family:sans-serif">WhatsApp is linked. Nothing to do.</h2>', 'text/html')
        const qr = wa.qr()
        if (!qr) return send(res, 200, '<meta http-equiv="refresh" content="3"><h2 style="font-family:sans-serif">Starting… this page refreshes by itself.</h2>', 'text/html')
        const { default: QRCode } = await import('qrcode')
        const svg = await QRCode.toString(qr, { type: 'svg', margin: 2, width: 320 })
        return send(res, 200, `<meta http-equiv="refresh" content="15"><body style="font-family:sans-serif;text-align:center"><h2>Scan with WhatsApp</h2><p>Phone → WhatsApp → Settings → Linked devices → Link a device</p>${svg}</body>`, 'text/html')
      }

      const m = /^\/(instance\/connectionState|message\/sendText|message\/sendMedia)\/([^/]+)$/.exec(path)
      if (!m) return send(res, 404, { error: 'Not found' })
      if (decodeURIComponent(m[2]) !== instance) return send(res, 404, { error: `Unknown instance. This gateway is "${instance}".` })

      if (m[1] === 'instance/connectionState' && req.method === 'GET') {
        return send(res, 200, { instance: { instanceName: instance, state: wa.state() } })
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' })

      const body = await readBody(req)
      const number = cleanNumber(body.number)
      if (!number) return send(res, 400, { error: 'number must be the full phone number with country code, digits only' })
      if (wa.state() !== 'open') return send(res, 503, { error: 'WhatsApp is not linked or still connecting. Open /qr to link it.' })

      if (m[1] === 'message/sendText') {
        const text = String(body.text ?? '').trim()
        if (!text) return send(res, 400, { error: 'text is empty' })
        await limiter(() => withTimeout(wa.sendText(number, text.slice(0, 4000)), sendTimeoutMs, 'Sending'))
        return send(res, 201, { status: 'sent' })
      }

      // sendMedia: only PDFs, because that is all the lab sends
      const mimetype = String(body.mimetype ?? 'application/pdf')
      if (mimetype !== 'application/pdf') return send(res, 400, { error: 'Only application/pdf is accepted' })
      const buffer = Buffer.from(String(body.media ?? ''), 'base64')
      if (buffer.length < 5 || buffer.subarray(0, 4).toString('latin1') !== '%PDF') return send(res, 400, { error: 'media must be a base64 PDF file' })
      const fileName = String(body.fileName ?? 'report.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'report.pdf'
      await limiter(() => withTimeout(wa.sendDocument(number, { buffer, mimetype, fileName, caption: String(body.caption ?? '').slice(0, 1000) }), sendTimeoutMs, 'Sending'))
      return send(res, 201, { status: 'sent' })
    } catch (e) {
      const status = e.status ?? (e.code === 'NO_WHATSAPP' ? 404 : 502)
      return send(res, status, { error: e.message || 'Failed' })
    }
  })
  // slow or broken clients must not tie the server up or crash it
  server.headersTimeout = 15_000
  server.requestTimeout = 60_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 50
  server.on('clientError', (_e, socket) => {
    if (socket.writable) socket.end(['HTTP/1.1 400 Bad Request', '', ''].join(String.fromCharCode(13, 10)))
    else socket.destroy()
  })
  return server
}
