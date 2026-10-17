import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/** Фотографии за боковой панелью (поверх — тёмно-фиолетовая вуаль, чтобы меню читалось). Лежат в public/bg. */
export const SIDE_PHOTOS = [
  { src: '/bg/lake.webp', name: 'Озеро' },
  { src: '/bg/mountains.webp', name: 'Горы' },
]
const KEY = 'alageum.side-bg'
const read = () => { try { const v = Number(localStorage.getItem(KEY)); return Number.isInteger(v) && v >= 0 && v < SIDE_PHOTOS.length ? v : 0 } catch { return 0 } }

/** Фон боковой панели: плавная смена фотографий каждые 30 секунд и кнопка ручной смены. Выбор запоминается. */
export function useSideBackdrop() {
  const [i, setI] = useState(read)
  const timer = useRef<number | undefined>(undefined)
  const arm = () => { window.clearInterval(timer.current); timer.current = window.setInterval(() => setI((v) => (v + 1) % SIDE_PHOTOS.length), 30_000) }
  useEffect(() => { arm(); return () => window.clearInterval(timer.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(KEY, String(i)) } catch { /* без хранилища */ } }, [i])
  const next = () => { setI((v) => (v + 1) % SIDE_PHOTOS.length); arm() }
  return { index: i, next }
}

export function SideBackdrop({ index }: { index: number }) {
  return (
    <div className="side-bg" aria-hidden>
      {SIDE_PHOTOS.map((p, k) => <i key={p.src} className={k === index ? 'on' : ''} style={{ backgroundImage: `url(${p.src})` }} />)}
      <span className="side-scrim" />
    </div>
  )
}

export function BackdropButton({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <button type="button" className="bg-next" onClick={onClick} aria-label="Сменить фоновое изображение" title={`Фон: ${name}. Нажмите, чтобы сменить`}>
      <Icon name="image" size={18} />
    </button>
  )
}
