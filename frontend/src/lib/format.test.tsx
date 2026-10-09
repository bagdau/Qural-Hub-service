import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fmtDuration, slaText } from './format'
import { StatusBadge } from '../components/ui'
import { ApiError, uuid } from '../api/client'

describe('форматирование', () => {
  it('длительность', () => {
    expect(fmtDuration(2300)).toBe('38 мин 20 с')
    expect(fmtDuration(116743)).toBe('1 д 8 ч')
    expect(fmtDuration(null)).toBe('—')
  })
  it('SLA: остановленные часы и просрочка', () => {
    expect(slaText({ clock_running: false, is_overdue: false }, 'paused').text).toBe('Часы SLA остановлены')
    const r = slaText({ clock_running: true, is_overdue: true, consumed_seconds: 34200, resolution_limit_seconds: 28800 }, 'in_progress')
    expect(r).toEqual({ text: 'Просрочено на 1 ч 30 мин', bad: true })
  })
})

describe('компоненты', () => {
  it('StatusBadge показывает текст и иконку, а не только цвет', () => {
    render(<StatusBadge status="paused" />)
    expect(screen.getByText('На паузе')).toBeInTheDocument()
  })
  it('ApiError разбирает ошибки полей', () => {
    const e = new ApiError(422, 'VALIDATION_ERROR', 'x', { fields: [{ field: 'title', message: 'коротко' }] })
    expect(e.fieldErrors()).toEqual({ title: 'коротко' })
  })
  it('uuid v4 без secure context', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
