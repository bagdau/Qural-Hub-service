import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { as } from './helpers'

const PAGES: [string, string, string][] = [
  ['manager', '/', 'dashboard'], ['dispatcher', '/tickets', 'tickets'], ['manager', '/equipment', 'equipment'],
  ['admin', '/admin/users', 'users'], ['admin', '/admin/checklists', 'checklists'], ['admin', '/admin/sla', 'sla'],
  ['cl1', '/', 'client-home'], ['cl1', '/tickets', 'client-tickets'], ['dispatcher', '/maintenance', 'maintenance'],
  ['eng1', '/my-tasks', 'engineer-tasks'], ['cl1', '/notifications', 'notifications'], ['admin', '/admin/organizations', 'orgs'],
  ['dispatcher', '/admin/spare-parts', 'spare-parts'], ['admin', '/admin/audit', 'audit'], ['dispatcher', '/board', 'board'], ['cl1', '/board', 'board-client'],
]

test('E2E-10 скриншоты и доступность ключевых экранов (axe)', async ({ browser }) => {
  const problems: string[] = []
  for (const [role, path, name] of PAGES) {
    const { ctx, page } = await as(browser, role, { viewport: { width: 1280, height: 800 } })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `artifacts/screens/${name}.png`, fullPage: true })
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    for (const v of res.violations.filter((x) => ['serious', 'critical'].includes(x.impact ?? ''))) problems.push(`${name}: ${v.id} (${v.impact}) — ${v.nodes.length} шт: ${v.nodes[0]?.target?.join(' ')}`)
    await ctx.close()
  }
  // детальные страницы
  const d = await as(browser, 'dispatcher', { viewport: { width: 1280, height: 800 } })
  for (const [q, name] of [['SR-2026-0002', 'ticket-closed-returned'], ['SR-2026-0012', 'ticket-paused'], ['SR-2026-0017', 'ticket-new-overdue']]) {
    await d.page.goto(`/tickets?q=${q}`)
    await d.page.getByRole('link', { name: q }).first().click()
    await d.page.waitForLoadState('networkidle')
    await d.page.screenshot({ path: `artifacts/screens/${name}.png`, fullPage: true })
    const res = await new AxeBuilder({ page: d.page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    for (const v of res.violations.filter((x) => ['serious', 'critical'].includes(x.impact ?? ''))) problems.push(`${name}: ${v.id} (${v.impact}): ${v.nodes[0]?.target?.join(' ')}`)
  }
  await d.page.goto('/equipment?q=DM-TR-0001')
  await d.page.getByRole('link', { name: /Трансформатор ТМ-1000/ }).first().click()
  await d.page.waitForLoadState('networkidle')
  await d.page.screenshot({ path: 'artifacts/screens/passport.png', fullPage: true })
  await d.page.getByRole('tab', { name: 'История' }).click()
  await d.page.waitForLoadState('networkidle')
  await d.page.screenshot({ path: 'artifacts/screens/passport-history.png', fullPage: true })
  await d.ctx.close()
  const anon = await (await browser.newContext()).newPage()
  await anon.goto('/login')
  await anon.screenshot({ path: 'artifacts/screens/login.png' })
  const res = await new AxeBuilder({ page: anon }).withTags(['wcag2a', 'wcag2aa']).analyze()
  for (const v of res.violations.filter((x) => ['serious', 'critical'].includes(x.impact ?? ''))) problems.push(`login: ${v.id} (${v.impact})`)
  expect(problems, problems.join('\n')).toEqual([])
})

test('E2E-10 prefers-reduced-motion отключает анимации и нет внешних запросов', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', storageState: './artifacts/.auth/manager.json' })
  const p = await ctx.newPage()
  const external: string[] = []
  p.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', 'web', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()) })
  await p.goto('/')
  await p.waitForLoadState('networkidle')
  await p.locator('.kpi').first().click()
  const anim = await p.evaluate(() => [...document.querySelectorAll('*')].filter((el) => { const s = getComputedStyle(el); return (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.001) || parseFloat(s.transitionDuration) > 0.001 }).length)
  expect(anim).toBe(0)
  expect(external).toEqual([])
  await ctx.close()
})
