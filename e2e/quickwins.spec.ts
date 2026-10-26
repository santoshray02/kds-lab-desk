import { expect, test, type Page } from '@playwright/test'
import { launch } from './helpers'

// Invented names and numbers only.
const call = async (page: Page, ch: string, ...args: unknown[]) => {
  const r = (await page.evaluate(([c, a]) => (window as any).kds.invoke(c as string, ...(a as unknown[])), [ch, args] as const)) as { ok: boolean; value: any; message?: string }
  if (!r.ok) throw new Error(`${ch}: ${r.message}`)
  return r.value
}

test('package, UPI and cash, receipt, commission, expenses, cash closing', async () => {
  const { app, page } = await launch()
  try {
    const pkgs = (await call(page, 'packages.list')) as { id: number; name: string; price: number }[]
    const fever = pkgs.find((p) => p.name === 'Fever panel')!
    expect(fever).toBeTruthy()

    // register from a package, paying part by UPI
    await page.getByTestId('nav-new').click()
    await page.getByTestId('title').selectOption('Mr')
    await page.getByTestId('name').fill('Pawan Package')
    await page.getByTestId('age-years').fill('36')
    await page.getByTestId('doctor').fill('Dr. Test Rao')
    await page.getByTestId(`pkg-${fever.id}`).click()
    await expect(page.getByTestId('total')).toContainText(fever.price.toLocaleString('en-IN'))
    await page.getByTestId('paid').fill('100')
    await page.getByTestId('pay-method').selectOption('upi')
    await page.getByTestId('save-visit').click()

    // the bill card shows the package, the payment and what is due
    const bill = page.getByTestId('bill-card')
    await expect(bill).toContainText('Fever panel')
    await expect(bill).toContainText('UPI')
    await expect(page.getByTestId('bill-due')).toContainText(String(fever.price - 100))
    const visitId = Number((await call(page, 'visits.list', { limit: 1 }))[0].id)
    const html = await call(page, 'bill.receiptHtml', visitId)
    expect(html).toContain('Package: Fever panel')
    expect(html).toContain('Pawan Package')

    // receive the rest in cash
    await page.getByTestId('receive-open').click()
    await page.getByTestId('receive-amount').fill('50')
    await page.getByTestId('receive-method').selectOption('cash')
    await page.getByTestId('receive-save').click()
    await expect(page.getByTestId('bill-due')).toContainText(String(fever.price - 150))

    // doctor commission: set a rate, see it earned
    await page.getByTestId('nav-owner').click()
    await page.getByTestId('tab-commission').click()
    await page.getByTestId('rate-input').first().fill('10')
    await page.getByTestId('rate-save').click()
    await expect(page.getByTestId('commission-table')).toContainText('Dr. Test Rao')
    const earned = Math.round(fever.price * 0.1 * 100) / 100
    await expect(page.getByTestId('commission-table')).toContainText(String(earned).replace(/\.0+$/, ''))

    // expenses and closing the cash: 50 cash in, 20 out = 30 expected
    await page.getByTestId('tab-cash').click()
    await page.getByTestId('exp-amount').fill('20')
    await page.getByTestId('exp-add').click()
    await expect(page.getByTestId('expense-table')).toContainText('20')
    await expect(page.getByTestId('expected-cash')).toContainText('30')
    await page.getByTestId('counted').fill('30')
    await page.getByTestId('close-day').click()
    await expect(page.getByTestId('cash-diff')).toContainText('matches')

    await page.getByTestId('tab-export').click()
    await expect(page.getByTestId('export-save')).toBeEnabled()
  } finally {
    await app.close()
  }
})

test('two records of one person can be merged', async () => {
  const { app, page } = await launch()
  try {
    const make = (phone: string) => call(page, 'visits.create', {
      patient: { name: 'Dup Person', title: 'Mr', sex: 'M', phone, village: 'Testpur' }, age: { years: 30, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['CBC']
    })
    const a = await make('')
    const b = await make('9800000055')
    expect(a.patientId).not.toBe(b.patientId)
    await page.getByTestId('nav-patients').click()
    await page.getByTestId('tab-dups').click()
    await expect(page.getByTestId('dup-pair')).toHaveCount(1)
    await page.getByTestId('keep-this').first().click()
    await page.getByRole('button', { name: 'Yes, merge' }).click()
    await expect(page.getByTestId('dup-pair')).toHaveCount(0)
    const rows = await call(page, 'patients.search', 'Dup Person')
    expect(rows).toHaveLength(1)
    expect(rows[0].visitCount).toBe(2)
    expect(rows[0].phone).toBe('9800000055') // the missing phone number was filled in
  } finally {
    await app.close()
  }
})

test('settings: receipt, stickers and money have defaults, can be changed, and can be put back', async () => {
  const { app, page } = await launch()
  try {
    const s0 = await call(page, 'settings.get')
    expect(s0.receipt.style).toBe('a4')
    expect(s0.labels).toMatchObject({ widthMm: 50, heightMm: 25, copies: 2, code: 'barcode', enabled: true })
    expect(s0.money).toMatchObject({ commission: true, commissionBasis: 'billed', expenses: true })
    expect(s0.packages).toBe(true)

    await page.getByTestId('nav-settings').click()
    await page.getByTestId('stab-quick').click()
    await page.getByTestId('receipt-style').selectOption('thermal')
    await page.getByTestId('label-code').selectOption('qr')
    await page.getByTestId('money-expenses').uncheck()
    await page.getByTestId('quick-save').click()
    await expect.poll(async () => (await call(page, 'settings.get')).receipt.style).toBe('thermal')
    const s1 = await call(page, 'settings.get')
    expect(s1.labels.code).toBe('qr')
    expect(s1.money.expenses).toBe(false)

    // a switched-off tool disappears from Reports
    await page.getByTestId('nav-owner').click()
    await expect(page.getByTestId('tab-cash')).toHaveCount(0)
    await expect(page.getByTestId('tab-commission')).toHaveCount(1)

    // put the usual values back
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('stab-quick').click()
    await page.getByTestId('quick-reset').click()
    await page.getByRole('button', { name: 'Yes, put them back' }).click()
    await page.getByTestId('quick-save').click()
    await expect.poll(async () => (await call(page, 'settings.get')).receipt.style).toBe('a4')
    expect((await call(page, 'settings.get')).money.expenses).toBe(true)
  } finally {
    await app.close()
  }
})

test('payment QR: set the UPI ID, show the QR, record the payment as UPI', async () => {
  const { app, page } = await launch()
  try {
    expect((await call(page, 'settings.get')).payQr).toMatchObject({ enabled: false, upiId: '', onReceipt: 'whenDue', withAmount: true })

    // a wrong UPI ID cannot be saved
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('stab-quick').click()
    await page.getByTestId('payqr-enabled').check()
    await page.getByTestId('payqr-upi').fill('not a upi id')
    await expect(page.getByTestId('quick-save')).toBeDisabled()
    await page.getByTestId('payqr-upi').fill('kdspathology@okaxis')
    await expect(page.getByTestId('quick-save')).toBeEnabled()
    await page.getByTestId('quick-save').click()
    await expect.poll(async () => (await call(page, 'settings.get')).payQr.upiId).toBe('kdspathology@okaxis')

    const v = await call(page, 'visits.create', { patient: { name: 'Qr Person', title: 'Mr', sex: 'M', phone: '', village: '' }, age: { years: 30, months: 0, days: 0 }, doctor: 'Self', panelCodes: ['CBC'], paid: 50 })
    const html = await call(page, 'bill.receiptHtml', v.visitId)
    expect(html).toContain('Pay ₹150 by UPI')

    await page.getByTestId('nav-patients').click()
    await page.getByTestId('search').fill('Qr Person')
    await page.getByTestId('person-row').first().click()
    await page.locator('table tbody tr').first().click()
    await page.getByTestId('show-pay-qr').click()
    await expect(page.getByTestId('pay-qr-image').locator('svg')).toBeVisible()
    await page.getByTestId('pay-qr-amount').fill('100')
    await page.getByTestId('pay-qr-received').click()
    await expect(page.getByTestId('bill-due')).toContainText('50')
    await expect(page.getByTestId('bill-card')).toContainText('UPI')
    const g = await call(page, 'visits.get', v.visitId)
    expect(g.payments.map((p: any) => [p.amount, p.method])).toEqual([[50, 'cash'], [100, 'upi']])
  } finally {
    await app.close()
  }
})

test('home collection: register with an address, see it on Today, mark collected, then give money back', async () => {
  const { app, page } = await launch()
  try {
    await page.getByTestId('nav-new').click()
    await page.getByTestId('title').selectOption('Mrs')
    await page.getByTestId('name').fill('Hema Home')
    await page.getByTestId('age-years').fill('52')
    await page.getByTestId('village').fill('Rampur')
    await page.getByTestId('test-CBC').click()
    await page.getByTestId('test-ESR').click()
    await page.getByTestId('home-on').check()
    await expect(page.getByTestId('home-address')).toHaveValue('Rampur') // taken from the village
    await page.getByTestId('home-address').fill('Near the temple, Rampur')
    await page.getByTestId('home-time').fill('morning 7 to 9')
    await page.getByTestId('home-collector').fill('Sunil')
    await page.getByTestId('home-fee').fill('40')
    await expect(page.getByTestId('total')).toContainText('300') // 200 + 60 + 40
    await page.getByTestId('paid').fill('100')
    await page.getByTestId('save-visit').click()

    await expect(page.getByTestId('home-info')).toContainText('Near the temple, Rampur')
    await expect(page.getByTestId('home-info')).toContainText('Not collected yet')
    await expect(page.getByTestId('bill-due')).toContainText('200')

    // the job is on Today until the sample is collected
    await page.getByTestId('nav-today').click()
    await expect(page.getByTestId('home-job')).toHaveCount(1)
    await expect(page.getByTestId('home-jobs')).toContainText('Hema Home')
    await page.getByTestId('home-collected').click()
    await expect(page.getByTestId('home-jobs')).toHaveCount(0)

    // give money back and lower the bill with it
    await page.getByTestId('visit-row').first().click()
    await expect(page.getByTestId('home-info')).toContainText('Collected')
    await page.getByTestId('refund-open').click()
    await page.getByTestId('refund-amount').fill('30')
    await page.getByTestId('refund-reason').fill('ESR not done')
    await page.getByTestId('refund-save').click()
    await expect(page.getByTestId('refund-form')).toHaveCount(0)
    await expect(page.getByTestId('bill-due')).toContainText('200') // bill 270 - (100 paid - 30 refunded) = 200
    const id = Number((await call(page, 'visits.list', { limit: 1 }))[0].id)
    const g = await call(page, 'visits.get', id)
    expect(g.visit.total).toBe(270)
    expect(g.payments.map((p: any) => p.amount)).toEqual([100, -30])
    expect(await call(page, 'bill.receiptHtml', id)).toContain('Home collection charge')
  } finally {
    await app.close()
  }
})
