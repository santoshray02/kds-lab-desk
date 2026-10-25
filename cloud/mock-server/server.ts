import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A tiny stand-in for Supabase (PostgREST upserts + Storage uploads) used to test sync without internet.
 * `failNext` makes the next N requests answer 503; `down` closes the connection without an answer.
 */
export interface MockCloud {
  url: string
  tables: Record<string, Map<number, any>>
  files: Map<string, Buffer>
  requests: { method: string; path: string }[]
  failNext: number
  down: boolean
  key: string
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

export async function startMockCloud(key = 'service-key'): Promise<MockCloud> {
  const state = { tables: { patients: new Map(), visits: new Map(), reports: new Map() } as Record<string, Map<number, any>>, files: new Map<string, Buffer>(), requests: [] as { method: string; path: string }[] }
  const mock = { failNext: 0, down: false } as { failNext: number; down: boolean }

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const send = (status: number, body: unknown = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (mock.down) return req.socket.destroy()
    state.requests.push({ method: req.method ?? '', path: url.pathname })
    if (mock.failNext > 0) {
      mock.failNext--
      return send(503, { message: 'temporarily unavailable' })
    }
    if (req.headers.apikey !== key) return send(401, { message: 'Invalid API key' })
    const body = await readBody(req)

    const rest = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)
    if (rest) {
      const t = state.tables[rest[1]]
      if (!t) return send(404, { message: 'relation does not exist' })
      if (req.method === 'GET') return send(200, [...t.values()].slice(0, 1))
      if (req.method === 'POST') {
        for (const row of JSON.parse(body.toString('utf8'))) t.set(row.id, { ...(t.get(row.id) ?? {}), ...row })
        return send(201)
      }
    }
    const obj = /^\/storage\/v1\/object\/reports\/(.+)$/.exec(url.pathname)
    if (obj && req.method === 'POST') {
      state.files.set(decodeURIComponent(obj[1]), body)
      return send(200, { Key: obj[1] })
    }
    send(404, { message: 'not found' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const handle: MockCloud = {
    url: `http://127.0.0.1:${port}`, tables: state.tables, files: state.files, requests: state.requests, key,
    get failNext() { return mock.failNext }, set failNext(v: number) { mock.failNext = v },
    get down() { return mock.down }, set down(v: boolean) { mock.down = v },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()) })
  }
  return handle
}
