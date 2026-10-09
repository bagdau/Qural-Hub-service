import { expect, test } from '@playwright/test'
import { as } from './helpers'

// E2E-04: изоляция клиентов в интерфейсе
test('E2E-04 изоляция клиентов', async ({ browser }) => {
  const d = await as(browser, 'dispatcher')
  await d.page.goto('/tickets?q=SR-2026-0003')
  const href = await d.page.getByRole('link', { name: 'SR-2026-0003' }).first().getAttribute('href')
  await d.ctx.close()
  const cl = await as(browser, 'cl1')
  await cl.page.goto(href!)
  await expect(cl.page.getByRole('heading', { name: 'Заявка не найдена' })).toBeVisible()
  await expect(cl.page.getByText('DA-TR-0001')).toHaveCount(0)
  await cl.page.goto('/equipment')
  await expect(cl.page.getByText('DA-TR-0001')).toHaveCount(0)
  await expect(cl.page.getByRole('link', { name: 'Администрирование' })).toHaveCount(0)
  await cl.page.goto('/admin/users')
  await expect(cl.page.getByRole('heading', { name: /Нет доступа|Пользователи/ })).toBeVisible()
  await cl.ctx.close()
})

// E2E-07: дашборд = seed
test('E2E-07 дашборд руководителя совпадает с демо-данными', async ({ browser }) => {
  const m = await as(browser, 'manager')
  await m.page.goto('/')
  const kpi = (label: string) => m.page.locator('.kpi', { hasText: label })
  await expect(kpi('Активные заявки').locator('.v')).toHaveText('12')
  await expect(kpi('Просроченные').locator('.v')).toHaveText('2')
  await expect(kpi('Среднее время реакции').locator('.v')).toHaveText('38 мин 20 с')
  await expect(kpi('Выполнено в срок').locator('.v')).toHaveText('85.7%')
  await expect(kpi('Повторные неисправности').locator('.v')).toHaveText('13.3%')
  await kpi('Просроченные').click()
  const dlg = m.page.getByRole('dialog')
  await expect(dlg.getByRole('link')).toHaveCount(2)
  await expect(dlg).toContainText('SR-2026-0008')
  await expect(dlg).toContainText('SR-2026-0017')
  await m.ctx.close()
})

