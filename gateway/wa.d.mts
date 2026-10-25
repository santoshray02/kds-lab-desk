export interface WhatsAppLink {
  start(): Promise<void>
  state(): 'open' | 'connecting' | 'close'
  qr(): string
  phone(): string
  sendText(number: string, text: string): Promise<void>
  sendDocument(number: string, d: { buffer: Buffer; mimetype: string; fileName: string; caption: string }): Promise<void>
  logout(): Promise<void>
  stop(): Promise<void>
}
export function createWhatsApp(o?: { authDir?: string; log?: unknown }): WhatsAppLink
