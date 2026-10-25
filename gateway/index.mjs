// KDS WhatsApp gateway: node index.mjs   (use run-forever.mjs / start-gateway.cmd to have it restart itself)
// Environment: API_KEY (required, 16+ characters), INSTANCE (default kds), PORT (default 8080),
//              HOST (default 127.0.0.1; use 0.0.0.0 only behind a firewall or HTTPS proxy), AUTH_DIR (default ./auth)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from './server.mjs'
import { createWhatsApp } from './wa.mjs'

// settings may sit in a .env file next to this program (KEY=value per line)
const envFile = join(dirname(fileURLToPath(import.meta.url)), '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(String.fromCharCode(10))) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const apiKey = process.env.API_KEY ?? ''
if (apiKey.length < 16) {
  console.error('Set API_KEY to a long random secret (16+ characters) before starting.')
  process.exit(78) // configuration error: the supervisor will not keep retrying
}
const instance = process.env.INSTANCE || 'kds'
const port = Number(process.env.PORT || 8080)
const host = process.env.HOST || '127.0.0.1'
const stamp = () => new Date().toISOString()

const wa = createWhatsApp({ authDir: process.env.AUTH_DIR || './auth' })
const server = createServer({ wa, apiKey, instance })

server.on('error', (e) => {
  console.error(stamp(), 'server error:', e.message)
  process.exit(1) // e.g. port already in use: let the supervisor retry
})
server.listen(port, host, () => {
  console.log(`${stamp()} KDS WhatsApp gateway on http://${host}:${port}  (instance "${instance}")`)
  console.log(`First time: open http://${host}:${port}/qr?key=<your API_KEY> and scan the code with the lab phone.`)
})
wa.start()

// A stray error from the WhatsApp library must not take the gateway down. If errors keep coming
// (5 in 5 minutes) the process is in a bad state: exit so the supervisor starts a clean one.
const recent = []
function stray(kind, e) {
  const t = Date.now()
  recent.push(t)
  while (recent.length && t - recent[0] > 300_000) recent.shift()
  console.error(stamp(), kind, e?.stack || e)
  if (recent.length >= 5) {
    console.error(stamp(), 'too many errors, restarting')
    process.exit(1)
  }
}
process.on('uncaughtException', (e) => stray('uncaughtException', e))
process.on('unhandledRejection', (e) => stray('unhandledRejection', e))

// Self-check every minute: if the web server stops answering itself, exit and be restarted.
let misses = 0
setInterval(async () => {
  try {
    const r = await fetch(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/health`, { signal: AbortSignal.timeout(5000) })
    misses = r.ok ? 0 : misses + 1
  } catch {
    misses++
  }
  if (misses >= 3) {
    console.error(stamp(), 'web server not answering, restarting')
    process.exit(1)
  }
}, 60_000).unref()

let closing = false
async function bye() {
  if (closing) return
  closing = true
  await wa.stop().catch(() => undefined)
  server.close()
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
