// Records the promotional video of KDS Lab Desk: node tools/record-promo.mjs  (after npm run build)
// Uses demo mode (invented patients only) and a pretend WhatsApp (KDS_FAKE_WHATSAPP=1), so nothing real is touched or sent.
// Output: promo/KDS-Lab-Desk-promo.mp4 (needs ffmpeg).
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'promo')
const vidDir = mkdtempSync(join(tmpdir(), 'kds-promo-video-'))
const dataDir = mkdtempSync(join(tmpdir(), 'kds-promo-data-'))
mkdirSync(outDir, { recursive: true })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('launching')
const app = await electron.launch({
  args: [root],
  env: { ...process.env, KDS_DATA_DIR: dataDir, KDS_DEMO: '1', KDS_FAKE_WHATSAPP: '1', KDS_FIXED_WINDOW: '1', ELECTRON_RENDERER_URL: '' }
})
console.log('launched')
const page = await app.firstWindow()
console.log('window')
page.setDefaultTimeout(20000)
await page.waitForSelector('[data-testid="nav-today"]')

console.log('ready')
// ---------- on-screen helpers: captions, cursor, cards, patient phone ----------
await page.evaluate(() => {
  const css = document.createElement('style')
  css.textContent = `
  #pcap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);opacity:0;transition:all .35s;z-index:99999;
    background:rgba(28,32,51,.94);color:#fff;font:600 26px 'Segoe UI',sans-serif;padding:14px 30px;border-radius:14px;max-width:1150px;text-align:center;
    box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none}
  #pcap.on{opacity:1;transform:translateX(-50%) translateY(0)}
  #pcur{position:fixed;width:26px;height:26px;border-radius:50%;background:rgba(18,124,150,.35);border:3px solid #127c96;z-index:100000;pointer-events:none;
    transform:translate(-50%,-50%);transition:transform .08s,background .15s;left:-50px;top:-50px}
  #pcur.down{transform:translate(-50%,-50%) scale(.7);background:rgba(194,24,91,.5)}
  #pcard{position:fixed;inset:0;z-index:100001;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#fff;
    background:linear-gradient(135deg,#2b3a8f,#127c96);font-family:'Segoe UI',sans-serif;text-align:center;opacity:0;pointer-events:none;transition:opacity .5s}
  #pcard.on{opacity:1}
  #pcard h1{font:800 64px 'Segoe UI';margin:0;letter-spacing:.03em} #pcard h2{font:500 30px 'Segoe UI';margin:0;opacity:.92} #pcard p{font:400 22px 'Segoe UI';margin:0;opacity:.8}
  #pcard svg{width:130px;height:130px;margin-bottom:6px}
  #pphone{position:fixed;right:34px;top:50%;transform:translateY(-50%) translateX(420px);z-index:99998;width:330px;height:560px;background:#111;border-radius:38px;padding:14px;
    box-shadow:0 20px 60px rgba(0,0,0,.5);transition:transform .6s cubic-bezier(.2,.8,.2,1);font-family:'Segoe UI',sans-serif;pointer-events:none}
  #pphone.on{transform:translateY(-50%) translateX(0)}
  #pphone .scr{background:#e6ddd4;border-radius:26px;height:100%;overflow:hidden;display:flex;flex-direction:column}
  #pphone .hd{background:#075e54;color:#fff;padding:14px 16px;font-weight:700;font-size:17px}
  #pphone .hd small{display:block;font-weight:400;font-size:12px;opacity:.85}
  #pphone .bd{flex:1;padding:14px 10px;display:flex;flex-direction:column;justify-content:flex-start;gap:8px}
  #pphone .msg{background:#dcf8c6;border-radius:10px 10px 2px 10px;padding:8px 10px;align-self:flex-end;max-width:92%;font-size:14px;color:#111;opacity:0;transform:translateY(10px);transition:all .5s}
  #pphone .msg.on{opacity:1;transform:none}
  #pphone .pdf{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.7);border-radius:8px;padding:8px;margin-bottom:6px;font-weight:600;font-size:13px}
  #pphone .pdf b{background:#d93025;color:#fff;border-radius:4px;padding:6px 7px;font-size:11px}
  #pphone .tick{text-align:right;font-size:11px;color:#34b7f1;margin-top:3px}
  #pphone .ill{position:absolute;bottom:20px;left:0;right:0;text-align:center;color:#9aa;font-size:11px}`
  document.head.appendChild(css)
  const mk = (id, html = '') => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d }
  mk('pcap'); const cur = mk('pcur'); mk('pcard')
  mk('pphone', `<div class="scr"><div class="hd">Asha Demo<small>patient’s phone</small></div><div class="bd"><div class="msg" id="pmsg"></div></div><div class="ill">Illustration: the patient’s phone</div></div>`)
  document.addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px' }, true)
  document.addEventListener('mousedown', () => cur.classList.add('down'), true)
  document.addEventListener('mouseup', () => cur.classList.remove('down'), true)
})

const log = (m) => console.log(new Date().toISOString().slice(11, 19), m)
console.log('helpers injected')
const caption = async (text, ms = 0) => {
  if (text) log('caption: ' + text.slice(0, 50))
  await page.evaluate((t) => { const c = document.getElementById('pcap'); if (t) { c.textContent = t; c.classList.add('on') } else c.classList.remove('on') }, text)
  if (ms) await wait(ms)
}
const card = async (h1, h2, p, ms, withLogo = true) => {
  await page.evaluate(([a, b, c, logo]) => {
    const d = document.getElementById('pcard')
    d.innerHTML = (logo ? window.__logo : '') + `<h1>${a}</h1><h2>${b}</h2><p>${c}</p>`
    d.classList.add('on')
  }, [h1, h2, p, withLogo])
  await wait(ms)
  await page.evaluate(() => document.getElementById('pcard').classList.remove('on'))
  await wait(600)
}
await page.evaluate((svg) => { window.__logo = svg }, readFileSync(join(root, 'resources', 'logo.svg'), 'utf8'))

const pos = { x: 700, y: 400 }
const moveTo = async (loc, steps = 28) => {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  const x = b.x + Math.min(b.width / 2, 120), y = b.y + b.height / 2
  await page.mouse.move(x, y, { steps })
  pos.x = x; pos.y = y
  await wait(180)
}
const click = async (loc) => { log('click ' + String(loc).slice(0, 60)); await moveTo(loc); await loc.click(); await wait(350) }
const type = async (loc, text, delay = 55) => { await moveTo(loc, 18); await loc.click(); await loc.fill(''); await loc.pressSequentially(text, { delay }); await wait(150) }
const T = (id) => page.getByTestId(id)

// ---------- screen capture: the app window is photographed ~25 times a second, then ffmpeg joins the photos ----------
await app.evaluate(({ BrowserWindow }, dir) => {
  const req = process.mainModule?.require ?? require
  const fs = req('node:fs')
  const w = BrowserWindow.getAllWindows()[0]
  const rec = (globalThis.__rec = { frames: [], stop: false })
  const loop = async () => {
    if (rec.stop) return
    const t0 = Date.now()
    try {
      const img = await w.webContents.capturePage()
      const f = `${dir}/f${String(rec.frames.length).padStart(6, '0')}.jpg`
      fs.writeFileSync(f, img.toJPEG(90))
      rec.frames.push([f, t0])
    } catch { /* skip a frame */ }
    setTimeout(loop, Math.max(0, 40 - (Date.now() - t0)))
  }
  loop()
}, vidDir.split(String.fromCharCode(92)).join('/'))

// ---------- the story ----------
await page.mouse.move(700, 400)
await card('KDS Lab Desk', 'Pathology reports, made simple', 'K.D.S. Pathology · Computerised Janch Ghar · Dalsingsarai', 4200)

await caption('Your whole day on one screen: who is waiting, who is done', 4200)
await caption('')

// 1. link WhatsApp once
await click(T('nav-settings'))
await caption('Step 1 (only once): link the lab’s WhatsApp, like WhatsApp Web', 1200)
await click(T('wa-link-btn'))
await T('wa-qr').waitFor({ timeout: 15000 })
await caption('Scan this code with the lab phone. That is all.', 3800)
await T('wa-linked').waitFor({ timeout: 20000 })
await caption('✓ WhatsApp is linked. Reports can now go out by themselves.', 2200)
await click(T('wa-auto'))
await caption('Tick “send automatically when approved”', 2000)
await click(T('save-settings'))
await caption('')

// 2. register
await click(T('nav-new'))
await caption('Step 2: register the patient in about 20 seconds', 1600)
await type(T('phone'), '9800012345')
await wait(500)
await T('title').selectOption('Mrs')
await type(T('name'), 'Asha Demo')
await type(T('age-years'), '32')
await type(T('doctor'), 'Self')
await caption('Tick the tests. The bill adds up by itself.', 600)
await click(T('test-CBC'))
await click(T('test-RBS'))
await type(T('paid'), '250')
await wait(900)
await click(T('save-visit'))
await T('sample-id').waitFor()
await caption('A sample number is made for you. Result boxes start empty.', 2600)

// 3. results
await caption('Step 3: type only what the machine shows', 800)
const fillResults = async (list) => { for (const [code, v] of list) await type(T(`in-${code}`), v, 45) }
await fillResults([['hb', '6.5']])
await caption('Dangerous values turn red at once', 2600)
await fillResults([['hb', '9.4'], ['tlc', '13200'], ['neut', '78'], ['lymph', '16'], ['eos', '4'], ['mono', '2'], ['baso', '0']])
await fillResults([['rbc', '3.90'], ['pcv', '29.6'], ['plt', '2.45'], ['rbs', '102']])
await caption('High and low results are flagged. MCV, MCH, MCHC are worked out automatically.', 3600)
await caption('')

// 4. approve
await click(T('approve'))
await caption('Approve once. The report is locked and cannot be changed by mistake.', 1500)
await click(T('confirm-ok'))
await T('approved-view').waitFor()
await T('preview').scrollIntoViewIfNeeded()
await caption('A clear, modern report: colour ranges, trend lines, QR code, doctor’s approval', 4200)
await page.mouse.move(520, 420, { steps: 15 })
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 260); await wait(500) }
await caption('')

// 5. WhatsApp delivery
await caption('…and it is already on its way to the patient’s WhatsApp', 600)
await T('auto-status').waitFor({ timeout: 20000 })
const sent = JSON.parse(readFileSync(join(dataDir, 'fake-whatsapp.log'), 'utf8').trim().split('\n').pop())
await page.evaluate((m) => {
  const msg = document.getElementById('pmsg')
  msg.innerHTML = `<div class="pdf"><b>PDF</b>${m.file}</div>${m.caption.replace(/\n/g, '<br>')}<div class="tick">✓✓</div>`
  document.getElementById('pphone').classList.add('on')
  setTimeout(() => msg.classList.add('on'), 700)
}, sent)
await caption('Delivered on WhatsApp with the PDF attached. No copy and paste.', 5200)
await page.evaluate(() => document.getElementById('pphone').classList.remove('on'))
await caption('')
await wait(700)

// 6. owner overview
await click(T('nav-owner'))
await caption('For the owner: see billing, cash and busy days at a glance', 1500)
await T('overview').waitFor()
await wait(600)
const chart = page.locator('[data-testid="overview"] svg').first()
await chart.scrollIntoViewIfNeeded()
const cb = await chart.boundingBox()
for (const f of [0.78, 0.86, 0.93]) { await page.mouse.move(cb.x + cb.width * f, cb.y + cb.height * 0.5, { steps: 18 }); await wait(900) }
await caption('')
await page.evaluate(() => window.scrollTo(0, 0))
await page.locator('main, .page').first().evaluate((el) => el.scrollTo?.(0, 600)).catch(() => undefined)
await page.mouse.wheel(0, 700)
await caption('Most done tests, who refers patients, money collected and still due', 3800)
await caption('')

// 7. Hindi
await page.mouse.wheel(0, -2000)
await click(T('nav-today'))
await caption('Works in English and Hindi', 800)
await click(T('lang'))
await wait(2600)
await click(T('lang'))
await caption('')

// 8. backup
await click(T('nav-backup'))
await caption('Safe: backs up every night, and to a pen drive in one click', 4200)
await caption('')

await card('KDS Lab Desk', 'Reports ready in minutes. Delivered on WhatsApp.', 'Works offline · Hindi & English · Made for K.D.S. Pathology', 5200)

// ---------- finish ----------
const frames = await app.evaluate(() => { globalThis.__rec.stop = true; return globalThis.__rec.frames })
await app.close()
console.log('frames captured:', frames.length)
const NL = String.fromCharCode(10)
const list = frames.map(([f, ts], i) => 'file ' + JSON.stringify(f).replace(/"/g, "'") + NL + 'duration ' + (((frames[i + 1]?.[1] ?? ts + 40) - ts) / 1000).toFixed(3)).join(NL) + NL + 'file ' + JSON.stringify(frames.at(-1)[0]).replace(/"/g, "'") + NL
const listFile = join(vidDir, 'frames.txt')
writeFileSync(listFile, list)
const mp4 = join(outDir, 'KDS-Lab-Desk-promo.mp4')
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', mp4], { stdio: 'ignore' })
rmSync(vidDir, { recursive: true, force: true })
rmSync(dataDir, { recursive: true, force: true })
console.log('Video written to', mp4)
