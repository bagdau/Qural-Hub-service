import type { ReactNode } from 'react'

export interface Column<T> {
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Подпись поля в карточке на телефоне (по умолчанию — текст заголовка) */
  label?: string
  /** Дополнительный класс ячейки: mono, small и т. п. */
  className?: string
  /** Скрывать колонку на телефоне */
  hideSm?: boolean
  /** Без подписи в карточке (например, колонка с кнопками) */
  bare?: boolean
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  dense?: boolean
  /** Нижняя часть карточки: пагинация, итоги, кнопка «Сохранить» */
  footer?: ReactNode
  /** Без внешней карточки (таблица внутри другого блока) */
  bare?: boolean
}

/**
 * Единая таблица приложения. На компьютере и планшете — обычная таблица, на телефоне каждая строка
 * превращается в карточку «подпись — значение» (см. .rtable в responsive.css), поэтому ничего не уезжает за экран.
 */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, selectedKey, dense, footer, bare }: Props<T>) {
  const table = (
    <table className={`rtable ${dense ? 'dense' : ''}`}>
      <thead>
        <tr>{columns.map((c, i) => <th key={i} className={c.hideSm ? 'hide-sm' : undefined}>{c.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const k = rowKey(r)
          return (
            <tr key={k} className={`${onRowClick ? 'link' : ''} ${selectedKey === k ? 'sel' : ''}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r) } : undefined}>
              {columns.map((c, i) => (
                <td key={i} data-label={c.bare ? undefined : c.label ?? (typeof c.header === 'string' ? c.header : undefined)}
                  className={[c.className, c.hideSm ? 'hide-sm' : '', c.bare || (!c.label && typeof c.header !== 'string') ? 'nolabel' : ''].filter(Boolean).join(' ') || undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>)
        })}
      </tbody>
    </table>
  )
  if (bare) return <div className="table-wrap">{table}{footer}</div>
  return <div className="card table-wrap" style={dense ? { padding: 0 } : undefined}>{table}{footer}</div>
}
