import { expect, test } from '@playwright/test'
import { as } from './helpers'

/**
 * Перетаскивание карточки пальцем (долгое касание → движение → отпускание).
 * Планшет: целевая колонка видна рядом — карточка переносится в «В работе».
 * Телефон: колонки шире экрана, поэтому проверяем «подъём» карточки пальцем и корректное отпускание.
 * Данные меняются другими тестами, поэтому берём того инженера, у которого сейчас есть назначенная заявка.
 */
test('DRAG-TOUCH канбан: карточка перетаскивается касанием', async ({ browser }, info) => {
  const phone = info.project.name === 'mobile'
  let session: Awaited<ReturnType<typeof as>> | null = null
  for (const role of phone ? ['eng2', 'eng1'] : ['eng1', 'eng2']) {
    const s = await as(browser, role)
    await s.page.goto('/board')
    await expect(s.page.getByTestId('col-assigned')).toBeVisible()
    if (await s.page.locator('[data-testid=col-assigned] [data-testid^=card-]').count()) { session = s; break }
    await s.ctx.close()
  }
  test.skip(!session, 'нет назначенных инженерам заявок (данные израсходованы другими тестами): выполните seed-demo')
  const { ctx, page } = session!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const first = page.locator('[data-testid=col-assigned] [data-testid^=card-]').first()
  const testid = (await first.getAttribute('data-testid'))!
  const card = page.getByTestId(testid)
  // выравниваем ленту так, чтобы были видны и «Назначена», и «В работе»
  await page.evaluate(() => {
    const k = document.querySelector('.kanban') as HTMLElement
    const a = document.getElementById('kcol-assigned') as HTMLElement
    k.scrollLeft = a.offsetLeft - k.offsetLeft - 6
  })
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const a = (await card.boundingBox())!
  const vw = page.viewportSize()!.width
  const b = (await page.getByTestId('col-in_progress').boundingBox())!
  const from = { x: a.x + Math.min(a.width / 2, 120), y: a.y + 40 }
  const to = phone ? { x: from.x + 10, y: from.y + 60 } : { x: (Math.max(b.x, 0) + Math.min(b.x + b.width, vw)) / 2, y: b.y + 120 }
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  await page.waitForTimeout(350)                                   // долгое нажатие (активация перетаскивания)
  for (let i = 1; i <= 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 14, y: from.y + ((to.y - from.y) * i) / 14 }] })
    await page.waitForTimeout(25)
  }
  await expect(page.locator('.kcard.overlay')).toHaveCount(1)       // карточка «поднята» и следует за пальцем
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  if (phone) await expect(page.locator('.kcard.overlay')).toHaveCount(0)
  else await expect(page.getByTestId('col-in_progress').getByTestId(testid)).toBeVisible({ timeout: 6000 })
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})
