import { expect, test } from '@playwright/test'
import { as } from './helpers'

test('MAP-01 паспорт оборудования: вкладка «Карта» с меткой площадки и маршрутом', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1280, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/equipment?q=DM-TR-0001')
  await page.getByRole('link', { name: /Трансформатор ТМ-1000/ }).first().click()
  await page.getByRole('tab', { name: 'Карта' }).or(page.getByRole('button', { name: 'Карта' })).first().click()
  await expect(page.getByRole('application', { name: /Карта: Площадка «Металл-Север»/ })).toBeVisible()
  const marker = page.locator('.leaflet-marker-icon')
  await expect(marker).toHaveCount(1)
  await expect(page.locator('.leaflet-popup')).toContainText('Площадка «Металл-Север»')
  await expect(page.locator('.leaflet-popup').getByRole('link', { name: 'Маршрут' })).toHaveAttribute('href', /openstreetmap\.org/)
  // карта не перекрывает верхнюю панель (изоляция слоёв Leaflet)
  const z = await page.evaluate(() => ({ map: getComputedStyle(document.querySelector('.map')!).zIndex, top: getComputedStyle(document.querySelector('.topbar')!).zIndex }))
  expect(Number(z.map)).toBeLessThan(Number(z.top))
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('MAP-02 страница «Карта объектов»: метки по ролям и список площадок', async ({ browser }) => {
  const a = await as(browser, 'admin', { viewport: { width: 1280, height: 900 } })
  await a.page.goto('/map')
  await expect(a.page.getByRole('heading', { name: 'Карта объектов' })).toBeVisible()
  await expect(a.page.locator('.leaflet-marker-icon')).toHaveCount(5)
  await expect(a.page.locator('.site-list li')).toHaveCount(5)
  await a.ctx.close()
  const c = await as(browser, 'cl1', { viewport: { width: 1280, height: 900 } })
  await c.page.goto('/map')
  await expect(c.page.locator('.leaflet-marker-icon').first()).toBeVisible()
  const n = await c.page.locator('.leaflet-marker-icon').count()
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThan(5)   // клиент видит только свои площадки
  await c.ctx.close()
})

test('MAP-03 администратор задаёт координаты площадки; клиент не может', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'admin', { viewport: { width: 1280, height: 900 } })
  await page.goto('/admin/organizations')
  const row = page.locator('.row.between.small', { hasText: 'Площадка «Металл-Юг»' })
  await row.getByRole('button', { name: 'Координаты' }).click()
  const dlg = page.getByRole('dialog', { name: /Координаты: Площадка «Металл-Юг»/ })
  await dlg.getByLabel('Широта').fill('43.2100')
  await dlg.getByLabel('Долгота').fill('76.9000')
  await dlg.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dlg).toBeHidden()
  await expect(row).toContainText('43.21000, 76.90000')
  // некорректное значение: понятная ошибка, данные не меняются
  await row.getByRole('button', { name: 'Координаты' }).click()
  await dlg.getByLabel('Широта').fill('123')
  await dlg.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dlg.getByRole('alert')).toBeVisible()
  await ctx.close()
  const c = await as(browser, 'cl1')
  const r = await c.page.request.get('/api/v1/sites?page_size=5')
  const site = (await r.json()).items[0]
  const bad = await c.page.request.patch(`/api/v1/sites/${site.id}`, { data: { version: site.version, latitude: 1, longitude: 1 }, headers: { 'X-CSRF-Token': 'x' } })
  expect([401, 403]).toContain(bad.status())
  await c.ctx.close()
})
