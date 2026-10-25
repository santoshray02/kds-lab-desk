import type { Handlers } from '../main/handlers'

type Promisify<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never
type Api = { [N in keyof Handlers]: { [M in keyof Handlers[N]]: Promisify<Handlers[N][M]> } }

declare global {
  interface Window {
    kds: {
      invoke(channel: string, ...args: unknown[]): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string; data?: unknown }>
      on(channel: string, cb: (payload: unknown) => void): () => void
    }
  }
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public data?: unknown) {
    super(message)
  }
}

function call(ns: string, method: string) {
  return async (...args: unknown[]) => {
    const r = await window.kds.invoke(`${ns}.${method}`, ...args)
    if (!r.ok) throw new ApiError(r.code, r.message, r.data)
    return r.value
  }
}

/** api.patients.search('x') → main process handler "patients.search" */
export const api = new Proxy({} as Api, {
  get: (_t, ns: string) => new Proxy({}, { get: (_t2, method: string) => call(ns, method) })
})

export type Entry = Awaited<ReturnType<Api['results']['entry']>>
export type VisitItem = Awaited<ReturnType<Api['visits']['list']>>[number]
export type Person = Awaited<ReturnType<Api['patients']['byPhone']>>[number]
