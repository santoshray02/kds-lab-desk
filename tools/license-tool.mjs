// Licence maker for KDS Lab Desk. For the owner only: the private key must never leave the owner's PC or go into git.
//
//   node tools/license-tool.mjs keygen  [folder]                      make the key pair (once)
//   node tools/license-tool.mjs issue   --licensee "Name" --plan unlimited|monthly [--limit 500] [--expires 2027-10-31] [--id LAB-0002] [--key folder]
//   node tools/license-tool.mjs verify  <code> [--key folder]         check a code
//
// A licence is one line of text: KDS1.<details>.<signature>. Send it to the lab by WhatsApp or email;
// they paste it in Settings → Licence. The program checks the signature offline with the public key built into it.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [cmd, ...rest] = process.argv.slice(2)
const flag = (name, def) => {
  const i = rest.indexOf('--' + name)
  return i >= 0 ? rest[i + 1] : def
}
const keyDir = flag('key', cmd === 'keygen' && rest[0] && !rest[0].startsWith('--') ? rest[0] : join(homedir(), 'KDS-licence-keys'))
const b64u = (buf) => Buffer.from(buf).toString('base64url')

if (cmd === 'keygen') {
  mkdirSync(keyDir, { recursive: true })
  const priv = join(keyDir, 'private.pem')
  if (existsSync(priv)) {
    console.error('A private key already exists in', keyDir, '- not overwriting it. Delete it only if you really want to replace every licence ever issued.')
    process.exit(1)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  writeFileSync(join(keyDir, 'public.txt'), pubDer.toString('base64'))
  console.log('Private key saved in', priv, '(keep it secret; back it up on a pen drive).')
  console.log('Public key (put in src/shared/licenseKey.ts):')
  console.log(pubDer.toString('base64'))
} else if (cmd === 'issue') {
  const licensee = flag('licensee')
  const plan = flag('plan', 'unlimited')
  if (!licensee || !['unlimited', 'monthly'].includes(plan)) {
    console.error('Usage: issue --licensee "Lab name" --plan unlimited|monthly [--limit 500] [--expires YYYY-MM-DD]')
    process.exit(1)
  }
  const payload = {
    id: flag('id', 'LAB-' + Date.now().toString(36).toUpperCase()),
    licensee,
    plan,
    ...(plan === 'monthly' ? { limit: Number(flag('limit', '500')) } : {}),
    ...(flag('expires') ? { expires: flag('expires') } : {}),
    issued: new Date().toISOString().slice(0, 10)
  }
  if (plan === 'monthly' && !(payload.limit > 0)) {
    console.error('--limit must be a number above 0')
    process.exit(1)
  }
  const json = JSON.stringify(payload)
  const key = createPrivateKey(readFileSync(join(keyDir, 'private.pem')))
  const code = 'KDS1.' + b64u(json) + '.' + b64u(sign(null, Buffer.from(json), key))
  console.log(code)
  console.error('Licence for', licensee, '-', plan, payload.limit ? payload.limit + ' reports a month' : 'no monthly limit', payload.expires ? 'until ' + payload.expires : 'no expiry')
} else if (cmd === 'verify') {
  const code = rest.find((a) => a.startsWith('KDS1.'))
  const pub = createPublicKey(createPrivateKey(readFileSync(join(keyDir, 'private.pem'))))
  const [, p, s] = (code ?? '').split('.')
  const ok = !!p && !!s && verify(null, Buffer.from(p, 'base64url'), pub, Buffer.from(s, 'base64url'))
  console.log(ok ? 'VALID' : 'NOT VALID', ok ? Buffer.from(p, 'base64url').toString() : '')
  process.exit(ok ? 0 : 1)
} else {
  console.log('Commands: keygen | issue | verify  (see the top of this file)')
}
