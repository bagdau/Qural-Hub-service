import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Icon } from './Icon'
import { distanceKm, fmtKm, routeUrl } from '../lib/geo'
import { ALERT_COLOR, ALERT_TITLE, KIND_TITLE, markerHtml, type MapPoint } from '../lib/mapMeta'

interface Props {
  points: MapPoint[]
  height?: number | string
  /** Открыть всплывающее окно метки и подлететь к ней */
  selectedId?: string
  /** Режим выбора места: синяя метка, ставится щелчком и перетаскивается */
  pick?: { lat: number; lon: number } | null
  onPick?: (lat: number, lon: number) => void
  onNavigate?: (href: string) => void
  locate?: boolean
  label: string
}

const markerIcon = (p: MapPoint) => L.divIcon({
  className: 'map-pin', html: markerHtml(p.kind ?? 'site', p.alert ?? 'ok', p.count), iconSize: [46, 56], iconAnchor: [23, 54], popupAnchor: [0, -48],
})
const pickIcon = L.divIcon({ className: 'map-pin', iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="mk-pick"><i></i></div>' })

function popupFor(p: MapPoint, mine: [number, number] | null, nav: ((href: string) => void) | undefined) {
  const alert = p.alert ?? 'ok'
  const el = document.createElement('div')
  el.className = 'map-pop'
  const add = (tag: string, text: string, cls?: string) => { const n = document.createElement(tag); if (cls) n.className = cls; n.textContent = text; el.appendChild(n); return n }
  const link = (text: string, href: string, internal: boolean) => {
    const a = document.createElement('a'); a.href = href; a.textContent = text
    if (internal) a.addEventListener('click', (ev) => { if (nav) { ev.preventDefault(); nav(href) } })
    else { a.target = '_blank'; a.rel = 'noreferrer' }
    return a
  }
  add('b', p.title)
  if (p.kind || p.alert) {
    const t = add('div', [p.kind ? KIND_TITLE[p.kind] : '', p.alert ? ALERT_TITLE[alert] : ''].filter(Boolean).join(' · '), 'small')
    if (p.alert) { t.style.color = ALERT_COLOR[alert]; t.style.fontWeight = '700' }
  }
  if (p.subtitle) add('div', p.subtitle, 'small muted')
  for (const ln of p.lines ?? []) {
    const row = document.createElement('div'); row.className = 'map-pop-line'
    if (ln.tone) row.style.borderLeftColor = ALERT_COLOR[ln.tone]
    if (ln.href) row.appendChild(link(ln.text, ln.href, true)); else row.textContent = ln.text
    el.appendChild(row)
  }
  if (mine) add('div', `От вас: ${fmtKm(distanceKm(mine, [p.lat, p.lon]))}`, 'small')
  const links = document.createElement('div'); links.className = 'map-pop-links'
  if (p.href) links.appendChild(link('Открыть', p.href, true))
  links.appendChild(link('Маршрут', routeUrl([p.lat, p.lon], mine), false))
  el.appendChild(links)
  return el
}

/** Карта OpenStreetMap (Leaflet) с метками оборудования. Грузится отдельным куском только на страницах с картой. */
export default function LeafletMap({ points, height = 320, selectedId, pick, onPick, onNavigate, locate, label }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const me = useRef<L.LayerGroup | null>(null)
  const pickMarker = useRef<L.Marker | null>(null)
  const markers = useRef<Map<string, L.Marker>>(new Map())
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
    // плитки идут через наш сервер (/tiles → кэш nginx → OpenStreetMap): без блокировок по Referer и с офлайн-кэшем
    const tiles = L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(m)
    tiles.on('tileerror', () => setTilesFailed(true))
    tiles.on('tileload', () => setTilesFailed(false))
    layer.current = L.layerGroup().addTo(m)
    me.current = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => onPickRef.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))))
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(box.current)
    return () => { ro.disconnect(); m.remove(); map.current = null; markers.current.clear() }
  }, [])

  // метки оборудования
  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    markers.current.clear()
    const bounds: [number, number][] = []
    for (const p of points) {
      const alert = p.alert ?? 'ok'
      const mk = L.marker([p.lat, p.lon], {
        icon: markerIcon(p), keyboard: true, alt: p.title,
        title: `${p.title}${p.alert ? ` — ${ALERT_TITLE[alert]}` : ''}`, zIndexOffset: alert === 'accident' ? 1000 : alert === 'call' ? 500 : 0,
      })
      mk.bindPopup(popupFor(p, mine, onNavRef.current ? (h) => onNavRef.current?.(h) : undefined), { minWidth: 200, maxWidth: 290 })
      mk.addTo(g)
      markers.current.set(p.id, mk)
      bounds.push([p.lat, p.lon])
    }
    if (!fitted.current && bounds.length) {
      fitted.current = true
      if (bounds.length === 1) m.setView(bounds[0], 16)
      else m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    }
  }, [points, mine])

  // выбранная метка: подлёт и всплывающее окно
  useEffect(() => {
    const m = map.current
    if (!m || !selectedId) return
    const mk = markers.current.get(selectedId)
    if (!mk) return
    m.flyTo(mk.getLatLng(), Math.max(m.getZoom(), 16), { duration: 0.6 })
    mk.openPopup()
  }, [selectedId, points])

  // точка выбора: перетаскиваемая синяя метка
  useEffect(() => {
    const m = map.current
    if (!m) return
    pickMarker.current?.remove()
    pickMarker.current = null
    if (pick) {
      const mk = L.marker([pick.lat, pick.lon], { icon: pickIcon, draggable: !!onPickRef.current, keyboard: false, zIndexOffset: 2000 }).addTo(m)
      mk.on('dragend', () => { const ll = mk.getLatLng(); onPickRef.current?.(Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6))) })
      pickMarker.current = mk
      if (!fitted.current) { m.setView([pick.lat, pick.lon], 16); fitted.current = true }
    }
  }, [pick?.lat, pick?.lon]) // eslint-disable-line react-hooks/exhaustive-deps

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
        onPickRef.current?.(Number(ll[0].toFixed(6)), Number(ll[1].toFixed(6)))
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
      {tilesFailed && <div className="banner warn small" role="status">Подложка карты недоступна (серверу нужен выход в интернет). Метки оборудования остаются на месте.</div>}
      {(locate || msg) && (
        <div className="map-bar">
          {locate && <button type="button" className="btn sm" onClick={findMe} disabled={busy}><Icon name="pin" size={16} /> {busy ? 'Определяем…' : 'Моё местоположение'}</button>}
          {msg && <span className={`small ${msg.kind === 'warn' ? 'err' : 'muted'}`} role="status">{msg.text}</span>}
        </div>)}
    </div>
  )
}
