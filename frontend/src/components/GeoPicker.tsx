import { Field } from './ui'
import { MapView, type MapPoint } from './MapView'

export const toNum = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')))
export const geoValid = (lat: string, lon: string) => {
  const a = toNum(lat), b = toNum(lon)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180
}
/** Тело запроса с координатами: пустые поля → ничего не отправляем */
export const geoBody = (g: { lat: string; lon: string }) => (geoValid(g.lat, g.lon) ? { latitude: toNum(g.lat), longitude: toNum(g.lon) } : {})
export const geoStrings = (lat?: number | null, lon?: number | null) => ({ lat: lat != null ? String(lat) : '', lon: lon != null ? String(lon) : '' })

/**
 * Редактор положения: широта и долгота (оси координат) вводятся вручную, ставятся щелчком по карте OpenStreetMap,
 * перетаскиванием метки или определяются кнопкой «Моё местоположение». `context` — точки, которые показываются для ориентира
 * (например, площадка), `focus` — где открыть карту, пока координаты не заданы.
 */
export function GeoPicker({ lat, lon, onChange, context, height = 260 }: {
  lat: string; lon: string; onChange: (lat: string, lon: string) => void; context?: MapPoint[]; height?: number
}) {
  const ok = geoValid(lat, lon)
  const bad = (lat.trim() !== '' || lon.trim() !== '') && !ok
  return (
    <div className="stack">
      <div className="grid cols-2">
        <Field label="Широта (−90…90)" error={bad && !Number.isFinite(toNum(lat)) ? 'Введите число, например 43.2605' : undefined}>
          <input inputMode="decimal" value={lat} placeholder="43.2605" onChange={(e) => onChange(e.target.value, lon)} />
        </Field>
        <Field label="Долгота (−180…180)" error={bad && !Number.isFinite(toNum(lon)) ? 'Введите число, например 76.9283' : undefined}>
          <input inputMode="decimal" value={lon} placeholder="76.9283" onChange={(e) => onChange(lat, e.target.value)} />
        </Field>
      </div>
      <MapView points={context ?? []} pick={ok ? { lat: toNum(lat), lon: toNum(lon) } : null}
        onPick={(x, y) => onChange(String(x), String(y))} locate height={height} label="Выбор положения на карте" />
      <div className="small muted">Нажмите на карту или перетащите синюю метку, чтобы задать точку; можно ввести широту и долготу вручную либо нажать «Моё местоположение», находясь рядом с оборудованием.</div>
    </div>
  )
}
