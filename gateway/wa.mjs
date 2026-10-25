// The WhatsApp side, built on Baileys (an unofficial WhatsApp Web client). The linked session is kept in AUTH_DIR,
// no database. Back that folder up like a password: whoever has it can use the lab's WhatsApp.
//
// Used by the standalone gateway AND by KDS Lab Desk itself (Settings → Link WhatsApp). The WhatsApp library is only
// loaded when start() is called, so an app that never links WhatsApp pays nothing for it.
//
// Self-healing: every failure ends in "wait, then reconnect". One connection exists at a time, a watchdog
// reconnects if the link is stuck, and if the phone unlinks the device the old session is cleared so a fresh
// QR appears by itself.
import { rmSync, mkdirSync } from 'node:fs'

const err = (message, status) => Object.assign(new Error(message), { status })
const quiet = { warn() {}, error() {}, info() {} }

export function createWhatsApp({ authDir = './auth', log = null } = {}) {
  let sock = null
  let state = 'connecting'
  let qr = ''
  let stopped = false
  let starting = false
  let retry = 0
  let retryTimer = null
  let changedAt = Date.now()
  let watchdog = null
  let lib = null
  let L = log ?? quiet

  const setState = (s) => {
    if (s !== state) { state = s; changedAt = Date.now() }
  }

  async function load() {
    if (lib) return lib
    const [baileys, pino] = await Promise.all([import('@whiskeysockets/baileys'), import('pino')])
    lib = { ...baileys, makeWASocket: baileys.default ?? baileys.makeWASocket, pino: pino.default ?? pino }
    if (!log) L = lib.pino({ level: 'warn' })
    return lib
  }

  function scheduleReconnect(why) {
    if (stopped || retryTimer) return
    const wait = Math.min(60_000, 2000 * 2 ** Math.min(retry++, 5))
    L.warn(`WhatsApp link down (${why}); reconnecting in ${Math.round(wait / 1000)} s`)
    retryTimer = setTimeout(() => {
      retryTimer = null
      connect()
    }, wait)
  }

  function dropSocket() {
    const old = sock
    sock = null
    if (!old) return
    try { old.ev.removeAllListeners('connection.update') } catch { /* already gone */ }
    try { old.ev.removeAllListeners('creds.update') } catch { /* already gone */ }
    try { old.end(undefined) } catch { /* already closed */ }
  }

  async function connect() {
    if (stopped || starting) return
    starting = true
    try {
      const w = await load()
      dropSocket()
      mkdirSync(authDir, { recursive: true })
      const { state: auth, saveCreds } = await w.useMultiFileAuthState(authDir)
      const { version } = await w.fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
      const s = w.makeWASocket({
        version,
        auth,
        logger: L.child ? L : w.pino({ level: 'silent' }),
        browser: w.Browsers.appropriate('KDS Lab Desk'),
        markOnlineOnConnect: false, // do not show the lab as "online" all day
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30_000,
        keepAliveIntervalMs: 25_000
      })
      sock = s
      setState('connecting')
      s.ev.on('creds.update', () => saveCreds().catch((e) => L.error(e, 'could not save the WhatsApp session')))
      s.ev.on('connection.update', (u) => {
        if (s !== sock) return // an old socket's late news
        if (u.qr) qr = u.qr
        if (u.connection === 'open') { setState('open'); qr = ''; retry = 0; L.warn('WhatsApp linked and ready') }
        else if (u.connection === 'connecting') setState('connecting')
        else if (u.connection === 'close') {
          setState('close')
          const code = u.lastDisconnect?.error?.output?.statusCode
          if (code === w.DisconnectReason.loggedOut) {
            // unlinked from the phone: the saved session is useless, clear it so a new QR can be scanned
            L.warn('WhatsApp was unlinked from the phone. Clearing the old session; scan the new QR.')
            try { rmSync(authDir, { recursive: true, force: true }) } catch (e) { L.error(e) }
            retry = 0
          }
          scheduleReconnect(code ? `code ${code}` : 'closed')
        }
      })
    } catch (e) {
      setState('close')
      L.error(e, 'could not start the WhatsApp link')
      scheduleReconnect('start failed')
    } finally {
      starting = false
    }
  }

  function start() {
    stopped = false
    clearInterval(watchdog)
    watchdog = setInterval(() => {
      if (stopped || starting || retryTimer) return
      const stuckFor = Date.now() - changedAt
      // closed with nothing scheduled, or "connecting" for 3 minutes with no QR waiting to be scanned: start over
      if ((state === 'close' && stuckFor > 30_000) || (state === 'connecting' && !qr && stuckFor > 180_000)) {
        L.warn(`WhatsApp link stuck in "${state}" for ${Math.round(stuckFor / 1000)} s; restarting it`)
        connect()
      }
    }, 30_000)
    watchdog.unref?.()
    return connect()
  }

  const ready = () => {
    if (!sock || state !== 'open') throw err('WhatsApp is not connected right now.', 503)
    return sock
  }

  async function jid(number) {
    const r = await ready().onWhatsApp(`${number}@s.whatsapp.net`)
    if (!r?.[0]?.exists) throw Object.assign(new Error('That number is not on WhatsApp'), { code: 'NO_WHATSAPP' })
    return r[0].jid
  }

  return {
    start,
    state: () => state,
    qr: () => qr,
    /** the linked phone number, digits only, or '' */
    phone: () => String(sock?.user?.id ?? '').split(/[:@]/)[0],
    async sendText(number, text) {
      await ready().sendMessage(await jid(number), { text })
    },
    async sendDocument(number, { buffer, mimetype, fileName, caption }) {
      await ready().sendMessage(await jid(number), { document: buffer, mimetype, fileName, caption })
    },
    /** Unlink this computer from the phone, forget the session and get ready to show a new QR. */
    async logout() {
      try { await sock?.logout() } catch { /* the phone may already have removed it */ }
      dropSocket()
      try { rmSync(authDir, { recursive: true, force: true }) } catch { /* nothing to remove */ }
      qr = ''
      retry = 0
      setState('close')
    },
    async stop() {
      stopped = true
      clearInterval(watchdog)
      clearTimeout(retryTimer)
      retryTimer = null
      dropSocket()
    }
  }
}
