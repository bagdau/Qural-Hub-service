import { expect, test } from '@playwright/test'
import { as } from './helpers'

// Адрес стенда — http, не localhost: контекст небезопасный, getUserMedia недоступен (как у телефона в локальной сети без HTTPS)
test('SCAN-07 без HTTPS: камера отключена с объяснением, фото-режим и поиск работают', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/scan')
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
  await page.getByRole('button', { name: /Включить камеру/ }).click()
  const dlg = page.getByRole('dialog', { name: 'Камера недоступна без HTTPS' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('link', { name: /Открыть по HTTPS/ })).toHaveAttribute('href', /^https:\/\/[^/]+:8443\/scan$/)
  await dlg.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('button', { name: /Снять фото QR/ })).toBeEnabled()
  await page.locator('input[type=file]').setInputFiles('e2e/fixtures/qr-clean.png')
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}$/, { timeout: 20000 })
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})
