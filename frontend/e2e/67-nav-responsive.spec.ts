import { expect, test } from '@playwright/test'
import { as } from './helpers'

test('NAV-04 диспетчер: панель управления и заявки открывают разные страницы', async ({ browser }, info) => {
  const mobile = info.project.name === 'mobile'
  const { ctx, page } = await as(browser, 'dispatcher', {
    viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 },
  })
  try {
    await page.goto('/board')
    const nav = page.getByRole('navigation', { name: mobile ? 'Быстрая навигация' : 'Основное меню' })
    const home = nav.getByRole('link', { name: mobile ? 'Главная' : 'Панель управления', exact: true })
    const tickets = nav.getByRole('link', { name: 'Заявки', exact: true })
    await expect(tickets).toHaveAttribute('aria-current', 'page')
    await home.click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Панель управления', exact: true })).toBeVisible()
    await expect(home).toHaveAttribute('aria-current', 'page')
    await expect(tickets).not.toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('img', { name: /^Заявки по статусам:/ })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Панель управления', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await tickets.click()
    await expect(page).toHaveURL(/\/board$/)
    await expect(tickets).toHaveAttribute('aria-current', 'page')
    await expect(home).not.toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: 'Панель управления', exact: true })).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: 'Поиск заявок', exact: true })).toBeVisible()
  } finally {
    await ctx.close()
  }
})

/** Режимы навигации: компьютер — сворачиваемая панель; планшет — узкая панель значков с раскрытием; телефон — всё внизу, как панель задач */
test('NAV-01 компьютер: кнопка сворачивает боковую панель до значков и запоминает выбор', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop')
  const { ctx, page } = await as(browser, 'dispatcher', { viewport: { width: 1440, height: 900 } })
  await page.goto('/board')
  const side = page.locator('.sidebar')
  const toggle = page.getByRole('button', { name: 'Свернуть меню' })
  expect((await side.boundingBox())!.width).toBeGreaterThan(240)
  expect((await page.locator('.nav-label').first().boundingBox())!.width).toBeGreaterThan(40)
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Развернуть меню' })).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await side.boundingBox())!.width, { timeout: 3000 }).toBeLessThan(100)
  expect((await page.locator('.nav-label').first().boundingBox())!.width).toBeLessThanOrEqual(2)      // подпись скрыта визуально, но остаётся для дикторов
  await expect(page.getByRole('link', { name: 'Оборудование' })).toHaveAttribute('title', 'Оборудование')   // подсказка при наведении
  await page.screenshot({ path: 'artifacts/screens/nav-desktop-rail.png' })
  await page.reload()                                                           // выбор сохранён
  await expect.poll(async () => (await page.locator('.sidebar').boundingBox())!.width, { timeout: 3000 }).toBeLessThan(100)
  await page.getByRole('button', { name: 'Развернуть меню' }).click()
  await expect.poll(async () => (await page.locator('.sidebar').boundingBox())!.width, { timeout: 3000 }).toBeGreaterThan(240)
  await ctx.close()
})

test('NAV-02 планшет: слева узкая панель значков; кнопка раскрывает полное меню поверх страницы', async ({ browser }, info) => {
  test.skip(info.project.name !== 'tablet')
  const { ctx, page } = await as(browser, 'eng1')
  await page.goto('/my-tasks')
  const side = page.locator('.sidebar')
  expect((await side.boundingBox())!.width).toBeLessThan(100)
  expect((await page.locator('.nav-label').first().boundingBox())!.width).toBeLessThanOrEqual(2)   // только значки
  await page.getByRole('button', { name: 'Развернуть меню' }).click()
  await expect(page.locator('.scrim')).toBeVisible()
  expect((await page.locator('.nav-label').first().boundingBox())!.width).toBeGreaterThan(40)
  expect((await side.boundingBox())!.width).toBeGreaterThan(240)
  await page.screenshot({ path: 'artifacts/screens/nav-tablet-expanded.png' })
  await page.keyboard.press('Escape')                                            // Escape закрывает
  await expect(page.locator('.scrim')).toHaveCount(0)
  await page.getByRole('button', { name: 'Развернуть меню' }).click()
  await page.getByRole('link', { name: 'Доска заявок' }).click()                 // переход закрывает меню
  await expect(page).toHaveURL(/\/board/)
  await expect(page.locator('.scrim')).toHaveCount(0)
  expect((await page.locator('.sidebar').boundingBox())!.width).toBeLessThan(100)
  await ctx.close()
})

test('NAV-03 телефон: шапки нет — навигация, поиск, уведомления, профиль и выход внизу', async ({ browser }, info) => {
  test.skip(info.project.name !== 'mobile')
  const { ctx, page } = await as(browser, 'dispatcher')
  await page.goto('/board')
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.getByRole('button', { name: /Развернуть меню|Свернуть меню/ })).toBeHidden()
  const nav = page.getByRole('navigation', { name: 'Быстрая навигация' })
  await expect(nav).toBeVisible()
  const box = (await nav.boundingBox())!
  expect(box.y + box.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2)   // прижата к низу экрана
  await expect(nav.locator('.more-dot')).toBeVisible()                                  // есть непрочитанные уведомления
  await nav.getByRole('button', { name: 'Ещё' }).click()
  const dlg = page.getByRole('dialog', { name: 'Меню' })
  await expect(dlg.getByRole('searchbox', { name: 'Поиск по заявкам' })).toBeVisible()
  for (const name of ['Уведомления', 'Профиль']) await expect(dlg.getByRole('link', { name: new RegExp(name) })).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible()
  await dlg.getByRole('searchbox', { name: 'Поиск по заявкам' }).fill('0017')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/tickets\?q=0017/)
  await page.screenshot({ path: 'artifacts/screens/nav-phone.png' })
  await ctx.close()
})
