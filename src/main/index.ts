import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { audit, openDb } from './db'
import { seedMaster } from './master'
import { makeHandlers, runNightlyIfDue, type Ctx } from './handlers'
import { AppError } from './results'
import { seedDemo } from './demo'
import { getSettings } from './settings'
import { startSyncLoop } from './sync'

app.setName('KDS Lab Desk')
const dataDir = process.env.KDS_DATA_DIR ?? join(app.getPath('appData'), 'KDS Lab Desk')
mkdirSync(dataDir, { recursive: true })
app.setPath('userData', dataDir)

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'KDS Lab Desk',
    backgroundColor: '#f7f8fb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })
  // links in the app open in the normal browser, never inside the lab window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost')) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  const db = openDb(join(dataDir, 'kds.db'))
  seedMaster(db)
  // Lost PIN: start the program once with --reset-pin (see docs/USER-GUIDE.md). Data is untouched; a new PIN can be set in Settings.
  if (process.argv.includes('--reset-pin')) {
    db.run("DELETE FROM settings WHERE key IN ('_pin_owner', '_pin_doctor')")
    audit(db, 'pin.reset', 'settings', null, 'reset from the command line')
  }
  if (process.env.KDS_DEMO === '1' && !db.get('SELECT 1 AS x FROM visits LIMIT 1')) seedDemo(db)

  const ctx: Ctx = { db, dataDir, win: () => win, version: app.getVersion() }
  const handlers = makeHandlers(ctx)

  // One channel per "namespace.method"; errors travel back as data so the screen can show a proper message.
  for (const [ns, methods] of Object.entries(handlers)) {
    for (const [name, fn] of Object.entries(methods as Record<string, (...a: unknown[]) => unknown>)) {
      ipcMain.handle(`${ns}.${name}`, async (_e, ...args: unknown[]) => {
        try {
          return { ok: true, value: await fn(...args) }
        } catch (e) {
          const err = e as Error
          const code = err instanceof AppError ? err.code : 'ERROR'
          if (code === 'ERROR') console.error(`[${ns}.${name}]`, err)
          return { ok: false, code, message: err.message, data: err instanceof AppError ? err.data : undefined }
        }
      })
    }
  }

  createWindow()

  // nightly backup: check when the app opens and then every 20 minutes
  const backupTick = () => {
    try {
      runNightlyIfDue(ctx)
    } catch (e) {
      console.error('nightly backup failed', e)
    }
  }
  setTimeout(backupTick, 20_000)
  setInterval(backupTick, 20 * 60 * 1000)

  startSyncLoop(db, dataDir)

  // auto-update hook: configured, but off until an update URL is set in Settings
  const s = getSettings(db)
  if (s.updates.enabled && s.updates.url) {
    import('electron-updater')
      .then(({ autoUpdater }) => {
        autoUpdater.setFeedURL({ provider: 'generic', url: s.updates.url })
        autoUpdater.autoDownload = true
        autoUpdater.autoInstallOnAppQuit = true
        return autoUpdater.checkForUpdates()
      })
      .catch((e) => console.error('update check failed', e))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
