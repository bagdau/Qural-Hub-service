import { beforeEach, describe, expect, it } from 'vitest'
import { COLUMNS, applyFilters, columnOf, EMPTY_FILTERS, loadWorkspace, resolveDrop, saveWorkspace, slaView } from './boardLib'

const T = (status: string, allowed: string[]) => ({ id: 'x', status, allowed_actions: allowed })

describe('перетаскивание: правила переходов', () => {
  it('колонки покрывают все статусы', () => {
    for (const s of ['new', 'accepted', 'assigned', 'in_progress', 'paused', 'awaiting_confirmation', 'closed', 'rejected', 'cancelled']) expect(columnOf(s)).toBeTruthy()
    expect(COLUMNS).toHaveLength(5)
  })
  it('Новая → Назначена открывает назначение (диспетчер)', () => {
    expect(resolveDrop(T('new', ['accept', 'assign', 'reject', 'cancel']), 'assigned')).toEqual({ kind: 'modal', action: 'assign' })
  })
  it('инженер начинает работу перетаскиванием; диспетчер — нет', () => {
    expect(resolveDrop(T('assigned', ['start', 'pause']), 'in_progress')).toEqual({ kind: 'direct', action: 'start', to: 'in_progress' })
    expect(resolveDrop(T('assigned', ['reassign', 'cancel']), 'in_progress').kind).toBe('deny')
  })
  it('пауза и возобновление', () => {
    expect(resolveDrop(T('in_progress', ['pause', 'complete']), 'waiting')).toEqual({ kind: 'modal', action: 'pause' })
    expect(resolveDrop(T('paused', ['resume']), 'in_progress')).toEqual({ kind: 'direct', action: 'resume', to: 'in_progress' })
  })
  it('клиент: подтверждение и возврат из «Ждёт»', () => {
    expect(resolveDrop(T('awaiting_confirmation', ['confirm', 'return']), 'closed')).toEqual({ kind: 'modal', action: 'confirm' })
    expect(resolveDrop(T('awaiting_confirmation', ['confirm', 'return']), 'in_progress')).toEqual({ kind: 'modal', action: 'return' })
  })
  it('завершение работ — только через отчёт; обратно в «Новые» нельзя; та же колонка — noop', () => {
    expect(resolveDrop(T('in_progress', ['complete', 'pause']), 'closed').kind).toBe('navigate')
    expect(resolveDrop(T('assigned', ['start']), 'new').kind).toBe('deny')
    expect(resolveDrop(T('assigned', ['start']), 'assigned').kind).toBe('noop')
    expect(resolveDrop(T('new', ['accept']), 'in_progress').kind).toBe('deny')
  })
})

describe('SLA на карточке', () => {
  const now = Date.parse('2026-03-16T10:00:00Z')
  it('просрочка и обратный отсчёт', () => {
    const late = slaView({ status: 'in_progress', sla: { is_overdue: true, due_at: '2026-03-16T08:30:00Z', clock_running: true } }, now)
    expect(late).toMatchObject({ tone: 'bad', text: 'Просрочено на 1 ч 30 мин', pulse: true })
    const ok = slaView({ status: 'in_progress', sla: { is_overdue: false, due_at: '2026-03-16T10:45:00Z', clock_running: true, resolution_limit_seconds: 86400 } }, now)
    expect(ok).toMatchObject({ tone: 'warn', text: 'Осталось 45 мин', pulse: false })
    const far = slaView({ status: 'assigned', sla: { is_overdue: false, due_at: '2026-03-18T10:00:00Z', clock_running: true, resolution_limit_seconds: 259200 } }, now)
    expect(far.tone).toBe('ok')
  })
  it('часы остановлены на паузе и в ожидании клиента', () => {
    expect(slaView({ status: 'paused', sla: { is_overdue: false } }, now).tone).toBe('idle')
    expect(slaView({ status: 'awaiting_confirmation', sla: { is_overdue: false } }, now).text).toContain('часы остановлены')
  })
})

describe('фильтры и сохранение рабочего пространства', () => {
  const list = [
    { number: 'SR-2026-0017', title: 'Отключение шкафа', status: 'new', priority: 'critical', created_at: '2026-03-16T08:30:00Z', organization: { name: 'ТОО «Демо Логистик»' }, equipment: { name: 'КТП-160' }, assigned_engineer: null },
    { number: 'SR-2026-0003', title: 'Аварийное отключение', status: 'closed', priority: 'critical', created_at: '2026-03-06T02:00:00Z', organization: { name: 'ТОО «Демо Агро»' }, equipment: { name: 'Трансформатор' }, assigned_engineer: { id: 'e1', full_name: 'Инженер Демо-1' } },
  ]
  it('поиск по номеру, клиенту и оборудованию; статус; инженер; даты', () => {
    expect(applyFilters(list, { ...EMPTY_FILTERS, q: 'sr-2026-0017' })).toHaveLength(1)
    expect(applyFilters(list, { ...EMPTY_FILTERS, q: 'агро' })).toHaveLength(1)
    expect(applyFilters(list, { ...EMPTY_FILTERS, q: 'ктп-160' })).toHaveLength(1)
    expect(applyFilters(list, { ...EMPTY_FILTERS, statuses: ['closed'] })[0].number).toBe('SR-2026-0003')
    expect(applyFilters(list, { ...EMPTY_FILTERS, engineers: ['none'] })[0].number).toBe('SR-2026-0017')
    expect(applyFilters(list, { ...EMPTY_FILTERS, from: '2026-03-10' })).toHaveLength(1)
  })
  beforeEach(() => localStorage.clear())
  it('настройки восстанавливаются из LocalStorage', () => {
    saveWorkspace('u1', { view: 'gantt', density: 'compact', filters: { ...EMPTY_FILTERS, priorities: ['high'] } })
    expect(loadWorkspace('u1')).toMatchObject({ view: 'gantt', density: 'compact', filters: { priorities: ['high'] } })
    expect(loadWorkspace('u2').view).toBe('kanban')
    localStorage.setItem('ash-workspace-v1:u3', '{broken')
    expect(loadWorkspace('u3').view).toBe('kanban')
  })
})
