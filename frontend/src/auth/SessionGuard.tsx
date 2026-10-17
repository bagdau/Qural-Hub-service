import { useEffect, useRef, useState } from 'react'
import { get } from '../api/client'
import { Button } from '../components/ui'

export const EXPIRED_KEY = 'alageum.expired'
const WARN_MS = 60_000

/** Состояние сеанса по времени без действий: ok — всё в порядке, warn — осталась минута, expired — сеанс истёк */
export function idleStatus(now: number, lastActivity: number, ttlMs: number, warnMs = WARN_MS): 'ok' | 'warn' | 'expired' {
  const idle = now - lastActivity
  return idle >= ttlMs ? 'expired' : idle >= ttlMs - warnMs ? 'warn' : 'ok'
}

/**
 * Сеанс: 10 минут без действий → выход. Пока пользователь что-то делает, браузер раз в треть срока «пингует» сервер,
 * чтобы сеанс не истёк посреди работы; за минуту до выхода показывается предупреждение с кнопкой «Продолжить работу».
 */
export function SessionGuard({ ttlSeconds, onExpire }: { ttlSeconds: number; onExpire: () => void }) {
  const ttl = ttlSeconds * 1000
  const last = useRef(Date.now())
  const pinged = useRef(Date.now())
  const [left, setLeft] = useState<number | null>(null)
  const expire = useRef(onExpire); expire.current = onExpire

  useEffect(() => {
    const touch = () => { last.current = Date.now(); setLeft((v) => (v === null ? v : null)) }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }))
    const tick = () => {
      const now = Date.now()
      const st = idleStatus(now, last.current, ttl)
      if (st === 'expired') { expire.current(); return }
      setLeft(st === 'warn' ? Math.max(1, Math.ceil((ttl - (now - last.current)) / 1000)) : null)
      // пользователь работает, а запросов к серверу нет (чтение, заполнение формы) — продлеваем сеанс
      if (last.current > pinged.current && now - pinged.current > ttl / 3) { pinged.current = now; get('/auth/me').catch(() => { /* 401 обработает общий обработчик */ }) }
    }
    const id = window.setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    return () => { events.forEach((e) => window.removeEventListener(e, touch, true)); window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [ttl])

  if (left === null) return null
  return (
    <div className="sess-warn" role="alert">
      <span>Сеанс завершится через <b>{left} с</b> из-за бездействия.</span>
      <Button small variant="primary" onClick={() => { last.current = Date.now(); pinged.current = Date.now(); setLeft(null); get('/auth/me').catch(() => {}) }}>Продолжить работу</Button>
    </div>
  )
}
