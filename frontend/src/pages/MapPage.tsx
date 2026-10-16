import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Empty } from '../components/ui'
import { Icon } from '../components/Icon'
import { MapView, type MapPoint } from '../components/MapView'
import { PageHeader } from '../components/PageHeader'
import { QueryBoundary } from '../components/QueryBoundary'
import { routeUrl } from '../lib/geo'

/** Карта объектов: все доступные пользователю площадки на OpenStreetMap */
export function MapPage() {
  const nav = useNavigate()
  const { me } = useAuth()
  const q = useQuery({ queryKey: ['sites-map'], queryFn: () => get('/sites', { page_size: 100 }), staleTime: 60_000 })
  return (
    <div className="stack">
      <PageHeader title="Карта объектов" subtitle="Площадки с оборудованием на карте OpenStreetMap. Нажмите на метку, чтобы увидеть адрес и построить маршрут." />
      <QueryBoundary query={q} isEmpty={(d) => !d.items.length} empty={<Empty icon="pin" title="Нет площадок" />}>
        {(d) => <SitesMap sites={d.items} canEdit={me?.role === 'admin'} onNavigate={nav} />}
      </QueryBoundary>
    </div>
  )
}

function SitesMap({ sites, canEdit, onNavigate }: { sites: any[]; canEdit: boolean; onNavigate: (to: string) => void }) {
  const withGeo = useMemo(() => sites.filter((s) => s.latitude != null && s.longitude != null), [sites])
  const points: MapPoint[] = useMemo(() => withGeo.map((s) => ({ id: s.id, lat: s.latitude, lon: s.longitude, title: s.name, subtitle: s.address, href: `/equipment?site=${s.id}` })), [withGeo])
  const without = sites.length - withGeo.length
  return (
    <>
      <div className="card" style={{ padding: 8 }}>
        {points.length
          ? <MapView points={points} height="min(56vh, 480px)" locate label="Карта площадок" onNavigate={onNavigate} />
          : <Empty icon="pin" title="Координаты площадок не заданы" text={canEdit ? 'Укажите координаты в разделе «Организации» — кнопка «Координаты» у площадки.' : 'Администратор может добавить координаты площадок.'} />}
      </div>
      {without > 0 && <div className="banner info small">У {without} площадок координаты не заданы — они не показаны на карте.</div>}
      <div className="card stack">
        <h2>Площадки ({sites.length})</h2>
        <ul className="site-list">
          {sites.map((s) => (
            <li key={s.id}>
              <div><strong>{s.name}</strong><div className="small muted">{s.address}</div></div>
              {s.latitude != null
                ? <a className="btn sm" href={routeUrl([s.latitude, s.longitude])} target="_blank" rel="noreferrer"><Icon name="pin" size={15} /> На карте</a>
                : <span className="small muted">нет координат</span>}
            </li>))}
        </ul>
      </div>
    </>
  )
}

/** Карта одной площадки на паспорте оборудования */
export function SiteMapCard({ site, canEdit }: { site: { id: string; name: string; address: string; latitude: number | null; longitude: number | null }; canEdit: boolean }) {
  const has = site.latitude != null && site.longitude != null
  const points: MapPoint[] = has ? [{ id: site.id, lat: site.latitude!, lon: site.longitude!, title: site.name, subtitle: site.address }] : []
  return (
    <div className="card stack">
      <div className="row between">
        <div><h2 style={{ margin: 0 }}>Где находится</h2><div className="small muted">{site.name} — {site.address}</div></div>
        {has && <a className="btn sm" href={routeUrl([site.latitude!, site.longitude!])} target="_blank" rel="noreferrer">Открыть в OpenStreetMap</a>}
      </div>
      {has
        ? <MapView points={points} selectedId={site.id} height={340} locate label={`Карта: ${site.name}`} />
        : <Empty icon="pin" title="Координаты площадки не заданы" text={canEdit ? undefined : 'Обратитесь к администратору.'} action={canEdit ? <Link className="btn sm" to="/admin/organizations">Указать координаты</Link> : undefined} />}
    </div>
  )
}
