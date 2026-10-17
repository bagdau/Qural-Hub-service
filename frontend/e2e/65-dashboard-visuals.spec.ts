import { expect, test } from '@playwright/test'
import { as } from './helpers'

test('DASH-01 дашборд: 3D-диаграммы, датчики и анимированные счётчики', async ({ browser }) => {
  const m = await as(browser, 'manager', { viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  m.page.on('pageerror', (e) => errors.push(e.message))
  await m.page.goto('/')
  await expect(m.page.getByRole('img', { name: /^Заявки по статусам:/ })).toBeVisible()
  await expect(m.page.locator('.pie3d .pslice')).toHaveCount(9)
  await expect(m.page.getByRole('img', { name: 'Загрузка инженеров' })).toBeVisible()
  await expect(m.page.locator('.cols3d .col3')).toHaveCount(6)                 // 4 приоритета + 2 инженера
  expect(await m.page.locator('.gauge').count()).toBeGreaterThanOrEqual(4)
  // счётчики приходят к точным значениям
  // данные меняются другими тестами: сверяем счётчики с ответом API, а не с константами
  const sum = await (await m.page.request.get('/api/v1/analytics/summary')).json()
  await expect(m.page.locator('.kpi', { hasText: 'Активные заявки' }).locator('.v')).toHaveText(String(sum.active.count))
  await expect(m.page.locator('.kpi', { hasText: 'Просроченные' }).locator('.v')).toHaveText(String(sum.overdue.count))
  // наведение на строку легенды выдвигает сектор
  const row = m.page.getByRole('button', { name: /^В работе: \d+$/ })
  await row.hover()
  await expect(m.page.locator('.pslice').first()).toHaveCSS('transition-property', /transform/)
  // нажатие на сектор/легенду открывает список заявок этого статуса
  await row.click()
  await expect(m.page).toHaveURL(/\/tickets\?status=in_progress/)
  await m.ctx.close()
  expect(errors, errors.join('\n')).toEqual([])
})

test('DASH-02 дашборд: итоговые картинки (компьютер, телефон) и отсутствие горизонтальной прокрутки', async ({ browser }) => {
  const d = await as(browser, 'manager', { viewport: { width: 1440, height: 1300 } })
  await d.page.goto('/')
  await expect(d.page.locator('.pie3d .pslice')).toHaveCount(9)
  await d.page.waitForTimeout(1800)                                             // анимации завершены
  await d.page.screenshot({ path: 'artifacts/screens/dashboard-desktop.png', fullPage: true })
  await d.ctx.close()
  const p = await as(browser, 'manager', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await p.page.goto('/')
  await expect(p.page.locator('.pie3d .pslice')).toHaveCount(9)
  await p.page.waitForTimeout(1800)
  const w = await p.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(w.sw).toBeLessThanOrEqual(w.cw + 1)
  await p.page.screenshot({ path: 'artifacts/screens/dashboard-mobile.png', fullPage: true })
  await p.ctx.close()
})
