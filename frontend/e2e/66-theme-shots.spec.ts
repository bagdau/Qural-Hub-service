import { test } from '@playwright/test'
import { as } from './helpers'

// Скриншоты новой темы: вход, дашборд, пользователи, доска, оборудование — компьютер, планшет, телефон
test('THEME-SHOTS ключевые экраны', async ({ browser }) => {
  const anon = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } })
  const lp = await anon.newPage()
  await lp.goto('/login'); await lp.waitForTimeout(1200)
  await lp.screenshot({ path: 'artifacts/screens/theme-login-desktop.png' })
  await anon.close()
  const d = await as(browser, 'admin', { viewport: { width: 1440, height: 900 } })
  for (const [url, name] of [['/', 'dashboard'], ['/admin/users', 'users'], ['/board', 'board'], ['/equipment', 'equipment']] as const) {
    await d.page.goto(url); await d.page.waitForTimeout(1900)
    await d.page.screenshot({ path: `artifacts/screens/theme-${name}-desktop.png` })
  }
  await d.page.goto('/map'); await d.page.waitForTimeout(2500)
  await d.page.screenshot({ path: 'artifacts/screens/theme-map-desktop.png' })
  await d.ctx.close()
  const t = await as(browser, 'dispatcher', { viewport: { width: 834, height: 1112 }, hasTouch: true })
  await t.page.goto('/board'); await t.page.waitForTimeout(1500)
  await t.page.screenshot({ path: 'artifacts/screens/theme-board-tablet.png' })
  await t.ctx.close()
  const p = await as(browser, 'manager', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await p.page.goto('/'); await p.page.waitForTimeout(1900)
  await p.page.screenshot({ path: 'artifacts/screens/theme-dashboard-phone.png' })
  await p.ctx.close()
  const mp = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const mpp = await mp.newPage()
  await mpp.goto('/login'); await mpp.waitForTimeout(1200)
  await mpp.screenshot({ path: 'artifacts/screens/theme-login-phone.png' })
  await mp.close()
})
