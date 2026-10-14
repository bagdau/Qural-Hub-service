import { expect, test } from '@playwright/test'
import { writeFileSync, readFileSync } from 'node:fs'
import { as } from './helpers'

test('QR-01 у каждого оборудования в реестре есть кнопка QR; страница QR открывается', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1440, height: 900 } })
  await page.goto('/equipment')
  await expect(page.getByRole('link', { name: /Трансформатор ТМ-1000/ }).first()).toBeVisible()
  const rows = await page.locator('tbody tr').count()
  const qrLinks = await page.getByRole('link', { name: /^QR-код:/ }).count()
  expect(rows).toBe(10)
  expect(qrLinks).toBe(rows)
  await page.getByRole('link', { name: /^QR-код: Трансформатор ТМ-1000/ }).click()
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}\/qr$/)
  await expect(page.getByRole('heading', { name: 'QR-код оборудования' })).toBeVisible()
  const img = page.getByRole('img', { name: /QR-код: Трансформатор ТМ-1000\/10, инвентарный номер DM-TR-0001/ })
  await expect(img).toBeVisible()
  expect(await img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 100)).toBe(true)
  await page.screenshot({ path: 'artifacts/screens/qr-page.png', fullPage: true })
  // из паспорта тоже есть кнопка QR-код
  await page.getByRole('link', { name: 'Оборудование', exact: true }).first().click()
  await page.getByRole('link', { name: /Трансформатор ТМ-1000/ }).first().click()
  await page.getByRole('link', { name: /QR-код/ }).first().click()
  await expect(page).toHaveURL(/\/qr$/)
  await ctx.close()
})

test('QR-02 печать (диалог браузера), стили печати и сохранение PDF/PNG/SVG/паспорта', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1440, height: 900 } })
  await page.goto('/equipment?q=DM-TR-0001')
  await page.getByRole('link', { name: /^QR-код:/ }).first().click()
  await expect(page.getByTestId('print-sheet')).toBeVisible()
  // стандартная печать браузера
  await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++ } })
  await page.getByRole('button', { name: /Печать/ }).click()
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1)
  // печатная версия: интерфейс скрыт, остаётся только этикетка
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(page.getByRole('button', { name: /Печать/ })).toBeHidden()
  await expect(page.getByTestId('print-sheet')).toBeVisible()
  const pdf = await page.pdf({ format: 'A4' })
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  expect(pdf.length).toBeGreaterThan(5000)
  await page.emulateMedia({ media: 'screen' })
  // сохранение PDF-этикетки
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Сохранить PDF/ }).click()])
  expect(dl.suggestedFilename()).toBe('qr-DM-TR-0001.pdf')
  const p = await dl.path()
  expect(readFileSync(p!).subarray(0, 4).toString()).toBe('%PDF')
  // PNG, SVG, паспорт
  const hrefs = await page.locator('a.btn').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')))
  expect(hrefs.some((h) => h?.includes('format=png') && h.includes('download=1'))).toBe(true)
  expect(hrefs.some((h) => h?.includes('format=svg') && h.includes('download=1'))).toBe(true)
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Паспорт PDF/ }).click()])
  expect(dl2.suggestedFilename()).toBe('passport-DM-TR-0001.pdf')
  expect(readFileSync((await dl2.path())!).subarray(0, 4).toString()).toBe('%PDF')
  // выбор формата меняет ссылку на PDF
  await page.getByLabel('Формат этикетки (PDF)').selectOption('sticker50x30')
  await expect(page.getByRole('link', { name: /Открыть PDF/ })).toHaveAttribute('href', /layout=sticker50x30/)
  await ctx.close()
})

test('QR-03 круг «генератор → сканер»: скачанный PNG распознаётся сканером и ведёт в тот же паспорт', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1440, height: 900 } })
  await page.goto('/equipment?q=DL-KTP-0002')
  await page.getByRole('link', { name: /^QR-код:/ }).first().click()
  const id = page.url().match(/equipment\/([0-9a-f-]{36})\/qr/)![1]
  for (const ec of ['m', 'q', 'h']) {
    const r = await page.request.get(`/api/v1/equipment/${id}/qr?format=png&size=10&ec=${ec}`)
    expect(r.status()).toBe(200)
    const file = `artifacts/out/qr-${ec}.png`
    writeFileSync(file, await r.body())
    await page.goto('/scan')
    await page.locator('input[type=file]').setInputFiles(file)
    await expect(page).toHaveURL(new RegExp(`/equipment/${id}$`), { timeout: 20000 })
    await page.goto(`/equipment/${id}/qr`)
  }
  await ctx.close()
})

test('QR-04 генератор: выбор оборудования, предпросмотр, PDF; клиенту генератор недоступен', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1440, height: 900 } })
  await page.goto('/generator')
  await expect(page.getByRole('heading', { name: 'Генератор QR и документов' })).toBeVisible()
  await expect(page.getByTestId('gen-count')).toHaveText('0')
  await page.getByLabel('Выбрать Трансформатор ТМ-1000/10').check()
  await page.getByLabel('Выбрать КТП-2 400 кВА').check()
  await expect(page.getByTestId('gen-count')).toHaveText('2')
  const frame = page.locator('iframe[title="Предпросмотр PDF"]')
  await expect(frame).toHaveAttribute('src', /qr-labels\.pdf\?ids=.+layout=sheet8/)
  await page.getByLabel('Формат', { exact: true }).selectOption('label100x70')
  await expect(frame).toHaveAttribute('src', /layout=label100x70/)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Сохранить PDF/ }).click()])
  expect(dl.suggestedFilename()).toBe('qr-labels.pdf')
  expect(readFileSync((await dl.path())!).subarray(0, 4).toString()).toBe('%PDF')
  await page.screenshot({ path: 'artifacts/screens/generator.png', fullPage: true })
  await ctx.close()

  const c = await as(browser, 'cl1')
  await c.page.goto('/equipment')
  await expect(c.page.getByRole('link', { name: /^QR-код:/ }).first()).toBeVisible()
  await expect(c.page.getByRole('link', { name: 'Генератор QR' })).toHaveCount(0)
  const r = await c.page.request.get('/api/v1/equipment/qr-labels.pdf?ids=00000000-0000-0000-0000-000000000000')
  expect(r.status()).toBe(403)
  await c.ctx.close()
})
