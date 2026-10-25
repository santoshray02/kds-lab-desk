// The WhatsApp side, built on Baileys (an unofficial WhatsApp Web client). The linked session is kept in AUTH_DIR,
// no database. Back that folder up like a password: whoever has it can use the lab's WhatsApp.
//
// Self-healing: every failure ends in "wait, then reconnect". One connection exists at a time, a watchdog
// reconnects if the link is stuck, and if the phone unlinks the device the old session is cleared so a fresh
// QR appears at /qr by itself.
import { rmSync, mkdirSync } from 'node:fs'
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys'
import pino from 'pino'

const err = (message, status) => Object.assign(new Error(message), { status })

export function createWhatsApp({ authDir = './auth', log = pino({ level: 'warn' }) } = {}) {
  let sock = null
  let state = 'connecting'
  let qr = ''
  let stopped = false
  let starting = false
  let retry = 0
  let retryTimer = null
  let changedAt = Date.now()
  let watchdog = null

  const setState = (s) => {
    if (s !== state) { state = s; changedAt = Date.now() }
  }

  function scheduleReconnect(why) {
    if (stopped || retryTimer) return
    const wait = Math.min(60_000, 2000 * 2 ** Math.min(retry++, 5))
    log.warn(`WhatsApp link down (${why}); reconnecting in ${Math.round(wait / 1000)} s`)
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
      dropSocket()
      mkdirSync(authDir, { recursive: true })
      const { state: auth, saveCreds } = await useMultiFileAuthState(authDir)
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
      const s = makeWASocket({
        version,
        auth,
        logger: log,
        browser: Browsers.appropriate('KDS Lab Desk'),
        markOnlineOnConnect: false, // do not show the lab as "online" all day
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30_000,
        keepAliveIntervalMs: 25_000
      })
      sock = s
      setState('connecting')
      s.ev.on('creds.update', () => saveCreds().catch((e) => log.error(e, 'could not save the WhatsApp session')))
      s.ev.on('connection.update', (u) => {
        if (s !== sock) return // an old socket's late news
        if (u.qr) qr = u.qr
        if (u.connection === 'open') { setState('open'); qr = ''; retry = 0; log.warn('WhatsApp linked and ready') }
        else if (u.connection === 'connecting') setState('connecting')
        else if (u.connection === 'close') {
          setState('close')
          const code = u.lastDisconnect?.error?.output?.statusCode
          if (code === DisconnectReason.loggedOut) {
            // unlinked from the phone: the saved session is useless, clear it so a new QR can be scanned
            log.warn('WhatsApp was unlinked from the phone. Clearing the old session; scan the new QR at /qr.')
            try { rmSync(authDir, { recursive: true, force: true }) } catch (e) { log.error(e) }
            retry = 0
          }
          scheduleReconnect(code ? `code ${code}` : 'closed')
        }
      })
    } catch (e) {
      setState('close')
      log.error(e, 'could not start the WhatsApp link')
      scheduleReconnect('start failed')
    } finally {
      starting = false
    }
  }

  function start() {
    watchdog = setInterval(() => {
      if (stopped || starting || retryTimer) return
      const stuckFor = Date.now() - changedAt
      // closed with nothing scheduled, or "connecting" for 3 minutes with no QR waiting to be scanned: start over
      if ((state === 'close' && stuckFor > 30_000) || (state === 'connecting' && !qr && stuckFor > 180_000)) {
        log.warn(`WhatsApp link stuck in "${state}" for ${Math.round(stuckFor / 1000)} s; restarting it`)
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
    async sendText(number, text) {
      await ready().sendMessage(await jid(number), { text })
    },
    async sendDocument(number, { buffer, mimetype, fileName, caption }) {
      await ready().sendMessage(await jid(number), { document: buffer, mimetype, fileName, caption })
    },
    async stop() {
      stopped = true
      clearInterval(watchdog)
      clearTimeout(retryTimer)
      dropSocket()
    }
  }
}
