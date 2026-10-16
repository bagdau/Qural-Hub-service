import { expect, test } from '@playwright/test'
import { as } from './helpers'

test('MAP-01 паспорт оборудования: вкладка «Карта» с меткой нужного типа и маршрутом', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1280, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/equipment?q=DM-TR-0001')
  await page.getByRole('link', { name: /Трансформатор ТМ-1000/ }).first().click()
  await page.getByRole('tab', { name: 'Карта' }).or(page.getByRole('button', { name: 'Карта' })).first().click()
  await expect(page.getByRole('application', { name: /Карта: Трансформатор ТМ-1000\/10/ })).toBeVisible()
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)
  await expect(page.locator('.leaflet-marker-icon .mk')).toBeVisible()
  await expect(page.locator('.leaflet-popup')).toContainText('Трансформатор')
  await expect(page.locator('.leaflet-popup').getByRole('link', { name: 'Маршрут' })).toHaveAttribute('href', /openstreetmap\.org/)
  await expect(page.getByText(/положение оборудования/)).toBeVisible()
  // плитки карты идут через наш сервер (кэш), а не напрямую на tile.openstreetmap.org
  const tileSrc = await page.locator('.leaflet-tile').first().getAttribute('src')
  expect(tileSrc).toMatch(/^\/tiles\/\d+\/\d+\/\d+\.png$/)
  const z = await page.evaluate(() => ({ map: getComputedStyle(document.querySelector('.map')!).zIndex, top: getComputedStyle(document.querySelector('.topbar')!).zIndex }))
  expect(Number(z.map)).toBeLessThan(Number(z.top))
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('MAP-02 «Карта объектов»: значки типов, сигналы аварий и вызовов, фильтры, роли', async ({ browser }) => {
  const a = await as(browser, 'admin', { viewport: { width: 1280, height: 900 } })
  await a.page.goto('/map')
  await expect(a.page.getByRole('heading', { name: 'Карта объектов' })).toBeVisible()
  await expect(a.page.locator('.leaflet-marker-icon')).toHaveCount(10)
  // три разных значка: трансформатор, подстанция, будка
  const glyphs = await a.page.locator('.leaflet-marker-icon .mk-body svg').evaluateAll((els) => new Set(els.map((e) => e.innerHTML)).size)
  expect(glyphs).toBeGreaterThanOrEqual(3)
  // сигналы: авария (критическая заявка КТП-160) мигает, вызовы оранжевые
  await expect(a.page.locator('.mk-accident').first()).toBeVisible()
  expect(await a.page.locator('.mk-accident .mk-pulse').count()).toBeGreaterThan(0)
  await expect(a.page.getByRole('alert').filter({ hasText: 'Аварии:' })).toContainText('КТП-160')
  const signals = a.page.locator('.sig')
  await expect(signals.first()).toContainText('Авария')
  await expect(a.page.locator('.sig-call').first()).toContainText('Вызов')
  await a.page.screenshot({ path: 'artifacts/screens/map-signals.png', fullPage: false })
  // фильтр сигналов: только аварии
  const total = await a.page.locator('.leaflet-marker-icon').count()
  for (const t of ['Вызов', 'Плановые работы', 'В норме']) await a.page.getByRole('button', { name: new RegExp(`^${t}`) }).click()
  const only = await a.page.locator('.leaflet-marker-icon').count()
  expect(only).toBeGreaterThan(0); expect(only).toBeLessThan(total)
  await expect(a.page.locator('.mk-call, .mk-ok, .mk-plan')).toHaveCount(0)
  // фильтр типов: убираем «Будка (РУ)»
  await a.page.getByRole('button', { name: /^Аварии|^Авария/ }).click()      // вернуть все сигналы
  await a.page.getByRole('button', { name: /^Вызов/ }).click(); await a.page.getByRole('button', { name: /^Плановые работы/ }).click(); await a.page.getByRole('button', { name: /^В норме/ }).click()
  await a.page.getByRole('button', { name: /^Будка \(РУ\)/ }).click()
  expect(await a.page.locator('.leaflet-marker-icon').count()).toBeLessThan(total)
  await a.ctx.close()
  const c = await as(browser, 'cl1', { viewport: { width: 1280, height: 900 } })
  await c.page.goto('/map')
  await expect(c.page.locator('.leaflet-marker-icon').first()).toBeVisible()
  const n = await c.page.locator('.leaflet-marker-icon').count()
  expect(n).toBeGreaterThan(0); expect(n).toBeLessThan(10)             // клиент видит только своё оборудование
  await expect(c.page.getByRole('button', { name: 'Положение', exact: true })).toHaveCount(0)
  await c.ctx.close()
})

test('MAP-03 редактор положения оборудования по широте и долготе', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1280, height: 900 } })
  await page.goto('/equipment?q=DL-KTP-0002')
  await page.getByRole('link', { name: 'КТП-160' }).first().click()
  await page.getByRole('tab', { name: 'Карта' }).or(page.getByRole('button', { name: 'Карта' })).first().click()
  await page.getByRole('button', { name: 'Изменить положение' }).click()
  const dlg = page.getByRole('dialog', { name: /Положение: КТП-160/ })
  await dlg.getByLabel(/Широта/).fill('43.2800')
  await dlg.getByLabel(/Долгота/).fill('76.9800')
  await expect(dlg.locator('.mk-pick')).toHaveCount(1)       // синяя метка выбора появилась на карте
  await dlg.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByText('43.280000, 76.980000')).toBeVisible()
  // щелчок по карте задаёт точку
  await page.getByRole('button', { name: 'Изменить положение' }).click()
  const map = dlg.getByRole('application')
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40)
  await expect(dlg.getByLabel(/Широта/)).not.toHaveValue('43.28')
  // неверные значения: понятная ошибка
  await dlg.getByLabel(/Широта/).fill('123')
  await dlg.getByLabel(/Долгота/).fill('76.98')
  await dlg.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dlg.getByRole('alert')).toBeVisible()
  // очистка возвращает положение площадки
  await dlg.getByRole('button', { name: /Очистить/ }).click()
  await dlg.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.locator('.mono', { hasText: /положение площадки/ })).toBeVisible()
  await ctx.close()
  const cl = await as(browser, 'cl1', { viewport: { width: 1280, height: 900 } })
  await cl.page.goto('/equipment')
  await cl.page.getByRole('link', { name: /КТП|Трансформатор|РУ/ }).first().click()
  await cl.page.getByRole('tab', { name: 'Карта' }).or(cl.page.getByRole('button', { name: 'Карта' })).first().click()
  await expect(cl.page.getByRole('button', { name: 'Изменить положение' })).toHaveCount(0)
  await cl.ctx.close()
})

test('MAP-04 администратор задаёт координаты площадки (запасное положение); клиент не может', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'admin', { viewport: { width: 1280, height: 900 } })
  await page.goto('/admin/organizations')
  const row = page.locator('.row.between.small', { hasText: 'Площадка «Металл-Юг»' })
  await row.getByRole('button', { name: 'Координаты' }).click()
  const dlg = page.getByRole('dialog', { name: /Координаты: Площадка «Металл-Юг»/ })
  await dlg.getByLabel(/Широта/).fill('43.2100')
  await dlg.getByLabel(/Долгота/).fill('76.9000')
  await dlg.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dlg).toBeHidden()
  await expect(row).toContainText('43.21000, 76.90000')
  await row.getByRole('button', { name: 'Координаты' }).click()
  await dlg.getByLabel(/Широта/).fill('123')
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
