import { Page, expect, test } from '@playwright/test'
import { as } from './helpers'

/** Адаптация: компьютер — администраторы и диспетчеры; планшет — инженеры и клиенты; телефон — все роли. */
const MATRIX: Record<string, { roles: string[]; pages: Record<string, string[]> }> = {
  desktop: { roles: ['admin', 'dispatcher'], pages: { admin: ['/', '/board', '/equipment', '/generator', '/admin/users'], dispatcher: ['/board', '/equipment', '/generator', '/tickets'] } },
  tablet: { roles: ['eng1', 'cl1'], pages: { eng1: ['/my-tasks', '/board', '/equipment', '/scan'], cl1: ['/', '/board', '/equipment', '/tickets/new'] } },
  mobile: {
    roles: ['admin', 'dispatcher', 'manager', 'eng1', 'cl1'],
    pages: {
      admin: ['/', '/board', '/equipment', '/admin/users', '/generator'], dispatcher: ['/board', '/equipment', '/generator'], manager: ['/', '/board', '/equipment'],
      eng1: ['/my-tasks', '/board', '/scan', '/equipment'], cl1: ['/', '/board', '/equipment', '/tickets/new'],
    },
  },
}

async function noOverflow(page: Page, where: string) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(w.sw, `${where}: горизонтальная прокрутка страницы ${w.sw} > ${w.cw}`).toBeLessThanOrEqual(w.cw + 1)
}

async function tapTargets(page: Page, min: number) {
  return page.evaluate((m) => [...document.querySelectorAll('button, a.btn, nav a, select, input[type=checkbox], input[type=search], .kchip')]
    .filter((el) => { const t = (el.closest('label') ?? el) as HTMLElement; const r = t.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && r.height < m })
    .map((el) => `${el.tagName}:${(el.textContent ?? '').trim().slice(0, 24)}:${Math.round((el as HTMLElement).getBoundingClientRect().height)}`), min)
}

test('RESP: раскладка и отсутствие горизонтальной прокрутки на всех экранах устройства', async ({ browser }, info) => {
  const device = info.project.name as 'desktop' | 'tablet' | 'mobile'
  const cfg = MATRIX[device]
  const problems: string[] = []
  for (const role of cfg.roles) {
    const { ctx, page } = await as(browser, role, device === 'desktop' ? { viewport: { width: 1440, height: 900 } } : {})
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const url of cfg.pages[role]) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      const where = `${device}/${role}${url}`
      const side = page.locator('.sidebar')
      const bottom = page.locator('.bottomnav')
      if (device === 'desktop') {
        await expect(side, where).toBeVisible()
        expect((await side.boundingBox())!.width, where).toBeGreaterThan(200)
        await expect(bottom, where).toBeHidden()
        await expect(page.locator('.brand-text'), where).toBeVisible()
      } else if (device === 'tablet') {
        await expect(side, where).toBeVisible()
        const w = (await side.boundingBox())!.width
        expect(w, where).toBeGreaterThan(70); expect(w, where).toBeLessThan(120)   // узкая панель иконок
        await expect(page.locator('.brand-text'), where).toBeHidden()
        await expect(bottom, where).toBeHidden()
      } else {
        await expect(side, where).toBeHidden()
        await expect(bottom, where).toBeVisible()
        // на телефоне в нижней панели нет «Уведомлений» (колокольчик — в верхней панели), есть «Сканер QR»/«Скан» и «Оборудование»
        await expect(bottom.getByRole('link', { name: /Уведомл/ }), where).toHaveCount(0)
        await expect(bottom.getByRole('link', { name: /Скан/ }), where).toHaveCount(1)
        await expect(bottom.getByRole('link', { name: 'Оборудование' }), where).toHaveCount(1)
        await expect(page.getByRole('button', { name: /^Уведомления/ }), where).toBeVisible()
      }
      try { await noOverflow(page, where) } catch (e: any) { problems.push(e.message) }
      if (device !== 'desktop' && !['/scan'].includes(url)) {
        const small = await tapTargets(page, 40)
        if (small.length > 3) problems.push(`${where}: мелкие элементы управления (<40px): ${small.slice(0, 5).join(', ')}`)
      }
      if (url === '/board' || url === '/equipment') await page.screenshot({ path: `artifacts/screens/resp-${device}-${role}${url.replace(/\//g, '-')}.png`, fullPage: false })
    }
    expect(errors, `${device}/${role}: ${errors.join('; ')}`).toEqual([])
    await ctx.close()
  }
  expect(problems, problems.join('\n')).toEqual([])
})

test('RESP: на телефоне и планшете у канбана есть быстрые переходы между колонками; в списке — карточки', async ({ browser }, info) => {
  test.skip(info.project.name === 'desktop')
  const { ctx, page } = await as(browser, info.project.name === 'tablet' ? 'eng1' : 'dispatcher')
  await page.goto('/board')
  await expect(page.locator('.kchips')).toBeVisible()
  await page.getByRole('button', { name: /^В работе/ }).first().click()
  await expect(page.getByTestId('col-in_progress')).toBeInViewport({ ratio: 0.3 })
  if (info.project.name === 'mobile') {
    await page.getByRole('tab', { name: /Список/ }).click()
    const cell = page.locator('.rtable td[data-label="Номер"]').first()
    await expect(cell).toBeVisible()
    await expect(page.locator('.rtable thead')).toBeHidden()   // таблица превращена в карточки
    await page.screenshot({ path: 'artifacts/screens/resp-mobile-list.png' })
    // диалог открывается нижней шторкой
    await page.getByRole('tab', { name: /Канбан/ }).click()
    await page.getByRole('button', { name: '+ Создать заявку' }).click()
    const box = (await page.getByRole('dialog').boundingBox())!
    const vp = page.viewportSize()!
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 2)
    expect(box.y + box.height).toBeGreaterThan(vp.height - 4)
  }
  await ctx.close()
})
