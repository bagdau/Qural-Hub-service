import { Browser, BrowserContext, Page, expect } from '@playwright/test'

export async function as(browser: Browser, role: string, opts: Record<string, any> = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: `./artifacts/.auth/${role}.json`, locale: 'ru-RU', ...opts })
  const page = await ctx.newPage()
  return { ctx, page }
}

export async function selectByText(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByLabel(label).selectOption({ label: typeof option === 'string' ? option : undefined as any }).catch(async () => {
    const sel = page.getByLabel(label)
    const opts = await sel.locator('option').allTextContents()
    const found = opts.find((o) => (typeof option === 'string' ? o.includes(option) : option.test(o)))
    if (!found) throw new Error(`нет опции ${option} в ${label}`)
    await sel.selectOption({ label: found })
  })
}

export function png(): Buffer {
  // 1x1 PNG (валидный), сервер перекодирует и создаёт миниатюру
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
}

export async function noHorizontalScroll(page: Page) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(w.sw, `горизонтальная прокрутка: ${w.sw} > ${w.cw}`).toBeLessThanOrEqual(w.cw + 1)
}
