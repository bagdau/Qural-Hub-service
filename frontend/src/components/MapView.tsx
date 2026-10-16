import { Suspense, lazy } from 'react'

export type { MapPoint } from '../lib/mapMeta'
/** Карта грузится отдельным куском (Leaflet ≈ 46 КБ gzip) — только там, где она нужна. */
const Leaflet = lazy(() => import('./LeafletMap'))

export function MapView(props: React.ComponentProps<typeof Leaflet>) {
  return (
    <Suspense fallback={<div className="map-wrap"><div className="map skeleton" style={{ height: props.height ?? 320 }} aria-busy="true" aria-label="Загрузка карты" /></div>}>
      <Leaflet {...props} />
    </Suspense>
  )
}
