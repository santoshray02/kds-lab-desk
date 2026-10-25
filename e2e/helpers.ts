import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Launched {
  app: ElectronApplication
  page: Page
  dataDir: string
}

export async function launch(opts: { demo?: boolean; dataDir?: string } = {}): Promise<Launched> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'kds-e2e-'))
  const app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, KDS_DATA_DIR: dataDir, KDS_DEMO: opts.demo ? '1' : '0', ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForSelector('[data-testid="nav-today"]')
  return { app, page, dataDir }
}
