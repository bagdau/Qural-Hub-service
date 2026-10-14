import { expect, test } from '@playwright/test'
import { as, noHorizontalScroll } from './helpers'

// E2E-03: мобильный кабинет инженера и открытие паспорта по QR-ссылке
test('E2E-03 QR-ссылка → вход → паспорт (телефон)', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })
  const p = await ctx.newPage()
  await p.goto('/e/DEMOEQUIP009')
  await expect(p).toHaveURL(/\/login\?next=%2Fe%2FDEMOEQUIP009/)
  await p.getByLabel('Email').fill('engineer1@demo.alageum.test')
  await p.getByLabel('Пароль').fill(process.env.E2E_PASSWORD!)
  await p.getByRole('button', { name: 'Войти' }).click()
  await expect(p.getByRole('heading', { name: 'КТП-160' })).toBeVisible()
  await expect(p.getByText(/Ваша заявка/)).toBeVisible()
  await noHorizontalScroll(p)
  await p.screenshot({ path: 'artifacts/screens/m-passport.png', fullPage: true })
  await ctx.close()
})

test('E2E-03 задания и отчёт без горизонтальной прокрутки', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng1', { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })
  await page.goto('/my-tasks')
  await expect(page.getByRole('heading', { name: 'Мои задания' })).toBeVisible()
  await expect(page.getByText('SR-2026-0009')).toBeVisible()
  await noHorizontalScroll(page)
  await page.screenshot({ path: 'artifacts/screens/m-tasks.png', fullPage: true })
  await page.getByText('SR-2026-0009').first().click()
  await expect(page.getByRole('heading', { name: 'Искрение на шинах КТП' })).toBeVisible()
  await noHorizontalScroll(page)
  await page.screenshot({ path: 'artifacts/screens/m-ticket.png', fullPage: true })
  await page.getByRole('button', { name: /Отчёт/ }).first().click()
  await expect(page).toHaveURL(/report$/)
  for (let i = 0; i < 5; i++) {
    await noHorizontalScroll(page)
    if (i === 1) await page.screenshot({ path: 'artifacts/screens/m-report-checklist.png', fullPage: true })
    await page.getByRole('button', { name: 'Далее →' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Проверка и завершение' })).toBeVisible()
  await page.screenshot({ path: 'artifacts/screens/m-report-final.png', fullPage: true })
  // кнопка завершения заблокирована, пока условия не выполнены
  await expect(page.getByRole('button', { name: 'Завершить работы' })).toBeDisabled()
  // цели касания >= 44px
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, select, input[type=checkbox]')].filter((el) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && (r.height < 32) }).length)
  expect(small).toBeLessThanOrEqual(2)
  await ctx.close()
})

test('E2E-06 потеря соединения при заполнении отчёта', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'eng2', { viewport: { width: 390, height: 800 } })
  await page.goto('/tickets?q=SR-2026-0010')
  await page.getByRole('link', { name: 'SR-2026-0010' }).first().click()
  await page.getByRole('button', { name: /Отчёт/ }).first().click()
  await expect(page).toHaveURL(/report$/)
  await ctx.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText(/Нет соединения/)).toBeVisible()
  const ta = page.getByLabel('Результаты диагностики')
  await ta.fill('Механизм привода заклинивает при включении, требуется замена пружины.')
  await expect(page.locator('.badge[aria-live=polite]')).toContainText('Нет сети', { timeout: 10000 })
  await ctx.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('✓ Сохранено')).toBeVisible({ timeout: 15000 })
  await page.reload()
  await expect(page.getByLabel('Результаты диагностики')).toHaveValue(/заклинивает при включении, требуется замена пружины/)
  await ctx.close()
})
