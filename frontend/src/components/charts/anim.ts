import { useEffect, useRef, useState } from 'react'

/** Пользователь отключил анимации в системе — показываем итоговое состояние сразу */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3)

/** Прогресс анимации появления 0 → 1 (с замедлением к концу). Запускается при показе компонента. */
export function useProgress(ms = 1000): number {
  const [p, setP] = useState(() => (prefersReducedMotion() ? 1 : 0))
  useEffect(() => {
    if (prefersReducedMotion()) { setP(1); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const x = Math.min(1, (t - t0) / ms)
      setP(easeOutCubic(x))
      if (x < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ms])
  return p
}

/** Плавный счётчик: от прежнего значения к новому. Итоговое значение всегда точное. */
export function useCountUp(target: number | null | undefined, ms = 900): number | null {
  const [val, setVal] = useState<number | null>(() => (prefersReducedMotion() || target == null ? target ?? null : 0))
  const from = useRef<number>(0)
  useEffect(() => {
    if (target == null) { setVal(null); return }
    if (prefersReducedMotion()) { setVal(target); from.current = target; return }
    let raf = 0
    const start = from.current, t0 = performance.now()
    const tick = (t: number) => {
      const x = Math.min(1, (t - t0) / ms)
      const v = x >= 1 ? target : start + (target - start) * easeOutCubic(x)
      setVal(v); from.current = v
      if (x < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return val
}

/** Затемняет цвет #rrggbb: боковые грани объёмных фигур */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`
}
export function tint(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const c = (v: number) => Math.round(v + (255 - v) * k)
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`
}
