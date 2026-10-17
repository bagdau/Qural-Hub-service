import { act, render, screen, fireEvent } from '@testing-library/react'
import { SessionGuard, idleStatus } from './SessionGuard'

vi.mock('../api/client', () => ({ get: vi.fn(() => Promise.resolve({})) }))

describe('сеанс: 10 минут без действий', () => {
  it('idleStatus: ok → warn за минуту → expired через 10 минут', () => {
    const ttl = 600_000
    expect(idleStatus(1_000_000 + 60_000, 1_000_000, ttl)).toBe('ok')
    expect(idleStatus(1_000_000 + 541_000, 1_000_000, ttl)).toBe('warn')
    expect(idleStatus(1_000_000 + 600_000, 1_000_000, ttl)).toBe('expired')
  })

  it('предупреждает за минуту, активность сбрасывает отсчёт, без активности — выход', () => {
    vi.useFakeTimers()
    const onExpire = vi.fn()
    render(<SessionGuard ttlSeconds={600} onExpire={onExpire} />)
    act(() => { vi.advanceTimersByTime(545_000) })
    expect(screen.getByRole('alert')).toHaveTextContent('Сеанс завершится через')
    act(() => { fireEvent.pointerDown(window) })                              // пользователь вернулся
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => { vi.advanceTimersByTime(545_000) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onExpire).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(70_000) })
    expect(onExpire).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
