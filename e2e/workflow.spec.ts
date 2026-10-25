import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './helpers'

// Invented people only. Each test starts a fresh app with its own empty data folder.

const CBC = { hb: '12.4', tlc: '7200', neut: '60', lymph: '32', eos: '3', mono: '4', baso: '1', rbc: '4.4', pcv: '38.5', plt: '2.4' }

async function register(page: Page, name: string, phone: string, tests: string[]) {
  await page.getByTestId('nav-new').click()
  await page.getByTestId('phone').fill(phone)
  await page.getByTestId('name').fill(name)
  await page.getByTestId('title').selectOption('Mrs')
  await page.getByTestId('age-years').fill('30')
  for (const t of tests) await page.getByTestId(`test-${t}`).click()
  await page.getByTestId('save-visit').click()
  await expect(page.getByTestId('sample-id')).toBeVisible()
}
async function fill(page: Page, values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) await page.getByTestId(`in-${k}`).fill(v)
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 5000 })
}

test('identical results for a second patient are blocked until a reason is typed; corrections keep the old version', async () => {
  const { app, page } = await launch()
  try {
    await register(page, 'First Testperson', '9800022222', ['CBC'])
    await fill(page, CBC)
    await page.getByTestId('approve').click()
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('approved-view')).toBeVisible()

    await register(page, 'Second Testperson', '9800033333', ['CBC'])
    await fill(page, CBC)
    await expect(page.getByTestId('dup-alert')).toContainText('exactly the same as sample')
    await page.getByTestId('approve').click()
    await page.getByTestId('confirm-ok').click()
    // the duplicate guard asks for a reason; an empty one cannot be submitted
    await expect(page.getByTestId('prompt-ok')).toBeDisabled()
    await page.getByTestId('prompt-input').fill('Twin brothers, re-read the analyzer')
    await page.getByTestId('prompt-ok').click()
    await expect(page.getByTestId('approved-view')).toBeVisible()

    // correction: needs a reason, creates version 2, keeps version 1 viewable
    await page.getByTestId('correct').click()
    await page.getByTestId('prompt-input').fill('Hb typed wrongly')
    await page.getByTestId('prompt-ok').click()
    await expect(page.getByTestId('entry-view')).toBeVisible()
    await page.getByTestId('in-hb').fill('11.9')
    await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 5000 })
    await page.getByTestId('approve').click()
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('approved-view')).toBeVisible()
    await expect(page.getByTestId('approved-view')).toContainText('v1')
    await expect(page.getByTestId('approved-view')).toContainText('v2')
    await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText('11.9')
    await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText('Corrected report (version 2)')
    await page.getByRole('button', { name: /v1/ }).click()
    await expect(page.getByTestId('approved-view')).toContainText('Older version')
    await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText('12.4')
  } finally {
    await app.close()
  }
})

test('family members share a phone number; search finds people by village; owner reports add up', async () => {
  const { app, page } = await launch()
  try {
    await register(page, 'Mother Familyname', '9800044444', ['RBS'])
    await fill(page, { rbs: '110' })
    await page.getByTestId('approve').click()
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('approved-view')).toBeVisible()

    await page.getByTestId('nav-new').click()
    await page.getByTestId('phone').fill('9800044444')
    await expect(page.getByTestId('person')).toHaveCount(1)
    await page.getByTestId('person-new').click()
    await page.getByTestId('name').fill('Child Familyname')
    await page.getByTestId('title').selectOption('Baby')
    await page.getByTestId('sex').selectOption('F')
    await page.getByTestId('age-years').fill('3')
    await page.getByTestId('village').fill('Sardarganj')
    await page.getByTestId('test-FBS').click()
    await page.getByTestId('paid').fill('20')
    await page.getByTestId('save-visit').click()
    await expect(page.getByTestId('sample-id')).toBeVisible()

    await page.getByTestId('nav-new').click()
    await page.getByTestId('phone').fill('9800044444')
    await expect(page.getByTestId('person')).toHaveCount(2)

    await page.getByTestId('nav-patients').click()
    await page.getByTestId('search').fill('sardarganj')
    await expect(page.getByTestId('person-row')).toHaveCount(1)
    await expect(page.getByTestId('person-row')).toContainText('Child Familyname')

    await page.getByTestId('nav-owner').click()
    await page.getByTestId('tab-dues').click()
    await expect(page.getByTestId('dues-total')).toContainText('80') // 50 + 50 billed, 20 paid
    await page.getByTestId('tab-doctors').click()
    await expect(page.getByTestId('doctor-table')).toContainText('Self')
    await page.getByTestId('tab-pending').click()
    await expect(page.getByText('Registered but not reported (1)')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('settings: PIN, letterhead mode, Hindi labels, test master review', async () => {
  const { app, page } = await launch()
  try {
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('stab-security').click()
    await page.getByTestId('new-pin').fill('4821')
    await page.getByTestId('set-pin').click()
    // leaving and coming back asks for the PIN
    await page.getByTestId('nav-today').click()
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('unlock-pin').fill('0000')
    await page.getByTestId('unlock-ok').click()
    await expect(page.getByTestId('unlock-pin')).toBeVisible()
    await page.getByTestId('unlock-pin').fill('4821')
    await page.getByTestId('unlock-ok').click()
    await expect(page.getByTestId('settings')).toBeVisible()

    await page.getByTestId('stab-master').click()
    await expect(page.getByTestId('master-banner')).toContainText('to be reviewed by Dr. Manoj Kumar')
    await page.getByTestId('reviewed').check()
    await expect(page.getByTestId('master-banner')).toHaveCount(0)
    await page.getByTestId('nav-today').click()
    await expect(page.getByTestId('review-banner')).toHaveCount(0)

    await page.getByTestId('nav-settings').click()
    await page.getByTestId('unlock-pin').fill('4821')
    await page.getByTestId('unlock-ok').click()
    await page.getByTestId('letterhead').check()
    await page.getByTestId('save-settings').click()

    await page.getByTestId('lang').click()
    await expect(page.getByTestId('nav-new')).toContainText('नया मरीज़')
    await page.getByTestId('lang').click()
    await expect(page.getByTestId('nav-new')).toContainText('New patient')
  } finally {
    await app.close()
  }
})

test('master range edit applies to new reports only', async () => {
  const { app, page } = await launch()
  try {
    await register(page, 'Before Edit', '9800055555', ['CBC'])
    await fill(page, CBC)
    await page.getByTestId('approve').click()
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('approved-view')).toBeVisible()

    await page.getByTestId('nav-settings').click()
    await page.getByTestId('stab-master').click()
    await page.getByTestId('mp-CBC').click()
    const hb = page.getByTestId('pe-hb')
    await hb.getByTestId('range-low').nth(1).fill('13')
    await hb.getByTestId('save-param').click()
    await page.getByTestId('prompt-input').fill('Matches the analyzer kit insert')
    await page.getByTestId('prompt-ok').click()
    await expect(page.getByText('old reports stay as printed')).toBeVisible()

    // new report uses the new range ...
    await register(page, 'After Edit', '9800066666', ['CBC'])
    await expect(page.getByTestId('row-hb')).toContainText('13')
    // ... the earlier approved report still prints its original range
    await page.getByTestId('nav-patients').click()
    await page.getByTestId('search').fill('Before Edit')
    await expect(page.getByTestId('person-row')).toHaveCount(1)
    await page.getByTestId('person-row').first().click()
    await page.getByTestId('visit-row').first().click()
    await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText('11.5')
  } finally {
    await app.close()
  }
})

test('backup, restore and import through the real screens', async () => {
  const { app, page, dataDir } = await launch({ demo: true })
  try {
    // import: a folder with one invented Word-less text file is listed as "could not be read", not dropped
    const folder = join(dataDir, 'old-reports')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'broken.doc'), 'not a word file')
    await page.getByTestId('nav-import').click()
    await page.getByTestId('import-folder').fill(folder)
    await page.getByTestId('import-run').click()
    await expect(page.getByTestId('import-summary')).toBeVisible()
    await expect(page.getByText('broken.doc')).toBeVisible()

    // backup to a "pen drive" folder through the API (the folder dialog is native)
    const pen = join(dataDir, 'pen')
    const made = await page.evaluate((p) => (window as any).kds.invoke('backup.toFolder', p), pen)
    expect((made as { ok: boolean }).ok).toBe(true)
    const validated = await page.evaluate((p) => (window as any).kds.invoke('backup.validate', p), (made as { value: string }).value)
    expect((validated as { value: { ok: boolean; info: { visits: number } } }).value.ok).toBe(true)
    expect((validated as { value: { info: { visits: number } } }).value.info.visits).toBeGreaterThan(5)
    await page.getByTestId('nav-backup').click()
    await expect(page.getByTestId('backup')).toContainText('Last pen-drive backup')
    expect(existsSync(pen)).toBe(true)
  } finally {
    await app.close()
  }
})
