/** Общие описания карты (без Leaflet): типы значков, сигналы состояния, цвета. Используются и картой, и легендой. */
export type MapKind = 'transformer' | 'substation' | 'switchgear' | 'site'
export type MapAlert = 'accident' | 'call' | 'plan' | 'ok'

export interface MapPoint {
  id: string; lat: number; lon: number; title: string; subtitle?: string; href?: string
  kind?: MapKind; alert?: MapAlert; count?: number
  /** Строки во всплывающем окне: заявки и т. п. */
  lines?: { text: string; href?: string; tone?: MapAlert }[]
}

export const ALERT_COLOR: Record<MapAlert, string> = { accident: '#d92d20', call: '#f79009', plan: '#2563eb', ok: '#0d7a5f' }
/** Фоны плашек и кнопок с белым текстом (контраст ≥ 4.5:1); яркие ALERT_COLOR — для меток и графики */
export const ALERT_BG: Record<MapAlert, string> = { accident: '#b42318', call: '#b54708', plan: '#1d4ed8', ok: '#0d7a5f' }
export const ALERT_TITLE: Record<MapAlert, string> = { accident: 'Авария', call: 'Вызов', plan: 'Плановые работы', ok: 'В норме' }
export const ALERT_ORDER: MapAlert[] = ['accident', 'call', 'plan', 'ok']
export const KIND_TITLE: Record<MapKind, string> = { transformer: 'Трансформатор', substation: 'Подстанция (КТП)', switchgear: 'Будка (РУ)', site: 'Площадка' }
export const TYPE_TO_KIND: Record<string, MapKind> = { transformer: 'transformer', substation: 'substation', switchgear: 'switchgear' }

/** Значки типов (24×24, белый контур на цветном круге). Это константы, пользовательских данных в них нет. */
export const GLYPH: Record<MapKind, string> = {
  // трансформатор: две связанные катушки
  transformer: '<circle cx="9" cy="12" r="4.6"/><circle cx="15" cy="12" r="4.6"/><path d="M3 12h1.4M19.6 12H21"/>',
  // подстанция (КТП): здание с молнией
  substation: '<path d="M4 20V9.5L12 4l8 5.5V20z"/><path d="m12.8 9.5-3 4.2h3.4l-1 3.8 3.6-5h-3.4z" fill="#fff" stroke="none"/>',
  // будка (распределительное устройство): будка с крышей, дверью и шинами
  switchgear: '<path d="M3 10.5 12 5l9 5.5"/><rect x="5" y="10.5" width="14" height="9.5" rx=".6"/><path d="M10 20v-5.5h4V20M8 12.6h8"/>',
  site: '<path d="M12 21s6-5.6 6-10.5A6 6 0 0 0 6 10.5C6 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>',
}

export const glyphSvg = (kind: MapKind, size = 24, stroke = '#fff') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[kind]}</svg>`

export function markerHtml(kind: MapKind, alert: MapAlert, count?: number) {
  const badge = count && count > 0 ? `<b class="mk-n">${count > 9 ? '9+' : count}</b>` : ''
  const pulse = alert === 'accident' || alert === 'call' ? '<i class="mk-pulse"></i>' : ''
  return `<div class="mk mk-${alert}" style="--c:${ALERT_COLOR[alert]}">${pulse}<span class="mk-body">${glyphSvg(kind)}</span>${badge}</div>`
}
