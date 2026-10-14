import { expect, test } from '@playwright/test'
import { as, png } from './helpers'

// E2E-01: полный сквозной сценарий клиент → диспетчер → инженер → клиент
test('E2E-01 полный цикл заявки', async ({ browser }) => {
  // 1. Клиент создаёт заявку
  const cl = await as(browser, 'cl1')
  await cl.page.goto('/tickets/new')
  const sel = cl.page.getByLabel('Оборудование')
  await expect(sel.locator('option', { hasText: 'DM-KTP-0002' })).toHaveCount(1)
  const opts = await sel.locator('option').allTextContents()
  await sel.selectOption({ label: opts.find((o) => o.includes('DM-KTP-0002'))! })
  await cl.page.getByLabel('Тема').fill('E2E: гул и нагрев КТП')
  await cl.page.getByLabel('Описание').fill('Сквозной тест: слышен гул, корпус горячий, запаха гари нет.')
  await cl.page.getByLabel(/Срочно/).check()
  await cl.page.getByRole('button', { name: 'Отправить заявку' }).click()
  const heading = cl.page.getByRole('heading', { name: /Заявка SR-\d{4}-\d{4} создана/ })
  await expect(heading).toBeVisible()
  const number = (await heading.textContent())!.match(/SR-\d{4}-\d{4}/)![0]
  await cl.page.locator('input[type=file][multiple]').setInputFiles({ name: 'problem.png', mimeType: 'image/png', buffer: png() })
  await expect(cl.page.getByText('✓ Загружено')).toBeVisible()
  await cl.page.getByRole('button', { name: /Готово/ }).click()
  await expect(cl.page.getByRole('heading', { name: 'E2E: гул и нагрев КТП' })).toBeVisible()
  const ticketUrl = cl.page.url()
  await expect(cl.page.getByText('Новая').first()).toBeVisible()

  // 2. Диспетчер принимает и назначает
  const d = await as(browser, 'dispatcher')
  await d.page.goto(ticketUrl)
  await d.page.getByRole('button', { name: 'Назначить инженера' }).click()
  const dlg = d.page.getByRole('dialog')
  const engSel = dlg.getByLabel('Инженер', { exact: true })
  await expect(engSel.locator('option')).toHaveCount(3)
  await engSel.selectOption({ index: 2 })
  await dlg.getByLabel('Приоритет').selectOption('high')
  await dlg.getByRole('button', { name: 'Назначить инженера' }).click()
  await expect(d.page.locator('.badge', { hasText: 'Назначена' })).toBeVisible()
  const engName = await d.page.locator('dd', { hasText: 'Инженер Демо' }).first().textContent()
  const engRole = engName!.includes('Демо-1') ? 'eng1' : 'eng2'

  // 3. Инженер: начать работу, отчёт, завершение
  const e = await as(browser, engRole)
  await e.page.goto(ticketUrl)
  await e.page.getByRole('button', { name: 'Начать работу' }).first().click()
  await e.page.getByRole('dialog').getByRole('button', { name: 'Начать работу' }).click()
  await expect(e.page.locator('.badge', { hasText: 'В работе' })).toBeVisible()
  await e.page.getByRole('link', { name: /Отчёт|отчёт/ }).or(e.page.getByRole('button', { name: /Отчёт/ })).first().click()
  await expect(e.page).toHaveURL(/\/report$/)
  // 1. диагностика
  await e.page.getByLabel('Результаты диагностики').fill('Ослабление контактных соединений на вводе, локальный нагрев.')
  await e.page.getByRole('button', { name: 'Далее →' }).click()
  // 2. чек-лист
  for (const b of await e.page.getByRole('button', { name: 'Норма', exact: true }).all()) await b.click()
  await e.page.getByLabel('Положение коммутационных аппаратов').selectOption('normal')
  await e.page.getByLabel('Сопротивление изоляции').first().fill('900')
  await e.page.getByRole('button', { name: 'Далее →' }).click()
  // 3. работы
  await e.page.getByLabel('Выполненные работы').fill('Подтянуты контакты, проверка тепловизором, замеры выполнены.')
  await e.page.getByLabel('Результат', { exact: true }).selectOption('resolved')
  await e.page.getByLabel('Итог для клиента').fill('Нагрев устранён.')
  await e.page.getByRole('button', { name: 'Далее →' }).click()
  // 4. запчасти
  await e.page.getByLabel('Позиция справочника').selectOption({ index: 3 })
  await e.page.getByRole('button', { name: 'Добавить' }).click()
  await expect(e.page.getByText(/— 1 /)).toBeVisible()
  await e.page.getByLabel(/Подтверждаю список запчастей/).check()
  await e.page.getByRole('button', { name: 'Далее →' }).click()
  // 5. фото
  const files = e.page.locator('input[type=file][multiple]')
  await e.page.getByLabel('Стадия фото').selectOption('before')
  await files.setInputFiles({ name: 'before.png', mimeType: 'image/png', buffer: png() })
  await expect(e.page.getByText('До: 1')).toBeVisible()
  await e.page.getByLabel('Стадия фото').selectOption('after')
  await files.setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: png() })
  await expect(e.page.getByText('После: 1')).toBeVisible()
  await e.page.getByRole('button', { name: 'Далее →' }).click()
  // 6. проверка и завершение
  await expect(e.page.getByText('Все обязательные условия выполнены')).toBeVisible({ timeout: 15000 })
  await e.page.getByRole('button', { name: 'Завершить работы' }).click()
  await expect(e.page.locator('.badge', { hasText: 'Ждёт подтверждения' })).toBeVisible()

  // 4. Клиент проверяет акт и подтверждает
  await cl.page.goto(ticketUrl)
  await cl.page.getByRole('link', { name: 'Открыть акт' }).first().click()
  await expect(cl.page.getByRole('heading', { name: new RegExp(`Акт ${number}-A1`) })).toBeVisible()
  await expect(cl.page.locator('iframe[title^="PDF акта"]')).toBeVisible()
  await cl.page.getByRole('button', { name: 'Подтвердить результат' }).click()
  await cl.page.getByRole('dialog').getByRole('button', { name: 'Подтвердить результат' }).click()
  await expect(cl.page.getByRole('heading', { name: 'E2E: гул и нагрев КТП' })).toBeVisible()
  await expect(cl.page.locator('.badge', { hasText: 'Закрыта' })).toBeVisible()
  await expect(cl.page.getByText('Результат подтверждён').or(cl.page.getByText('Подтверждён')).first()).toBeVisible()

  // история видна руководителю
  const m = await as(browser, 'manager')
  await m.page.goto(ticketUrl)
  await expect(m.page.getByText('Результат подтверждён')).toBeVisible()
  for (const x of [cl, d, e, m]) await x.ctx.close()
})

// E2E-02: возврат на доработку и новая версия акта
test('E2E-02 возврат на доработку', async ({ browser }) => {
  const cl = await as(browser, 'cl1')
  await cl.page.goto('/tickets?q=SR-2026-0006')
  await cl.page.getByRole('link', { name: 'SR-2026-0006' }).first().click()
  await cl.page.getByRole('link', { name: 'Открыть акт' }).first().click()
  await cl.page.getByRole('button', { name: 'Вернуть на доработку' }).first().click()
  const dlg = cl.page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Вернуть на доработку' }).click() // без комментария
  await expect(dlg.getByText(/не менее 10|мин/i).first()).toBeVisible()
  await dlg.getByLabel('Что нужно доработать').fill('Нагрев вводов остался, прошу проверить ещё раз.')
  await dlg.getByRole('button', { name: 'Вернуть на доработку' }).click()
  await expect(cl.page.locator('.badge', { hasText: 'В работе' })).toBeVisible()
  await expect(cl.page.getByText('Неактуален — возвращён клиентом')).toBeVisible()
  await cl.ctx.close()
})

// E2E-08: администратор создаёт пользователя, временный пароль, принудительная смена
test('E2E-08 создание пользователя и смена временного пароля', async ({ browser }) => {
  const a = await as(browser, 'admin')
  await a.page.goto('/admin/users')
  await a.page.getByRole('button', { name: 'Создать пользователя' }).click()
  const email = `e2e.${Date.now()}@demo.alageum.test`
  const dlg = a.page.getByRole('dialog')
  await dlg.getByLabel('Email').fill(email)
  await dlg.getByLabel('ФИО').fill('E2E Тестовый Клиент')
  await dlg.getByLabel('Организация').selectOption({ index: 1 })
  await dlg.getByRole('button', { name: 'Создать' }).click()
  const temp = (await a.page.getByTestId('temp-password').textContent())!.trim()
  expect(temp.length).toBe(14)
  await a.page.getByRole('button', { name: 'Я передал(а) пароль' }).click()
  await expect(a.page.getByTestId('temp-password')).toHaveCount(0)
  await a.ctx.close()
  const ctx = await browser.newContext({ locale: 'ru-RU' })
  const p = await ctx.newPage()
  await p.goto('/login')
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Пароль').fill(temp)
  await p.getByRole('button', { name: 'Войти' }).click()
  await expect(p.getByRole('heading', { name: 'Смена временного пароля' })).toBeVisible()
  await p.getByLabel('Текущий (временный) пароль').fill(temp)
  await p.getByLabel('Новый пароль', { exact: true }).fill('E2E-Strong-Pass-2026')
  await p.getByLabel('Повторите новый пароль').fill('E2E-Strong-Pass-2026')
  await p.getByRole('button', { name: 'Сохранить пароль' }).click()
  await expect(p.getByRole('heading', { name: 'Главная' })).toBeVisible()
  await ctx.close()
})
