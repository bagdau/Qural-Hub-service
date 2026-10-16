/** Расстояние между двумя точками, км (формула гаверсинусов) */
export function distanceKm(a: [number, number], b: [number, number]) {
  const R = 6371, r = (x: number) => (x * Math.PI) / 180
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
export const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(km < 10 ? 1 : 0)} км`)
export const routeUrl = (to: [number, number], from?: [number, number] | null) => from
  ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${from[0].toFixed(5)}%2C${from[1].toFixed(5)}%3B${to[0].toFixed(5)}%2C${to[1].toFixed(5)}`
  : `https://www.openstreetmap.org/?mlat=${to[0]}&mlon=${to[1]}#map=16/${to[0]}/${to[1]}`

