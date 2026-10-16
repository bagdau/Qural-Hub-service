import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Icon } from './Icon'
import { distanceKm, fmtKm, routeUrl } from '../lib/geo'

export interface MapPoint { id: string; lat: number; lon: number; title: string; subtitle?: string; href?: string; tone?: 'ok' | 'warn' | 'bad' }

interface Props {
  points: MapPoint[]
  height?: number | string
  selectedId?: string
  /** Режим выбора места щелчком по карте (форма площадки) */
  pick?: { lat: number; lon: number } | null
  onPick?: (lat: number, lon: number) => void
  onNavigate?: (href: string) => void
  /** Кнопка «Моё местоположение» */
  locate?: boolean
  label: string
}

const TONE: Record<string, string> = { ok: '#0d7a5f', warn: '#d97706', bad: '#c0392b' }
const pin = (color: string) => L.divIcon({
  className: 'map-pin', iconSize: [30, 38], iconAnchor: [15, 36], popupAnchor: [0, -32],
  html: `<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 1C7.8 1 2 6.8 2 14c0 9.6 13 23 13 23s13-13.4 13-23C28 6.8 22.2 1 15 1z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>`,
})

/** Карта OpenStreetMap (Leaflet). Подгружается отдельным куском только на страницах с картой. */
export default function LeafletMap({ points, height = 320, selectedId, pick, onPick, onNavigate, locate, label }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const me = useRef<L.LayerGroup | null>(null)
  const pickMarker = useRef<L.Marker | null>(null)
  const fitted = useRef(false)
  const [mine, setMine] = useState<[number, number] | null>(null)
  const [msg, setMsg] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null)
  const [tilesFailed, setTilesFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const onPickRef = useRef(onPick); onPickRef.current = onPick
  const onNavRef = useRef(onNavigate); onNavRef.current = onNavigate

  useEffect(() => {
    if (!box.current || map.current) return
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([43.25, 76.93], 11)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(m)
    tiles.on('tileerror', () => setTilesFailed(true))
    tiles.on('tileload', () => setTilesFailed(false))
    layer.current = L.layerGroup().addTo(m)
    me.current = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => onPickRef.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))))
    map.current = m
    // карта внутри скрытых/анимированных блоков получает размер позже
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(box.current)
    return () => { ro.disconnect(); m.remove(); map.current = null }
  }, [])

  // метки объектов
  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const bounds: [number, number][] = []
    for (const p of points) {
      const mk = L.marker([p.lat, p.lon], { icon: pin(TONE[p.tone ?? 'ok'] ?? TONE.ok), title: p.title, keyboard: true, alt: p.title })
      const el = document.createElement('div')
      el.className = 'map-pop'
      const b = document.createElement('b'); b.textContent = p.title; el.appendChild(b)
      if (p.subtitle) { const s = document.createElement('div'); s.className = 'small'; s.textContent = p.subtitle; el.appendChild(s) }
      const links = document.createElement('div'); links.className = 'map-pop-links'
      if (p.href) {
        const a = document.createElement('a'); a.href = p.href; a.textContent = 'Открыть'
        a.addEventListener('click', (ev) => { if (onNavRef.current) { ev.preventDefault(); onNavRef.current(p.href!) } })
        links.appendChild(a)
      }
      const r = document.createElement('a'); r.href = routeUrl([p.lat, p.lon], mine); r.target = '_blank'; r.rel = 'noreferrer'; r.textContent = 'Маршрут'; links.appendChild(r)
      if (mine) { const d = document.createElement('div'); d.className = 'small'; d.textContent = `От вас: ${fmtKm(distanceKm(mine, [p.lat, p.lon]))}`; el.appendChild(d) }
      el.appendChild(links)
      mk.bindPopup(el)
      mk.addTo(g)
      if (p.id === selectedId) mk.openPopup()
      bounds.push([p.lat, p.lon])
    }
    if (!fitted.current && bounds.length) {
      fitted.current = true
      if (bounds.length === 1) m.setView(bounds[0], 16)
      else m.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 })
    }
  }, [points, selectedId, mine])

  // выбранная щелчком точка
  useEffect(() => {
    const m = map.current
    if (!m) return
    pickMarker.current?.remove()
    pickMarker.current = null
    if (pick) { pickMarker.current = L.marker([pick.lat, pick.lon], { icon: pin('#2563eb'), keyboard: false }).addTo(m); if (!fitted.current) { m.setView([pick.lat, pick.lon], 15); fitted.current = true } }
  }, [pick])

  const findMe = () => {
    setMsg(null)
    if (!window.isSecureContext) { setMsg({ kind: 'warn', text: 'Браузер разрешает геолокацию только на защищённых страницах (HTTPS). Откройте сайт по https:// и повторите.' }); return }
    if (!navigator.geolocation) { setMsg({ kind: 'warn', text: 'Устройство не поддерживает определение местоположения.' }); return }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false)
        const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setMine(ll)
        const m = map.current, g = me.current
        if (!m || !g) return
        g.clearLayers()
        L.circle(ll, { radius: pos.coords.accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.12 }).addTo(g)
        L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(g).bindTooltip('Вы здесь')
        const all: [number, number][] = [ll, ...points.map((p) => [p.lat, p.lon] as [number, number])]
        m.fitBounds(all, { padding: [40, 40], maxZoom: 16 })
        setMsg({ kind: 'info', text: `Ваше местоположение определено (точность ≈ ${Math.round(pos.coords.accuracy)} м).` })
        if (onPickRef.current && !points.length) onPickRef.current(Number(ll[0].toFixed(6)), Number(ll[1].toFixed(6)))
      },
      (err) => {
        setBusy(false)
        setMsg({ kind: 'warn', text: err.code === 1 ? 'Доступ к местоположению запрещён. Разрешите его для этого сайта в настройках браузера.' : err.code === 3 ? 'Не удалось определить местоположение вовремя. Выйдите на открытое место и повторите.' : 'Местоположение недоступно. Включите GPS/геолокацию на устройстве.' })
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }

  return (
    <div className="map-wrap">
      <div className="map" ref={box} style={{ height }} role="application" aria-label={label} />
      {tilesFailed && <div className="banner warn small" role="status">Не удалось загрузить подложку карты (нужен доступ в интернет). Метки объектов остаются на месте.</div>}
      {(locate || msg) && (
        <div className="map-bar">
          {locate && <button type="button" className="btn sm" onClick={findMe} disabled={busy}><Icon name="pin" size={16} /> {busy ? 'Определяем…' : 'Моё местоположение'}</button>}
          {msg && <span className={`small ${msg.kind === 'warn' ? 'err' : 'muted'}`} role="status">{msg.text}</span>}
        </div>)}
    </div>
  )
}
