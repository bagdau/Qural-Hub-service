import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, Empty } from '../components/ui'
import { Icon } from '../components/Icon'
import { MapView, type MapPoint } from '../components/MapView'
import { PageHeader } from '../components/PageHeader'
import { QueryBoundary } from '../components/QueryBoundary'
import { EquipmentGeoModal } from '../components/EquipmentGeo'
import { LiveIndicator, LiveProvider } from '../board/live'
import { routeUrl } from '../lib/geo'
import { ALERT_BG, ALERT_COLOR, ALERT_ORDER, ALERT_TITLE, KIND_TITLE, TYPE_TO_KIND, glyphSvg, type MapAlert, type MapKind } from '../lib/mapMeta'
import { PRIORITY } from '../lib/format'

const KINDS: MapKind[] = ['transformer', 'substation', 'switchgear']

/** Значок типа оборудования (константный SVG) на цветном круге: как на карте */
export function KindIcon({ kind, alert = 'ok', size = 34 }: { kind: MapKind; alert?: MapAlert; size?: number }) {
  return <span className="kicon" style={{ background: ALERT_COLOR[alert], width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: glyphSvg(kind, Math.round(size * 0.62)) }} />
}

/** Разводит метки с одинаковыми координатами по кругу (≈30 м), чтобы они не накладывались */
function spread(items: any[]): Map<string, [number, number]> {
  const groups = new Map<string, any[]>()
  for (const i of items) {
    const k = `${i.geo.latitude.toFixed(5)}:${i.geo.longitude.toFixed(5)}`
    groups.set(k, [...(groups.get(k) ?? []), i])
  }
  const out = new Map<string, [number, number]>()
  for (const g of groups.values()) {
    g.forEach((i, n) => {
      if (g.length === 1) return out.set(i.id, [i.geo.latitude, i.geo.longitude])
      const a = (2 * Math.PI * n) / g.length
      out.set(i.id, [i.geo.latitude + 0.00028 * Math.sin(a), i.geo.longitude + 0.00038 * Math.cos(a)])
    })
  }
  return out
}

export const pointOf = (i: any, at?: [number, number]): MapPoint => ({
  id: i.id, lat: at?.[0] ?? i.geo.latitude, lon: at?.[1] ?? i.geo.longitude, title: i.short_name === i.full_name ? i.name : `${i.short_name} · ${i.inventory_number}`,
  subtitle: `${i.site.name}${i.geo.source === 'site' ? ' (положение по площадке)' : ''}`, href: `/equipment/${i.id}`,
  kind: TYPE_TO_KIND[i.type] ?? 'site', alert: i.alert, count: i.tickets_count,
  lines: i.tickets.map((t: any) => ({ text: `${t.number}: ${t.title} · ${PRIORITY[t.priority] ?? t.priority}`, href: `/tickets/${t.id}`, tone: t.kind === 'planned' ? 'plan' : t.priority === 'critical' ? 'accident' : 'call' })),
})

/** Карта объектов: оборудование с типами, сигналами аварий и вызовов; обновляется в реальном времени */
export function MapPage() {
  return <LiveProvider><MapInner /></LiveProvider>
}

function MapInner() {
  const nav = useNavigate()
  const { me } = useAuth()
  const staff = me?.role === 'admin' || me?.role === 'dispatcher'
  const q = useQuery({ queryKey: ['map-objects'], queryFn: () => get('/map/objects'), refetchInterval: 60_000 })
  return (
    <div className="stack">
      <PageHeader title="Карта объектов" subtitle="Оборудование на карте OpenStreetMap. Красным и оранжевым отмечены аварии и вызовы — карта обновляется сама." actions={<LiveIndicator />} />
      <QueryBoundary query={q} isEmpty={(d) => !d.total && !d.without_geo} empty={<Empty icon="pin" title="Нет оборудования" />}>
        {(d) => <ObjectsMap data={d} staff={staff} onNavigate={nav} />}
      </QueryBoundary>
    </div>
  )
}

function ObjectsMap({ data, staff, onNavigate }: { data: any; staff: boolean; onNavigate: (to: string) => void }) {
  const [alerts, setAlerts] = useState<MapAlert[]>(ALERT_ORDER)
  const [kinds, setKinds] = useState<MapKind[]>(KINDS)
  const [selected, setSelected] = useState<string | undefined>()
  const [edit, setEdit] = useState<any | null>(null)
  const items: any[] = data.items
  const visible = useMemo(() => items.filter((i) => alerts.includes(i.alert) && kinds.includes(TYPE_TO_KIND[i.type])), [items, alerts, kinds])
  const at = useMemo(() => spread(visible), [visible])
  const points = useMemo(() => visible.map((i) => pointOf(i, at.get(i.id))), [visible, at])
  const kindCount = (k: MapKind) => items.filter((i) => TYPE_TO_KIND[i.type] === k).length
  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const signals = [...items].filter((i) => i.alert !== 'ok').sort((a, b) => ALERT_ORDER.indexOf(a.alert) - ALERT_ORDER.indexOf(b.alert))
  const c = data.counts
  return (
    <>
      {c.accident > 0 && (
        <div className="banner err alarm" role="alert">
          <b>Аварии: {c.accident}</b> — {items.filter((i) => i.alert === 'accident').map((i) => (
            <button key={i.id} className="linkbtn" onClick={() => setSelected(i.id)}>{i.short_name}</button>))}
        </div>)}
      <div className="card stack" style={{ padding: 10 }}>
        <div className="mapfilters" role="group" aria-label="Сигналы">
          {ALERT_ORDER.map((a) => (
            <button key={a} className={`fchip ${alerts.includes(a) ? 'on' : ''}`} aria-pressed={alerts.includes(a)} onClick={() => toggle(alerts, setAlerts, a)} style={{ ['--c' as any]: ALERT_BG[a] }}>
              <i className={`dot ${a === 'accident' && c.accident ? 'pulse' : ''}`} />{ALERT_TITLE[a]} <b>{c[a]}</b>
            </button>))}
        </div>
        <div className="mapfilters" role="group" aria-label="Типы оборудования">
          {KINDS.map((k) => (
            <button key={k} className={`fchip ${kinds.includes(k) ? 'on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggle(kinds, setKinds, k)} style={{ ['--c' as any]: '#475467' }}>
              <span className="kglyph" aria-hidden dangerouslySetInnerHTML={{ __html: glyphSvg(k, 18, 'currentColor') }} />{KIND_TITLE[k]} <b>{kindCount(k)}</b>
            </button>))}
        </div>
        {points.length
          ? <MapView points={points} height="min(58vh, 520px)" locate label="Карта оборудования" onNavigate={onNavigate} selectedId={selected} />
          : <Empty icon="pin" title={items.length ? 'Нет оборудования по выбранным фильтрам' : 'Координаты оборудования и площадок не заданы'} text={items.length ? 'Включите нужные сигналы и типы выше.' : 'Положение задаёт администратор или диспетчер в паспорте оборудования (вкладка «Карта»).'} />}
      </div>
      {data.without_geo > 0 && <div className="banner info small">У {data.without_geo} единиц оборудования нет координат ни у самого оборудования, ни у площадки — они не показаны на карте.</div>}
      <div className="card stack">
        <h2>{signals.length ? `Сигналы (${signals.length})` : 'Сигналов нет'}</h2>
        {!signals.length && <div className="muted small">Аварий, вызовов и плановых работ по оборудованию сейчас нет.</div>}
        <ul className="site-list">
          {signals.map((i) => (
            <li key={i.id} className={`sig sig-${i.alert}`}>
              <KindIcon kind={TYPE_TO_KIND[i.type] ?? 'site'} alert={i.alert} />
              <div className="sig-main">
                <div><strong>{i.short_name}</strong> <span className="badge" style={{ background: ALERT_BG[i.alert as MapAlert], color: '#fff' }}>{ALERT_TITLE[i.alert as MapAlert]}</span></div>
                <div className="small muted">{i.full_name} · {i.site.name}</div>
                {i.tickets.slice(0, 2).map((t: any) => <a key={t.id} className="small" href={`/tickets/${t.id}`} onClick={(e) => { e.preventDefault(); onNavigate(`/tickets/${t.id}`) }}>{t.number}: {t.title}</a>)}
              </div>
              <div className="sig-actions">
                <Button small onClick={() => { setSelected(undefined); setTimeout(() => setSelected(i.id), 0) }}><Icon name="pin" size={15} /> На карте</Button>
                {staff && <Button small onClick={() => setEdit(i)}>Положение</Button>}
              </div>
            </li>))}
        </ul>
      </div>
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Всё оборудование ({items.length})</summary>
        <ul className="site-list" style={{ marginTop: 10 }}>
          {items.map((i) => (
            <li key={i.id}>
              <KindIcon kind={TYPE_TO_KIND[i.type] ?? 'site'} alert={i.alert} size={30} />
              <div className="sig-main"><strong>{i.short_name}</strong><div className="small muted">{KIND_TITLE[TYPE_TO_KIND[i.type] ?? 'site']} · {i.site.name} · {i.geo.latitude.toFixed(5)}, {i.geo.longitude.toFixed(5)}{i.geo.source === 'site' ? ' (по площадке)' : ''}</div></div>
              <div className="sig-actions">
                <a className="btn sm" href={routeUrl([i.geo.latitude, i.geo.longitude])} target="_blank" rel="noreferrer">Маршрут</a>
                {staff && <Button small onClick={() => setEdit(i)}>Положение</Button>}
              </div>
            </li>))}
        </ul>
      </details>
      {edit && <EquipmentGeoLoader id={edit.id} onClose={() => setEdit(null)} />}
    </>
  )
}

/** Подгружает полную карточку (версия, координаты, площадка) и открывает редактор положения */
function EquipmentGeoLoader({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['eq', id], queryFn: () => get(`/equipment/${id}`) })
  if (!q.data) return null
  return <EquipmentGeoModal eq={q.data} onClose={onClose} />
}

/** Карта одной единицы оборудования на её паспорте + редактор положения */
export function EquipmentMapCard({ eq, canEdit }: { eq: any; canEdit: boolean }) {
  const [edit, setEdit] = useState(false)
  const all = useQuery({ queryKey: ['map-objects'], queryFn: () => get('/map/objects'), staleTime: 30_000 })
  const info = all.data?.items.find((i: any) => i.id === eq.id)
  const geo = eq.geo
  const points: MapPoint[] = geo ? [pointOf(info ?? { id: eq.id, type: eq.type, name: eq.name, short_name: eq.short_name ?? eq.name, full_name: eq.full_name ?? eq.name, inventory_number: eq.inventory_number,
    site: eq.site, geo: { latitude: geo.latitude, longitude: geo.longitude, source: geo.source }, alert: 'ok', tickets_count: 0, tickets: [] })] : []
  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <h2 style={{ margin: 0 }}>Где находится</h2>
          <div className="small muted">{eq.site.name} — {eq.site.address}</div>
          {geo && <div className="small mono">{geo.latitude.toFixed(6)}, {geo.longitude.toFixed(6)} · {geo.source === 'equipment' ? 'положение оборудования' : 'положение площадки'}</div>}
        </div>
        <div className="row">
          {geo && <a className="btn sm" href={routeUrl([geo.latitude, geo.longitude])} target="_blank" rel="noreferrer">Маршрут</a>}
          {canEdit && <Button small variant="primary" onClick={() => setEdit(true)}>Изменить положение</Button>}
        </div>
      </div>
      {info && info.alert !== 'ok' && <div className="banner small" style={{ background: ALERT_BG[info.alert as MapAlert], color: '#fff', borderColor: 'transparent' }}><b>{ALERT_TITLE[info.alert as MapAlert]}</b>: активных заявок {info.tickets_count}</div>}
      {geo
        ? <MapView points={points} selectedId={eq.id} height={340} locate label={`Карта: ${eq.name}`} />
        : <Empty icon="pin" title="Положение не задано" text={canEdit ? 'Укажите широту и долготу оборудования или задайте координаты площадки.' : 'Обратитесь к диспетчеру или администратору.'} />}
      {edit && <EquipmentGeoModal eq={eq} onClose={() => setEdit(false)} />}
    </div>
  )
}
