import { expect, test } from '@playwright/test'

/** Сеанс: 10 минут без действий → предупреждение за минуту → выход с пояснением; активность продлевает сеанс */
test('SESS-01 сеанс 10 минут: предупреждение, продление кнопкой, выход после бездействия с пояснением', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.clock.install()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // отдельный вход (новая серверная сессия): выход ниже не затронет сохранённые входы других тестов
  await page.goto('/login')
  await page.getByLabel('Email').fill('client.logistics@demo.alageum.test')
  await page.getByLabel('Пароль').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('link', { name: /^Профиль:/ })).toBeVisible()
  const me = await (await page.request.get('/api/v1/auth/me')).json()
  expect(me.session.idle_ttl_seconds).toBe(600)

  // 9 минут 10 секунд тишины: до выхода меньше минуты — предупреждение
  await page.clock.runFor('09:10')
  const warn = page.getByRole('alert').filter({ hasText: 'Сеанс завершится через' })
  await expect(warn).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить работу' }).click()           // продолжаем работу: отсчёт заново
  await expect(warn).toBeHidden()
  await page.clock.runFor('09:10')
  await expect(warn).toBeVisible()                                                 // снова почти 10 минут, но сеанс ещё жив
  await expect(page.getByRole('link', { name: /^Профиль:/ })).toBeVisible()

  // бездействие до конца срока — выход и понятное объяснение на странице входа
  await page.clock.runFor('01:10')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('status').filter({ hasText: 'Сеанс завершён: вы были неактивны 10 мин' })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Сеанс завершён')).toHaveCount(0)                    // сообщение показывается один раз
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('SESS-02 активность (клики) не даёт сеансу истечь, а сервер продлевает его при обращениях', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.clock.install()
  await page.goto('/login')
  await page.getByLabel('Email').fill('client.logistics@demo.alageum.test')
  await page.getByLabel('Пароль').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('link', { name: /^Профиль:/ })).toBeVisible()
  for (let i = 0; i < 4; i++) {                      // 4 × 5 минут = 20 минут, но каждые 5 минут пользователь что-то делает
    await page.clock.runFor('05:00')
    await page.getByRole('link', { name: /^Главная|^Мои заявки/ }).first().click()
  }
  await expect(page.getByRole('link', { name: /^Профиль:/ })).toBeVisible()
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200)
  await page.getByRole('button', { name: 'Выйти' }).click()                          // закрываем собственный сеанс
  await expect(page).toHaveURL(/\/login/)
  await ctx.close()
})
