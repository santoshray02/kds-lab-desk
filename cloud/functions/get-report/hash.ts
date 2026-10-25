// Must stay identical to src/shared/pinhash.ts (tests/cloud.test.ts checks that they agree).
export async function hashPin(code: string, pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${pin}:${salt}`)
  let digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  for (let i = 0; i < 2000; i++) digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digest))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}
