export interface WaAdapter {
  state(): 'open' | 'connecting' | 'close'
  qr(): string
  sendText(number: string, text: string): Promise<void>
  sendDocument(number: string, d: { buffer: Buffer; mimetype: string; fileName: string; caption: string }): Promise<void>
}
export function makeLimiter(o?: { minGapMs?: number; jitterMs?: number; perHour?: number; sleep?: (ms: number) => Promise<void>; now?: () => number }): <T>(job: () => Promise<T>) => Promise<T>
export function createServer(o: { wa: WaAdapter; apiKey: string; instance?: string; limiter?: ReturnType<typeof makeLimiter> }): import('node:http').Server
