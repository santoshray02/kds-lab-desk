import { expect, test } from '@playwright/test'
import { launch } from './helpers'

// Google sign-in cannot be driven here (no real Google account), so this checks the screen and the safe default.
test('Backup screen: the Google Drive card says it is not set up until a Google client ID is added', async () => {
  const { app, page } = await launch({ demo: true })
  try {
    await page.getByTestId('nav-backup').click()
    await expect(page.getByTestId('drive-card')).toContainText('Backup to Google Drive')
    await expect(page.getByTestId('drive-card')).toContainText('not set up in this version')
    await expect(page.getByTestId('drive-connect')).toHaveCount(0)
    const st = await page.evaluate(() => (window as any).kds.invoke('drive.status'))
    expect((st as any).value).toMatchObject({ available: false, connected: false })
    // nothing Google-related may exist on disk before anyone connects
    const r = await page.evaluate(() => (window as any).kds.invoke('drive.backupNow'))
    expect((r as any).ok).toBe(false)
  } finally {
    await app.close()
  }
})
