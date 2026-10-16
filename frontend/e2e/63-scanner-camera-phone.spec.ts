import { expect, test } from '@playwright/test'
import { as } from './helpers'

// Сканер в «банковском» виде: камера на весь экран телефона. Адрес стенда localhost (безопасный контекст), камера подменена видеофайлом.
test('SCAN-08 телефон: камера на весь экран с рамкой, кнопками и закрытием', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1', { permissions: ['camera'], viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  // «пустой» кадр без QR: интерфейс проверяется детерминированно, распознавание не уводит со страницы
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720
      const g = c.getContext('2d')!
      setInterval(() => { g.fillStyle = '#556'; g.fillRect(0, 0, 1280, 720) }, 100)
      return c.captureStream(10)
    }
  })
  await page.goto('/scan')
  await expect(page.getByRole('button', { name: /Включить камеру/ })).toBeVisible()
  const idle = await page.locator('.viewfinder').boundingBox()
  expect(idle!.width).toBeGreaterThan(300)
  await page.getByRole('button', { name: /Включить камеру/ }).click()
  await page.getByRole('dialog', { name: 'Разрешить доступ к камере?' }).getByRole('button', { name: /Разрешить камеру/ }).click()
  await expect(page.locator('.scanner.immersive')).toHaveCount(1)
  const box = await page.locator('.scanner.immersive').boundingBox()
  expect(box!.width).toBe(390); expect(box!.height).toBe(800)               // на весь экран
  await expect(page.locator('.vf-frame')).toBeVisible()
  const f = (await page.locator('.vf-frame').boundingBox())!
  expect(Math.abs(f.x + f.width / 2 - 195)).toBeLessThan(2)                  // рамка по центру
  expect(f.width).toBeGreaterThan(220)
  await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Фото/ })).toBeVisible()
  await page.screenshot({ path: 'artifacts/screens/mobile-scanner.png' })
  await page.getByRole('button', { name: 'Выключить камеру' }).click()
  await expect(page.locator('.scanner.immersive')).toHaveCount(0)
  expect(errors.filter((e) => !/by-qr|ERR_FAILED|Failed to load resource/.test(e)), errors.join('\n')).toEqual([])
  await ctx.close()
})

test('MAP-04 геолокация по HTTPS/localhost: «Моё местоположение» ставит точку и считает расстояние', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'admin', {
    permissions: ['geolocation'], geolocation: { latitude: 43.25, longitude: 76.93 }, viewport: { width: 1280, height: 900 },
  })
  await page.goto('/map')
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(10)
  await page.getByRole('button', { name: 'Моё местоположение' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'местоположение определено' })).toBeVisible()
  await page.locator('.leaflet-marker-icon').first().click({ force: true })
  await expect(page.locator('.leaflet-popup')).toContainText('От вас:')
  await expect(page.locator('.leaflet-popup').getByRole('link', { name: 'Маршрут' })).toHaveAttribute('href', /directions\?engine=fossgis_osrm_car&route=43\.25000/)
  await ctx.close()
})
