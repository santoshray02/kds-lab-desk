// Supervisor: runs index.mjs and starts it again whenever it stops, for any reason (crash, kill, out of memory).
// Waits 1 s, then longer after repeated quick failures (up to 30 s). Logs go to gateway.log (kept under 5 MB).
// Stop it for real with Ctrl+C or by ending this process.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const logFile = join(here, 'gateway.log')
const stamp = () => new Date().toISOString()

function log(line) {
  try {
    if (existsSync(logFile) && statSync(logFile).size > 5_000_000) renameSync(logFile, logFile + '.old')
    appendFileSync(logFile, line.endsWith('\n') ? line : line + '\n')
  } catch { /* a full disk must not stop the supervisor */ }
  process.stdout.write(line.endsWith('\n') ? line : line + '\n')
}

let child = null
let wantStop = false
let delay = 1000

function run() {
  const started = Date.now()
  child = spawn(process.execPath, ['--max-old-space-size=256', join(here, 'index.mjs')], { cwd: here, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => log(String(d).trimEnd()))
  child.stderr.on('data', (d) => log(String(d).trimEnd()))
  child.on('error', (e) => log(`${stamp()} supervisor: could not start: ${e.message}`))
  child.on('exit', (code, signal) => {
    child = null
    if (wantStop) return process.exit(0)
    if (code === 78) { log(`${stamp()} supervisor: configuration error (see above). Fix it and start again.`); return process.exit(78) }
    delay = Date.now() - started > 60_000 ? 1000 : Math.min(30_000, delay * 2)
    log(`${stamp()} supervisor: gateway stopped (code ${code ?? signal}); starting again in ${delay / 1000} s`)
    setTimeout(run, delay)
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { wantStop = true; child ? child.kill('SIGTERM') : process.exit(0) })
}
process.on('uncaughtException', (e) => log(`${stamp()} supervisor error: ${e.message}`))
run()
