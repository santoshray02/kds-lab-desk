import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './helpers'

// Everything here uses invented names and numbers only.
test('register → enter → approve → PDF', async () => {
  const { app, page, dataDir } = await launch()
  try {
    // first run: the "to be reviewed" banner is visible
    await expect(page.getByTestId('review-banner')).toContainText('Defaults — to be reviewed by Dr. Manoj Kumar')

    await page.getByTestId('nav-new').click()
    await page.getByTestId('phone').fill('9800011111')
    await page.getByTestId('title').selectOption('Mrs')
    await page.getByTestId('name').fill('Testa Kumari')
    await expect(page.getByTestId('sex')).toHaveValue('F')
    await page.getByTestId('age-years').fill('34')
    await page.getByTestId('doctor').fill('Dr. A. Kumar')
    await page.getByTestId('test-CBC').click()
    await page.getByTestId('test-RBS').click()
    await page.getByTestId('paid').fill('250')
    await expect(page.getByTestId('total')).toContainText('250')
    await page.getByTestId('save-visit').click()

    // results screen starts empty; sample ID has the YYMM-NNN form
    await expect(page.getByTestId('sample-id')).toHaveText(/^\d{4}-001$/)
    await expect(page.getByTestId('in-hb')).toHaveValue('')

    const type = async (code: string, v: string) => page.getByTestId(`in-${code}`).fill(v)
    await type('hb', '9.4'); await type('tlc', '13200')
    await type('neut', '78'); await type('lymph', '16'); await type('eos', '4'); await type('mono', '2'); await type('baso', '0')
    await type('rbc', '3.90'); await type('pcv', '29.6'); await type('plt', '2.45'); await type('rbs', '102')

    // flags and auto calculations appear instantly
    await expect(page.getByTestId('flag-hb')).toHaveText('L')
    await expect(page.getByTestId('flag-tlc')).toHaveText('H')
    await expect(page.getByTestId('in-mcv')).toHaveAttribute('placeholder', '75.9')

    // implausible value is rejected and approval is disabled
    await type('hb', '105')
    await expect(page.getByTestId('error-alert').first()).toBeVisible()
    await expect(page.getByTestId('approve')).toBeDisabled()
    await type('hb', '9.4')
    await expect(page.getByTestId('approve')).toBeEnabled()
    await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 5000 })

    await page.getByTestId('approve').click()
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('approved-view')).toBeVisible()
    await expect(page.getByTestId('preview')).toBeVisible()

    // the report preview carries the lab text, the abnormal flag and the signatures
    const frame = page.frameLocator('[data-testid="preview"]')
    await expect(frame.locator('body')).toContainText('K.D.S. PATHOLOGY')
    await expect(frame.locator('body')).toContainText('9.4 L')
    await expect(frame.locator('body')).toContainText('Dr. Manoj Kumar')
    await expect(frame.locator('body')).toContainText('Ram Vivek Kumar')
    await expect(frame.locator('body')).toContainText('Not valid for medico legal purpose')

    // PDF was produced on approval and is a real PDF
    const pdfDir = join(dataDir, 'pdf')
    await expect.poll(() => existsSync(pdfDir), { timeout: 15000 }).toBe(true)
    const result = await page.evaluate(() => (window as any).kds.invoke('report.pdf', 1))
    const pdfPath = (result as { value: string }).value
    expect(statSync(pdfPath).size).toBeGreaterThan(5000)
    expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-')

    // approved report is locked: saving through the API is refused
    const locked = await page.evaluate(() => (window as any).kds.invoke('results.save', 1, { hb: '12' }))
    expect((locked as { ok: boolean; code: string }).code).toBe('LOCKED')
  } finally {
    await app.close()
  }
})
