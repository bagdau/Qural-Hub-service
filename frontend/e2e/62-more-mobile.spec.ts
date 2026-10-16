import { expect, test } from '@playwright/test'
import { as } from './helpers'

test('MORE-01 телефон: «Ещё» открывает меню со всеми разделами, профилем и выходом', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher')
  await page.goto('/board')
  const nav = page.getByRole('navigation', { name: 'Быстрая навигация' })
  await expect(nav.getByRole('link')).toHaveCount(4)             // Главная, Заявки, Сканер QR, Оборудование
  await expect(nav.getByRole('link', { name: /Уведомл/ })).toHaveCount(0)
  const more = nav.getByRole('button', { name: 'Ещё' })
  await more.click()
  const dlg = page.getByRole('dialog', { name: 'Меню' })
  await expect(dlg).toBeVisible()
  for (const name of ['Плановые работы', 'Запчасти', 'Генератор QR', 'Карта', 'Профиль']) await expect(dlg.getByRole('link', { name })).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible()
  // пункты не меньше 48 px по высоте
  const h = await dlg.getByRole('link', { name: 'Карта' }).evaluate((e) => e.getBoundingClientRect().height)
  expect(h).toBeGreaterThanOrEqual(48)
  await dlg.getByRole('link', { name: 'Карта' }).click()
  await expect(dlg).toBeHidden()
  await expect(page).toHaveURL(/\/map$/)
  await expect(more).toHaveClass(/active/)                      // «Ещё» подсвечено, когда открыт раздел из меню
  await page.screenshot({ path: 'artifacts/screens/mobile-map.png' })
  await ctx.close()
})

test('MORE-02 телефон: у инженера в «Ещё» — доска заявок, карта и профиль; выход из аккаунта работает', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1')
  await page.goto('/my-tasks')
  await page.getByRole('navigation', { name: 'Быстрая навигация' }).getByRole('button', { name: 'Ещё' }).click()
  const dlg = page.getByRole('dialog', { name: 'Меню' })
  for (const name of ['Доска заявок', 'Карта', 'Профиль']) await expect(dlg.getByRole('link', { name })).toBeVisible()
  await page.screenshot({ path: 'artifacts/screens/mobile-more-menu.png' })
  await ctx.close()
  // выход проверяем отдельным пользователем: выход завершает серверную сессию, и другие тесты с тем же входом сломались бы
  const out = await as(browser, 'cl3')
  await out.page.goto('/')
  await out.page.getByRole('navigation', { name: 'Быстрая навигация' }).getByRole('button', { name: 'Ещё' }).click()
  await out.page.getByRole('dialog', { name: 'Меню' }).getByRole('button', { name: 'Выйти из аккаунта' }).click()
  await expect(out.page).toHaveURL(/\/login/)
  await out.ctx.close()
})

test('EQ-MOBILE карточка оборудования на телефоне: три блока в одну строку, ничего не обрезано', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'dispatcher')
  await page.goto('/equipment')
  const card = page.locator('.eq-rows tbody tr').first()
  await expect(card).toBeVisible()
  const boxes = await Promise.all(['.c-inv', '.c-state', '.c-tix'].map((c) => card.locator(c).boundingBox()))
  const [a, b, c] = boxes as { x: number; y: number; width: number; height: number }[]
  expect(Math.abs(a.y - b.y)).toBeLessThan(2); expect(Math.abs(b.y - c.y)).toBeLessThan(2)   // одна строка
  expect(a.x).toBeLessThan(b.x); expect(b.x).toBeLessThan(c.x)                                // три колонки
  const vw = page.viewportSize()!.width
  expect(c.x + c.width).toBeLessThanOrEqual(vw)
  // карточка компактнее прежней (было ≈210 px)
  const h = (await card.boundingBox())!.height
  expect(h).toBeLessThan(170)
  // кнопка QR доступна пальцу
  const qr = await card.getByRole('link', { name: /^QR-код:/ }).boundingBox()
  expect(qr!.height).toBeGreaterThanOrEqual(36)
  await page.screenshot({ path: 'artifacts/screens/mobile-equipment.png' })
  await ctx.close()
})
