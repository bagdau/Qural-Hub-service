import { useState } from 'react'
import { shade, useProgress } from './anim'

export interface PieDatum { key: string; label: string; value: number; color: string }

const TAU = Math.PI * 2

/**
 * Объёмная круговая диаграмма. Секторы «выезжают» по часовой стрелке при появлении, при наведении сектор выдвигается,
 * вся информация дублируется в легенде (кнопки — доступны с клавиатуры, нажатие открывает список).
 */
export function Pie3D({ data, onSelect, ariaLabel, totalLabel = 'Всего' }: { data: PieDatum[]; onSelect?: (key: string) => void; ariaLabel: string; totalLabel?: string }) {
  const p = useProgress(1300)
  const [hot, setHot] = useState<string | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0)
  const W = 400, H = 272, cx = 200, cy = 112, rx = 158, ry = 84
  const depth = 30 * Math.min(1, p * 2.2)
  const limit = -Math.PI / 2 + p * TAU
  let acc = -Math.PI / 2
  const slices = total > 0 ? data.filter((d) => d.value > 0).map((d) => {
    const a0 = acc, a1 = acc + (d.value / total) * TAU
    acc = a1
    return { ...d, a0, a1, e0: a0, e1: Math.min(a1, limit) }
  }).filter((s) => s.e1 - s.e0 > 1e-4) : []
  const pt = (a: number, dy = 0): [number, number] => [cx + rx * Math.cos(a), cy + ry * Math.sin(a) + dy]
  const fmt = (n: number) => n.toFixed(2)
  const top = (s: { e0: number; e1: number }) => {
    if (s.e1 - s.e0 >= TAU - 1e-3) return `M${fmt(cx - rx)} ${cy} A${rx} ${ry} 0 1 1 ${fmt(cx + rx)} ${cy} A${rx} ${ry} 0 1 1 ${fmt(cx - rx)} ${cy}Z`
    const [x0, y0] = pt(s.e0), [x1, y1] = pt(s.e1)
    return `M${cx} ${cy} L${fmt(x0)} ${fmt(y0)} A${rx} ${ry} 0 ${s.e1 - s.e0 > Math.PI ? 1 : 0} 1 ${fmt(x1)} ${fmt(y1)}Z`
  }
  // боковая стенка видна только у передней половины (sin > 0): углы 0…π
  const side = (s: { e0: number; e1: number }) => {
    const lo = Math.max(s.e0, 0), hi = Math.min(s.e1, Math.PI)
    if (hi - lo < 1e-4) return null
    const [x0, y0] = pt(lo), [x1, y1] = pt(hi)
    return `M${fmt(x0)} ${fmt(y0)} A${rx} ${ry} 0 0 1 ${fmt(x1)} ${fmt(y1)} L${fmt(x1)} ${fmt(y1 + depth)} A${rx} ${ry} 0 0 0 ${fmt(x0)} ${fmt(y0 + depth)}Z`
  }
  const ordered = [...slices].sort((a, b) => Math.sin((a.e0 + a.e1) / 2) - Math.sin((b.e0 + b.e1) / 2))
  return (
    <div className="pie3d">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHot(null)}>
        <defs>
          <radialGradient id="pie-shine" cx="50%" cy="28%" r="75%"><stop offset="0%" stopColor="#fff" stopOpacity=".38" /><stop offset="60%" stopColor="#fff" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity=".14" /></radialGradient>
          <filter id="pie-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        <ellipse cx={cx} cy={cy + depth + 20} rx={rx * 0.96} ry={ry * 0.62} fill="#101828" opacity=".2" filter="url(#pie-blur)" />
        {total === 0 && <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#e8ecf2" />}
        {ordered.map((s) => {
          const mid = (s.a0 + s.a1) / 2
          const on = hot === s.key
          const dim = hot !== null && !on
          const sd = side(s)
          return (
            <g key={s.key} className="pslice" style={{ transform: on ? `translate(${Math.cos(mid) * 16}px, ${Math.sin(mid) * 9 - 5}px)` : 'translate(0,0)', opacity: dim ? 0.5 : 1 }}
              onMouseEnter={() => setHot(s.key)} onClick={() => onSelect?.(s.key)}>
              {sd && <path d={sd} fill={shade(s.color, 0.66)} />}
              <path d={top(s)} fill={s.color} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
              <path d={top(s)} fill="url(#pie-shine)" pointerEvents="none" />
              {s.e1 - s.e0 > 0.28 && p > 0.9 && (() => { const [lx, ly] = [cx + rx * 0.62 * Math.cos(mid), cy + ry * 0.62 * Math.sin(mid)]; return <text x={lx} y={ly + 4} textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" stroke={shade(s.color, 0.5)} strokeWidth="2.2" paintOrder="stroke" pointerEvents="none">{s.value}</text> })()}
            </g>)
        })}
      </svg>
      <ul className="legend" aria-label="Легенда">
        {data.map((d) => (
          <li key={d.key}>
            <button type="button" className={`${hot === d.key ? 'on' : ''}`} onMouseEnter={() => setHot(d.key)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(d.key)} onBlur={() => setHot(null)}
              onClick={() => onSelect?.(d.key)} aria-label={`${d.label}: ${d.value}`}>
              <i style={{ background: d.color }} aria-hidden /><span className="lbl">{d.label}</span>
              <b className="mono">{d.value}</b><span className="pct mono">{total ? Math.round((100 * d.value) / total) : 0}%</span>
            </button>
          </li>))}
        <li className="legend-total"><span>{totalLabel}</span><b className="mono">{total}</b></li>
      </ul>
    </div>
  )
}
