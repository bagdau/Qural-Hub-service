import { expect, test } from '@playwright/test'
import { as } from './helpers'

test('BG-01 фотографии за боковой панелью: загружаются, плавно сменяются кнопкой, выбор запоминается', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1440, height: 900 } })
  await page.goto('/board')
  const layers = page.locator('.side-bg i')
  await expect(layers).toHaveCount(2)
  await expect(page.locator('.side-bg i.on')).toHaveCount(1)
  for (const f of ['lake', 'mountains']) {
    const r = await page.request.get(`/bg/${f}.webp`)
    expect(r.status()).toBe(200)
    expect(r.headers()['content-type']).toContain('image/webp')
    expect(r.headers()['cache-control']).toContain('max-age')
  }
  const before = await page.locator('.side-bg i.on').evaluate((e) => (e as HTMLElement).style.backgroundImage)
  await page.getByRole('button', { name: 'Сменить фоновое изображение' }).click()
  const after = await page.locator('.side-bg i.on').evaluate((e) => (e as HTMLElement).style.backgroundImage)
  expect(after).not.toBe(before)
  await page.waitForTimeout(1800)                                   // кроссфейд завершён
  await page.screenshot({ path: 'artifacts/screens/sidebar-photo.png', clip: { x: 0, y: 0, width: 520, height: 900 } })
  await page.reload()                                               // выбор запомнен
  expect(await page.locator('.side-bg i.on').evaluate((e) => (e as HTMLElement).style.backgroundImage)).toBe(after)
  // меню остаётся читаемым поверх фото: тёмная вуаль
  const veil = await page.locator('.side-scrim').evaluate((e) => getComputedStyle(e).backgroundImage)
  expect(veil).toContain('rgba(')
  await ctx.close()
})

test('TP-01 карта: тачпад — два пальца двигают карту, щипок (Ctrl+колесо) масштабирует; центр — Шымкент', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'admin', { viewport: { width: 1440, height: 1000 } })
  await page.goto('/map')
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible()
  const map = page.locator('.map')
  const mb = (await map.boundingBox())!
  const pos = async (i: number) => { const b = (await page.locator('.leaflet-marker-icon').nth(i).boundingBox())!; return { x: b.x + b.width / 2 - mb.x, y: b.y + b.height / 2 - mb.y } }
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2)

  // выключено: обычная прокрутка не двигает карту (страница прокручивается)
  const toggle = page.getByRole('button', { name: /^Тачпад/ })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  const a0 = await pos(0)
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(250)
  const mb2 = (await map.boundingBox())!; mb.x = mb2.x; mb.y = mb2.y                // страница могла сместиться
  const a1 = await pos(0)
  expect(Math.abs(a1.y - a0.y)).toBeLessThan(2)

  // включено: два пальца (wheel без Ctrl) перемещают карту
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2)
  const scrollY0 = await page.evaluate(() => window.scrollY)
  const b0 = await pos(0)
  await page.mouse.wheel(60, 100)
  await page.waitForTimeout(250)
  const b1 = await pos(0)
  expect(b0.y - b1.y).toBeGreaterThan(60)                                           // метка сдвинулась вверх
  expect(b0.x - b1.x).toBeGreaterThan(30)                                           // и влево
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY0)                  // страница не прокручивалась

  // щипок на тачпаде = Ctrl+колесо: масштаб вокруг указателя (расстояние между метками растёт)
  const n = await page.locator('.leaflet-marker-icon').count()
  const d = async () => { const p = await pos(0), q = await pos(n - 1); return Math.hypot(p.x - q.x, p.y - q.y) }
  const d0 = await d()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  expect(await d()).toBeGreaterThan(d0 * 1.2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 480)
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  expect(await d()).toBeLessThan(d0 * 1.2)                                          // и обратно

  // выбор запоминается; демо-оборудование расположено в Шымкенте
  await page.reload()
  await expect(page.getByRole('button', { name: /^Тачпад/ })).toHaveAttribute('aria-pressed', 'true')
  const api = await (await page.request.get('/api/v1/map/objects')).json()
  for (const i of api.items) { expect(i.geo.latitude).toBeGreaterThan(42); expect(i.geo.latitude).toBeLessThan(43); expect(i.geo.longitude).toBeGreaterThan(69); expect(i.geo.longitude).toBeLessThan(70) }
  await ctx.close()
})
