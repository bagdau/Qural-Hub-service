import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Empty, ErrorBox, Skeleton } from './ui'

/**
 * Единое поведение экрана данных: загрузка → скелетон, ошибка → сообщение с «Повторить», пусто → подсказка, иначе — содержимое.
 * Пока обновляются уже показанные данные, старые остаются на экране (без «мигания»).
 */
export function QueryBoundary<T>({ query, isEmpty, empty, lines = 5, children }: {
  query: UseQueryResult<T>
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  lines?: number
  children: (data: T) => ReactNode
}) {
  if (query.isLoading) return <div className="card"><Skeleton lines={lines} /></div>
  if (query.error && query.data === undefined) return <ErrorBox error={query.error} retry={() => query.refetch()} />
  const data = query.data as T
  if (isEmpty?.(data)) return <div className="card">{empty ?? <Empty title="Ничего не найдено" />}</div>
  return <>{children(data)}</>
}
