import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './anim'

/** Полукруглый датчик 0–100 %: дуга «заполняется» при появлении. Цвет задаёт смысл (зелёный — хорошо, красный — плохо). */
export function Gauge({ value, color, label, size = 112 }: { value: number | null | undefined; color: string; label?: string; size?: number }) {
  const [on, setOn] = useState(prefersReducedMotion())
  useEffect(() => { const t = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(t) }, [])
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <svg className="gauge" width={size} height={size * 0.62} viewBox="0 0 120 74" role="img" aria-label={label ?? (value == null ? 'нет данных' : `${Math.round(v)} из 100`)}>
      <path d="M12 64 A48 48 0 0 1 108 64" pathLength={100} fill="none" stroke="#e8ecf2" strokeWidth="13" strokeLinecap="round" />
      <path d="M12 64 A48 48 0 0 1 108 64" pathLength={100} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round"
        strokeDasharray={`${on ? v : 0} 100`} style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1)' }} />
      <g stroke="#9aa6b8" strokeWidth="1.2" strokeLinecap="round">
        {[0, 25, 50, 75, 100].map((t) => { const a = Math.PI * (1 - t / 100); return <line key={t} x1={60 + 38 * Math.cos(a)} y1={64 - 38 * Math.sin(a)} x2={60 + 33 * Math.cos(a)} y2={64 - 33 * Math.sin(a)} /> })}
      </g>
    </svg>
  )
}
