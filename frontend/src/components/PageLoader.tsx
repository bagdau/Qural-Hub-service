import { Skeleton } from './ui'

/** Заглушка на время загрузки раздела: каркас страницы остаётся на месте, меняется только содержимое */
export function PageLoader({ inline }: { inline?: boolean }) {
  return (
    <div className={inline ? 'page-loader' : 'page-loader full'} role="status" aria-label="Загрузка">
      <div className="skeleton" style={{ height: 28, width: 'min(260px, 60%)', marginBottom: 14 }} />
      <div className="card"><Skeleton lines={5} /></div>
    </div>
  )
}
