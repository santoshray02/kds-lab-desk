import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { unzipSync, zipSync } from 'fflate'

/**
 * One password-locked file holding a whole backup folder, so it can sit in the owner's Google Drive
 * without anyone (including Google and us) being able to read patient data.
 * Layout: "KDSB1" | salt 16 | iv 12 | AES-256-GCM ciphertext | tag 16. The key comes from the password with scrypt.
 */
const MAGIC = Buffer.from('KDSB1')

export class WrongPassword extends Error {
  constructor() {
    super('Wrong backup password, or the file is damaged.')
  }
}

const keyFor = (password: string, salt: Buffer) => scryptSync(password.normalize('NFKC'), salt, 32)

function filesIn(dir: string, base = dir, out: Record<string, Uint8Array> = {}): Record<string, Uint8Array> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) filesIn(p, base, out)
    else out[relative(base, p).split('\\').join('/')] = readFileSync(p)
  }
  return out
}

export function lockBackup(dir: string, password: string): Buffer {
  const zip = Buffer.from(zipSync(filesIn(dir), { level: 6 }))
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyFor(password, salt), iv)
  c.setAAD(MAGIC)
  const body = Buffer.concat([c.update(zip), c.final()])
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()])
}

/** Opens a locked backup into `dest` (created). Throws WrongPassword for a bad password or a damaged file. */
export function unlockBackup(file: Buffer, password: string, dest: string): void {
  if (file.length < MAGIC.length + 16 + 12 + 16 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not a KDS Lab Desk backup file.')
  const salt = file.subarray(5, 21)
  const iv = file.subarray(21, 33)
  const tag = file.subarray(file.length - 16)
  const body = file.subarray(33, file.length - 16)
  let zip: Buffer
  try {
    const d = createDecipheriv('aes-256-gcm', keyFor(password, salt), iv)
    d.setAAD(MAGIC)
    d.setAuthTag(tag)
    zip = Buffer.concat([d.update(body), d.final()])
  } catch {
    throw new WrongPassword()
  }
  const root = resolve(dest)
  mkdirSync(root, { recursive: true })
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    const target = resolve(root, name)
    const rel = relative(root, target)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('The backup file contains an unsafe path.')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
  }
}
