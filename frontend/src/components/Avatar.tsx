const GRADS = [
  ['#7b5cf5', '#4535b5'], ['#ff7a45', '#d9306a'], ['#18b58a', '#0b7d6a'], ['#3b82f6', '#4f46e5'], ['#f59e0b', '#d9480f'], ['#ec4899', '#9333ea'],
]
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

/** Круглый аватар с инициалами; цвет стабильно выбирается по имени */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const [a, b] = GRADS[hash(name) % GRADS.length]
  return (
    <span className="avatar" aria-hidden style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `linear-gradient(135deg, ${a}, ${b})` }}>{initialsOf(name)}</span>
  )
}
