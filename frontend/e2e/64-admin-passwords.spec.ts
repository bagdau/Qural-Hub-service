import { expect, test } from '@playwright/test'
import { as } from './helpers'

test('PWD-01 администратор назначает пользователям разные пароли: при создании и позже; старые сеансы завершаются', async ({ browser }) => {
  const a = await as(browser, 'admin', { viewport: { width: 1280, height: 900 } })
  await a.page.goto('/admin/users')
  await a.page.getByRole('button', { name: 'Создать пользователя' }).click()
  const dlg = a.page.getByRole('dialog')
  const email = `pwd.${Date.now()}@demo.alageum.test`
  await dlg.getByLabel('Email').fill(email)
  await dlg.getByLabel('ФИО').fill('Пароль Тестов')
  await dlg.getByLabel('Организация').selectOption({ index: 1 })
  // слишком короткий пароль: понятная подсказка, создание не проходит
  await dlg.getByLabel('Пароль', { exact: true }).fill('короткий')
  await expect(dlg.getByText('Минимум 12 символов.').first()).toBeVisible()
  await dlg.getByRole('button', { name: 'Создать' }).click()
  await expect(dlg.getByRole('alert').first()).toBeVisible()
  // свой пароль, без принудительной смены
  await dlg.getByLabel('Пароль', { exact: true }).fill('Own-Password-1234')
  await dlg.getByRole('button', { name: 'Создать' }).click()
  await expect(a.page.getByTestId('temp-password')).toHaveCount(0)                  // временный пароль не создаётся
  await expect(dlg).toBeHidden()

  const login = async (pw: string) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    const p = await ctx.newPage()
    await p.goto('/login')
    await p.getByLabel('Email').fill(email)
    await p.getByLabel('Пароль').fill(pw)
    await p.getByRole('button', { name: 'Войти' }).click()
    return { ctx, p }
  }
  const first = await login('Own-Password-1234')
  await expect(first.p.getByRole('link', { name: /^Профиль: Пароль Тестов/ })).toBeVisible()   // вошёл без смены пароля

  // позже администратор задаёт другой пароль (с генератором)
  await a.page.getByPlaceholder('ФИО или email').fill(email)
  await a.page.getByRole('button', { name: /^Задать пароль: Пароль Тестов/ }).click()
  const d2 = a.page.getByRole('dialog', { name: /Задать пароль: Пароль Тестов/ })
  await d2.getByRole('button', { name: 'Сгенерировать' }).click()
  const generated = await d2.getByLabel('Пароль', { exact: true }).inputValue()
  expect(generated).toHaveLength(14)
  expect(generated).toMatch(/[A-Z]/); expect(generated).toMatch(/[a-z]/); expect(generated).toMatch(/\d/)
  await d2.getByLabel(/Потребовать смену/).check()
  await d2.getByRole('button', { name: 'Назначить пароль' }).click()
  await expect(d2).toBeHidden()

  // прежний сеанс завершён, старый пароль не подходит, новый работает и требует смены
  await first.p.reload()
  await expect(first.p).toHaveURL(/\/login/)
  await first.ctx.close()
  const old = await login('Own-Password-1234')
  await expect(old.p.getByRole('alert')).toContainText('Неверный email или пароль')
  await old.ctx.close()
  const fresh = await login(generated)
  await expect(fresh.p.getByRole('heading', { name: 'Смена временного пароля' })).toBeVisible()
  await fresh.ctx.close()

  // редактирование пользователя: поле «Новый пароль» в форме изменения
  await a.page.getByRole('button', { name: /^Изменить: Пароль Тестов/ }).click()
  const d3 = a.page.getByRole('dialog', { name: 'Изменить пользователя' })
  await expect(d3.getByLabel('Новый пароль')).toBeVisible()
  await d3.getByRole('button', { name: 'Отмена' }).click()
  await a.ctx.close()
})
