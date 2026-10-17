import { useState } from 'react'
import { shade, tint, useProgress } from './anim'

export interface ColumnDatum { key: string; label: string; value: number; color: string; /** вторая, «призрачная» колонка за основной: вместимость, норма */ ghost?: number; note?: string }

/**
 * Изометрические объёмные колонки. Колонки вырастают по очереди; ghost — полупрозрачная колонка позади (например, вместимость инженера).
 * Подписи и значения выводятся и текстом (читаются с экрана и дикторами), цвет не единственный признак.
 */
export function Columns3D({ data, ariaLabel, unit = '', onSelect }: { data: ColumnDatum[]; ariaLabel: string; unit?: string; onSelect?: (key: string) => void }) {
  const p = useProgress(1200)
  const [hot, setHot] = useState<string | null>(null)
  const n = Math.max(1, data.length)
  const colW = n > 5 ? 38 : 52, gap = n > 5 ? 26 : 38, dx = 22, dy = -13
  const baseY = 214, maxH = 150
  const natural = n * colW + (n - 1) * gap + dx
  const W = Math.max(natural + 64, 390)            // минимальная ширина: при двух колонках диаграмма не раздувается
  const left = (W - natural) / 2
  const maxV = Math.max(1, ...data.map((d) => Math.max(d.value, d.ghost ?? 0)))
  const step = (() => { const raw = maxV / 4; const pow = Math.pow(10, Math.floor(Math.log10(raw))); const m = [1, 2, 2.5, 5, 10].find((k) => k * pow >= raw) ?? 10; return m * pow })()
  const ticks: number[] = []
  for (let v = 0; ; v += step) { ticks.push(v); if (v >= maxV - 1e-9) break }   // шкала всегда покрывает максимум
  const top = Math.max(...ticks)
  const yOf = (v: number) => baseY - (v / top) * maxH
  const H = baseY + 46
  const x0 = Math.max(26, left - 18), x1 = W - x0 - dx

  const box = (x: number, h: number, color: string, opacity = 1, id = '') => {
    if (h <= 0.4) return null
    const y = baseY - h
    return (
      <g opacity={opacity} key={id}>
        <polygon points={`${x + colW},${baseY} ${x + colW + dx},${baseY + dy} ${x + colW + dx},${y + dy} ${x + colW},${y}`} fill={shade(color, 0.62)} />
        <rect x={x} y={y} width={colW} height={h} fill={color} />
        <rect x={x} y={y} width={colW} height={h} fill="url(#col-shine)" />
        <polygon points={`${x},${y} ${x + colW},${y} ${x + colW + dx},${y + dy} ${x + dx},${y + dy}`} fill={tint(color, 0.38)} />
      </g>)
  }
  return (
    <div className="cols3d">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHot(null)}>
        <defs>
          <linearGradient id="col-shine" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".16" /></linearGradient>
        </defs>
        {/* пол и сетка */}
        <polygon points={`${x0},${baseY} ${x1 + dx},${baseY} ${x1 + dx + dx},${baseY + dy} ${x0 + dx},${baseY + dy}`} fill="#eef1f6" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x0 + dx} y1={yOf(t) + dy} x2={x1 + dx + dx} y2={yOf(t) + dy} stroke="#dfe4ec" strokeWidth="1" strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={x0 - 6} y={yOf(t) + 4} textAnchor="end" fontSize="11" fill="#667085">{t}{unit}</text>
          </g>))}
        {data.map((d, i) => {
          const x = left + i * (colW + gap)
          const pi = Math.max(0, Math.min(1, p * 1.5 - i * 0.1))
          const h = (d.value / top) * maxH * pi
          const gh = d.ghost != null ? (d.ghost / top) * maxH * pi : 0
          const on = hot === d.key
          return (
            <g key={d.key} className="col3" style={{ transform: on ? 'translateY(-5px)' : 'translateY(0)', opacity: hot && !on ? 0.55 : 1, cursor: onSelect ? 'pointer' : 'default' }}
              onMouseEnter={() => setHot(d.key)} onClick={() => onSelect?.(d.key)}>
              {gh > 0 && box(x + dx * 0.5, gh, '#b8c2d4', 0.4, `g${d.key}`)}
              {box(x, h, d.color, 1, d.key)}
              <text x={x + colW / 2 + dx / 2} y={baseY - h + dy - 7} textAnchor="middle" fontSize="14" fontWeight="800" fill="#101828" opacity={pi > 0.85 ? 1 : 0}>{d.value}{unit}</text>
              <text x={x + colW / 2 + dx / 2} y={baseY + 18} textAnchor="middle" fontSize="12" fontWeight="600" fill="#344054">{d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label}</text>
              {d.note && <text x={x + colW / 2 + dx / 2} y={baseY + 33} textAnchor="middle" fontSize="11" fill="#667085">{d.note}</text>}
              <title>{`${d.label}: ${d.value}${unit}${d.ghost != null ? ` из ${d.ghost}${unit}` : ''}${d.note ? ` · ${d.note}` : ''}`}</title>
            </g>)
        })}
      </svg>
      <ul className="sr-only">{data.map((d) => <li key={d.key}>{d.label}: {d.value}{unit}{d.ghost != null ? ` из ${d.ghost}${unit}` : ''}{d.note ? `, ${d.note}` : ''}</li>)}</ul>
    </div>
  )
}
