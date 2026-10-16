import type { ReactNode } from 'react'

/** Заголовок страницы: название, пояснение и кнопки действий. На телефоне кнопки уходят под заголовок на всю ширину. */
export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        {crumbs && <div className="muted small">{crumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="muted small">{subtitle}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  )
}
