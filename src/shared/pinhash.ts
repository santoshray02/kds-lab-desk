/**
 * Report PIN hashing, shared by the lab PC (uploads the hash) and the cloud Edge Function (checks it).
 * The cloud/functions/get-report/hash.ts copy must stay identical; tests/cloud.test.ts compares them.
 * Only Web Crypto is used so it runs in Node, Electron and Deno.
 */
export async function hashPin(code: string, pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${pin}:${salt}`)
  // 2 000 rounds of SHA-256: a 4-digit PIN is guessable anyway, the real protection is rate limiting
  let digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  for (let i = 0; i < 2000; i++) digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digest))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomSalt(): string {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
