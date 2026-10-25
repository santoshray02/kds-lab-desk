import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, makeLimiter, type WaAdapter } from '../gateway/server.mjs'
import { openDb, type Db } from '../src/main/db'
import { seedMaster } from '../src/main/master'
import { clock } from '../src/main/patients'
import { createVisit } from '../src/main/visits'
import { approveReport, getEntry, saveDraft } from '../src/main/results'
import { setSettings } from '../src/main/settings'
import { sendViaEvolution, setWaFetch, testEvolution } from '../src/main/whatsapp'

const KEY = 'k'.repeat(24)
let server: Server
let base = ''
let sent: { kind: string; number: string; text?: string; file?: string; caption?: string }[]
let state: 'open' | 'connecting' | 'close'

const fake: WaAdapter = {
  state: () => state,
  qr: () => '',
  async sendText(number, text) {
    if (number.endsWith('0000')) throw Object.assign(new Error('That number is not on WhatsApp'), { code: 'NO_WHATSAPP' })
    sent.push({ kind: 'text', number, text })
  },
  async sendDocument(number, d) {
    sent.push({ kind: 'doc', number, file: d.fileName, caption: d.caption, text: d.buffer.subarray(0, 4).toString() })
  }
}

beforeEach(async () => {
  sent = []
  state = 'open'
  server = createServer({ wa: fake, apiKey: KEY, instance: 'kds', limiter: makeLimiter({ minGapMs: 0, jitterMs: 0 }) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  setWaFetch((...a) => fetch(...a))
})
afterEach(() => new Promise<void>((r) => server.close(() => r())))

const post = (path: string, body: unknown, key = KEY) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify(body) })
const pdf64 = Buffer.from('%PDF-1.4 hello').toString('base64')

describe('gateway server', () => {
  it('refuses to start with a weak key', () => {
    expect(() => createServer({ wa: fake, apiKey: 'short' })).toThrow(/API_KEY/)
  })
  it('needs the API key (header or ?key=) except /health', async () => {
    expect((await fetch(base + '/health')).status).toBe(200)
    expect((await fetch(base + '/instance/connectionState/kds')).status).toBe(401)
    expect((await fetch(base + '/instance/connectionState/kds', { headers: { apikey: 'wrong' } })).status).toBe(401)
    expect((await fetch(`${base}/instance/connectionState/kds?key=${KEY}`)).status).toBe(200)
  })
  it('reports the connection state and knows only its own instance', async () => {
    const r = await (await fetch(base + '/instance/connectionState/kds', { headers: { apikey: KEY } })).json()
    expect(r.instance.state).toBe('open')
    expect((await fetch(base + '/instance/connectionState/other', { headers: { apikey: KEY } })).status).toBe(404)
  })
  it('sends text and PDF documents, and rejects bad input', async () => {
    expect((await post('/message/sendText/kds', { number: '919800000001', text: 'Hello' })).status).toBe(201)
    expect((await post('/message/sendMedia/kds', { number: '919800000001', mediatype: 'document', mimetype: 'application/pdf', media: pdf64, fileName: '../../evil name?.pdf', caption: 'Report' })).status).toBe(201)
    expect(sent[0]).toMatchObject({ kind: 'text', number: '919800000001', text: 'Hello' })
    expect(sent[1]).toMatchObject({ kind: 'doc', file: '.._.._evil name_.pdf', caption: 'Report', text: '%PDF' })
    expect((await post('/message/sendText/kds', { number: '12345', text: 'x' })).status).toBe(400)
    expect((await post('/message/sendText/kds', { number: '919800000001', text: '  ' })).status).toBe(400)
    expect((await post('/message/sendMedia/kds', { number: '919800000001', media: Buffer.from('not a pdf').toString('base64') })).status).toBe(400)
    expect((await post('/message/sendMedia/kds', { number: '919800000001', mimetype: 'application/zip', media: pdf64 })).status).toBe(400)
    expect(sent).toHaveLength(2)
  })
  it('says so when WhatsApp is not linked or the number is not on WhatsApp', async () => {
    expect((await post('/message/sendText/kds', { number: '919800000000', text: 'x' })).status).toBe(404)
    state = 'close'
    expect((await post('/message/sendText/kds', { number: '919800000001', text: 'x' })).status).toBe(503)
  })
  it('limiter spaces messages and caps them per hour', async () => {
    let t = 0
    const waits: number[] = []
    const run = makeLimiter({ minGapMs: 3000, jitterMs: 0, perHour: 2, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms } })
    await run(async () => 1)
    await run(async () => 2)
    expect(waits).toEqual([3000])
    await expect(run(async () => 3)).rejects.toThrow(/Hourly limit/)
    t += 3600_001
    await expect(run(async () => 4)).resolves.toBe(4)
  })
})

describe('KDS Lab Desk talking to the gateway', () => {
  let db: Db
  beforeEach(() => {
    db = openDb(':memory:')
    seedMaster(db)
    clock.now = () => new Date(2026, 9, 25, 10, 0, 0)
  })
  it('sends a real PDF file through the app code and the gateway', async () => {
    const v = createVisit(db, { patient: { name: 'Gate Way', title: 'Mr', sex: 'M', phone: '9800000071', village: 'T' }, age: { years: 30, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['RBS'], paid: 0 })
    const rid = getEntry(db, v.visitId).reportId!
    saveDraft(db, rid, { rbs: '100' })
    approveReport(db, rid, {})
    const pdf = join(mkdtempSync(join(tmpdir(), 'kds-gw-')), 'report.pdf')
    writeFileSync(pdf, '%PDF-1.4 real-ish')
    setSettings(db, { waTarget: 'evolution', evolution: { url: base, instance: 'kds', apiKey: KEY } })
    await sendViaEvolution(db, rid, pdf)
    expect(sent[0]).toMatchObject({ kind: 'doc', number: '919800000071', file: 'report.pdf', text: '%PDF' })
    expect(sent[0].caption).toContain('Gate Way')
    expect((await testEvolution(base, 'kds', KEY)).ok).toBe(true)
    state = 'connecting'
    expect((await testEvolution(base, 'kds', KEY)).ok).toBe(false)
    setSettings(db, { evolution: { url: base, instance: 'kds', apiKey: 'wrong-key-wrong-key-wrong' } })
    await expect(sendViaEvolution(db, rid, pdf)).rejects.toThrow(/401/)
  })
})
