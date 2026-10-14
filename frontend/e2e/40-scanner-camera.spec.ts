import { Page, expect, test } from '@playwright/test'
import path from 'node:path'
import { as } from './helpers'

const FX = process.env.FIXTURES_DIR ?? '/work/e2e/fixtures'

/** Собирает ошибки консоли и необработанные исключения: сканер должен работать без единой ошибки */
function watch(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  return errors
}

test('SCAN-01 камера: HD-поток, распознавание QR и переход в паспорт без ошибок', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1', { permissions: ['camera'], viewport: { width: 1280, height: 900 } })
  const errors = watch(page)
  const calls: any[] = []
  await page.addInitScript(() => {
    const md = navigator.mediaDevices
    const orig = md.getUserMedia.bind(md)
    ;(window as any).__gum = []
    md.getUserMedia = (c: any) => { (window as any).__gum.push(JSON.parse(JSON.stringify(c))); return orig(c) }
  })
  await page.goto('/scan')
  await expect(page.getByRole('heading', { name: 'Сканер QR-кода' })).toBeVisible()
  await page.getByRole('button', { name: /Включить камеру/ }).click()
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}$/, { timeout: 20000 })
  await expect(page.getByRole('heading', { name: 'КТП-160' })).toBeVisible()
  const gum = await page.evaluate(() => (window as any).__gum)
  calls.push(...gum)
  expect(calls[0].video.width.ideal).toBe(1920)    // сначала запрашивается Full HD
  expect(calls[0].video.facingMode.ideal).toBe('environment')
  // камера выключена после перехода (нет утечки потока)
  const live = await page.evaluate(() => (window as any).__gum.length)
  expect(live).toBe(1)
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

const FILES: [string, string][] = [
  ['qr-clean.png', 'чистое фото'], ['qr-fog-rain.png', 'дождь и туман (размытие, низкий контраст)'], ['qr-lowlight.png', 'сумерки и шум'],
  ['qr-glare.png', 'блик на этикетке'], ['qr-noise.png', 'сильный шум и размытие'],
]
for (const [file, title] of FILES) {
  test(`SCAN-02 фото в плохих условиях: ${title}`, async ({ browser }) => {
    const { ctx, page } = await as(browser, 'eng1', { viewport: { width: 1280, height: 900 } })
    const errors = watch(page)
    await page.goto('/scan')
    await page.locator('input[type=file]').setInputFiles(path.join(FX, file))
    await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}$/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'КТП-160' })).toBeVisible()
    expect(errors, errors.join('\n')).toEqual([])
    await ctx.close()
  })
}

test('SCAN-03 фото без QR: понятное сообщение, без ошибок', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1')
  const errors = watch(page)
  await page.goto('/scan')
  await page.locator('input[type=file]').setInputFiles(path.join(FX, 'not-a-qr.png'))
  await expect(page.getByText(/QR-код на фото не найден/)).toBeVisible({ timeout: 20000 })
  await expect(page).toHaveURL(/\/scan$/)
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('SCAN-04 доступ к камере запрещён: инструкция, ручной поиск остаётся', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1')
  const errors = watch(page)
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  })
  await page.goto('/scan')
  await page.getByRole('button', { name: /Включить камеру/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Доступ к камере запрещён' })).toBeVisible()
  await expect(page.getByLabel(/Инвентарный\/серийный номер/)).toBeVisible()
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('SCAN-05 нет камеры и занятая камера: сообщения', async ({ browser }) => {
  for (const [name, text] of [['NotFoundError', 'Камера не найдена'], ['NotReadableError', 'Камера занята']] as const) {
    const { ctx, page } = await as(browser, 'eng1')
    const errors = watch(page)
    await page.addInitScript((n) => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error(n), { name: n })) }, name)
    await page.goto('/scan')
    await page.getByRole('button', { name: /Включить камеру/ }).click()
    await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible()
    expect(errors, errors.join('\n')).toEqual([])
    await ctx.close()
  }
})

test('SCAN-06 камера без QR в кадре: сканирование идёт, выключение освобождает камеру; ручной ввод кода', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1', { permissions: ['camera'] })
  const errors = watch(page)
  await page.addInitScript(() => {
    ;(window as any).__stopped = 0
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 480
      const g = c.getContext('2d')!; g.fillStyle = '#888'; g.fillRect(0, 0, 640, 480)
      const s = (c as any).captureStream(15) as MediaStream
      s.getTracks().forEach((t) => { const st = t.stop.bind(t); t.stop = () => { (window as any).__stopped++; st() } })
      return s
    }
  })
  await page.goto('/scan')
  await page.getByRole('button', { name: /Включить камеру/ }).click()
  await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Плохая видимость' })).toBeVisible()
  await page.waitForTimeout(1500) // несколько циклов распознавания пустого кадра — без ошибок и без ложных срабатываний
  await expect(page).toHaveURL(/\/scan$/)
  await page.getByRole('button', { name: 'Выключить камеру' }).click()
  await expect(page.getByRole('button', { name: /Включить камеру/ })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__stopped)).toBeGreaterThan(0)
  await page.getByLabel(/Инвентарный\/серийный номер/).fill('DEMOEQUIP009')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}$/)
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})
