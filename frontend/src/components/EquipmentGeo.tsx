import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, patch } from '../api/client'
import { Button, Modal, errText, useToast } from './ui'
import { GeoPicker, geoBody, geoStrings, geoValid } from './GeoPicker'
import type { MapPoint } from './MapView'
import { TYPE_TO_KIND } from '../lib/mapMeta'

/** Редактор места нахождения оборудования: широта и долгота, карта, перетаскивание метки, определение по GPS. */
export function EquipmentGeoModal({ eq, onClose, onSaved }: { eq: any; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [geo, setGeo] = useState(geoStrings(eq.latitude, eq.longitude))
  const [err, setErr] = useState('')
  const site = eq.site
  // ориентир: положение площадки
  const context: MapPoint[] = site?.latitude != null ? [{ id: site.id, lat: site.latitude, lon: site.longitude, title: `Площадка: ${site.name}`, subtitle: site.address, kind: 'site' }] : []
  const m = useMutation({
    mutationFn: () => {
      const g = geoBody(geo)
      const empty = !geo.lat.trim() && !geo.lon.trim()
      if (!empty && !('latitude' in g)) throw new Error('Укажите широту и долготу числами: широта от −90 до 90, долгота от −180 до 180.')
      return patch(`/equipment/${eq.id}`, { version: eq.version, latitude: 'latitude' in g ? g.latitude : null, longitude: 'longitude' in g ? g.longitude : null })
    },
    onSuccess: () => {
      for (const k of ['eq', 'map-objects', 'equipment']) qc.invalidateQueries({ queryKey: [k] })
      toast(geoValid(geo.lat, geo.lon) ? 'Положение оборудования сохранено.' : 'Координаты очищены: используется положение площадки.')
      onSaved?.(); onClose()
    },
    onError: (x) => setErr(x instanceof Error && !(x instanceof ApiError) ? x.message : errText(x)),
  })
  return (
    <Modal title={`Положение: ${eq.name}`} onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setErr(''); m.mutate() }}>
        <div className="small muted">{site?.name}{site?.address ? ` — ${site.address}` : ''}. {eq.latitude == null ? 'Сейчас показывается положение площадки.' : 'Задано собственное положение оборудования.'}</div>
        <GeoPicker lat={geo.lat} lon={geo.lon} onChange={(lat, lon) => setGeo({ lat, lon })} context={context} height={280} />
        <div className="small muted">Тип на карте: {TYPE_TO_KIND[eq.type] === 'switchgear' ? 'РУ (распределительная подстанция)' : TYPE_TO_KIND[eq.type] === 'substation' ? 'подстанция (КТП)' : 'трансформатор'}.</div>
        {err && <div className="banner err" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {(geo.lat || geo.lon) && <Button type="button" onClick={() => setGeo({ lat: '', lon: '' })}>Очистить (по площадке)</Button>}
          <Button type="button" onClick={onClose}>Отмена</Button>
          <Button variant="primary" type="submit" loading={m.isPending}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  )
}
