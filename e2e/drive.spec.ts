import { expect, test } from '@playwright/test'
import { launch } from './helpers'

// Google sign-in cannot be driven here (no real Google account), so this checks the screen and the safe defaults.
test('Backup screen: Google Drive card offers Connect, needs a matching password, and does nothing before connecting', async () => {
  const { app, page } = await launch({ demo: true })
  try {
    await page.getByTestId('nav-backup').click()
    const card = page.getByTestId('drive-card')
    await expect(card).toContainText('Backup to Google Drive')
    // available only when the build has the Google client ID and secret (src/shared/google.local.json)
    const st = (await page.evaluate(() => (window as any).kds.invoke('drive.status'))) as { value: { available: boolean; connected: boolean } }
    expect(st.value.connected).toBe(false)
    if (!st.value.available) {
      await expect(card).toContainText('not set up in this version')
    } else {
      const connect = page.getByTestId('drive-connect')
      await expect(connect).toBeDisabled()
      await page.getByTestId('drive-pw').fill('lab-secret-1')
      await page.getByTestId('drive-pw2').fill('different')
      await expect(connect).toBeDisabled()
      await page.getByTestId('drive-pw2').fill('lab-secret-1')
      await expect(connect).toBeEnabled()
    }
    // nothing may be uploaded before anyone connects
    const r = (await page.evaluate(() => (window as any).kds.invoke('drive.backupNow'))) as { ok: boolean }
    expect(r.ok).toBe(false)
  } finally {
    await app.close()
  }
})
