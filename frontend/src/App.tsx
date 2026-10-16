import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './auth/AuthContext'
import { get } from './api/client'
import { Button, Skeleton, useOnline } from './components/ui'
import { Icon } from './components/Icon'
import { ROLE } from './lib/format'
import { LazyRoute as R, preload, titleFor, warmUp } from './routes'
import { PageLoader } from './components/PageLoader'

type NavItem = { to: string; label: string; icon: string }
const NAV: Record<string, NavItem[]> = {
  admin: [
    { to: '/', label: 'Дашборд', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/users', label: 'Пользователи', icon: 'users' },
    { to: '/admin/organizations', label: 'Организации', icon: 'building' }, { to: '/admin/spare-parts', label: 'Запчасти', icon: 'parts' },
    { to: '/admin/checklists', label: 'Чек-листы', icon: 'checklist' }, { to: '/admin/sla', label: 'Настройки SLA', icon: 'clock' }, { to: '/admin/audit', label: 'Журнал аудита', icon: 'audit' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/generator', label: 'Генератор QR', icon: 'print' },
  ],
  dispatcher: [
    { to: '/', label: 'Дашборд', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/spare-parts', label: 'Запчасти', icon: 'parts' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/generator', label: 'Генератор QR', icon: 'print' },
  ],
  manager: [
    { to: '/', label: 'Дашборд', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/users', label: 'Пользователи', icon: 'users' },
  ],
  engineer: [
    { to: '/my-tasks', label: 'Мои задания', icon: 'tasks' }, { to: '/board', label: 'Доска заявок', icon: 'board' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
  ],
  client: [
    { to: '/', label: 'Главная', icon: 'dashboard' }, { to: '/board', label: 'Мои заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' },
  ],
}
const BOTTOM: Record<string, NavItem[]> = {
  engineer: [{ to: '/my-tasks', label: 'Задания', icon: 'tasks' }, { to: '/scan', label: 'Скан', icon: 'qr' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' }, { to: '/profile', label: 'Профиль', icon: 'user' }],
  default: [{ to: '/', label: 'Главная', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' }, { to: '/profile', label: 'Ещё', icon: 'menu' }],
}

function Bell() {
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['unread'], queryFn: () => get('/notifications/unread-count'), refetchInterval: () => (document.hidden ? false : 30_000) })
  const n = q.data?.count ?? 0
  return (
    <button className="bell" onClick={() => nav('/notifications')} aria-label={`Уведомления${n ? `, непрочитанных: ${n}` : ''}`}>
      <Icon name="bell" size={20} />{n > 0 && <span className="count">{n > 99 ? '99+' : n}</span>}
    </button>
  )
}

function Shell() {
  const { me, logout } = useAuth()
  const online = useOnline()
  const loc = useLocation()
  const main = useRef<HTMLElement>(null)
  useEffect(() => { if (me) warmUp(['/board', '/equipment', '/scan', '/tickets', '/my-tasks']) }, [me])
  if (!me) return null
  const items = NAV[me.role]
  const bottom = BOTTOM[me.role] ?? BOTTOM.default
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/"><svg viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#163a68" /><path d="M17 5 9 18h6l-1 9 9-14h-6z" fill="#2DD4BF" /></svg><span className="brand-text">Alageum Service Hub</span></a>
        <nav className="nav" aria-label="Основное меню">
          {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'} onMouseEnter={() => preload(i.to)} onFocus={() => preload(i.to)} onTouchStart={() => preload(i.to)}><Icon name={i.icon} />{i.label}</NavLink>)}
        </nav>
        <div className="spacer" />
        <NavLink to="/profile" className="prof" aria-label={`Профиль: ${me.full_name}`} style={{ color: '#cbd5e1', textDecoration: 'none', padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="user" size={20} /><span className="prof-text">{me.full_name}<br /><span className="small">{ROLE[me.role]}</span></span></NavLink>
      </aside>
      <div className="main">
        {!online && <div className="offline" role="alert">Нет соединения. Показаны сохранённые данные; действия временно недоступны.</div>}
        <header className="topbar">
          <div className="muted small">{me.organization.name}</div>
          <div className="row"><Bell /><Button small onClick={logout}>Выйти</Button></div>
        </header>
        <RouteEffects main={main} />
        <main className={`content ${loc.pathname === '/board' ? 'wide' : ''}`} id="main" ref={main} tabIndex={-1}><Suspense fallback={<PageLoader inline />}><Outlet /></Suspense></main>
      </div>
      <nav className="bottomnav" aria-label="Быстрая навигация">
        {bottom.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'} onTouchStart={() => preload(i.to)} onFocus={() => preload(i.to)}><Icon name={i.icon} size={22} />{i.label}</NavLink>)}
      </nav>
    </div>
  )
}

function Protected({ roles }: { roles?: string[] }) {
  const { me, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="content"><Skeleton lines={4} /></div>
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (me.must_change_password && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />
  if (roles && !roles.includes(me.role)) return <Forbidden />
  return <Shell />
}

export function Forbidden() {
  return <div className="content"><div className="card"><h1>Нет доступа</h1><p className="muted">У вашей роли нет доступа к этому разделу.</p><a href="/">На главную</a></div></div>
}
export function NotFound() {
  return <div className="content"><div className="card"><h1>Страница не найдена</h1><p className="muted">Объект не существует или недоступен для вашей учётной записи.</p><a href="/">На главную</a></div></div>
}

function Home() {
  const { me } = useAuth()
  if (me?.role === 'engineer') return <Navigate to="/my-tasks" replace />
  if (me?.role === 'dispatcher') return <Navigate to="/board" replace />
  return <Page path="/" />
}

/** Заголовок вкладки, возврат наверх и фокус на содержимое при переходе между страницами */
function RouteEffects({ main }: { main: React.RefObject<HTMLElement | null> }) {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = titleFor(pathname)
    window.scrollTo(0, 0)
    main.current?.focus({ preventScroll: true })
  }, [pathname, main])
  return null
}

const Page = ({ path }: { path: string }) => { const C = R[path]; return <C /> }

const PROTECTED_PATHS = [
  '/equipment', '/equipment/new', '/equipment/:id', '/equipment/:id/edit', '/equipment/:id/qr', '/generator', '/e/:code', '/scan', '/board',
  '/tickets', '/tickets/new', '/tickets/:id', '/tickets/:id/report', '/my-tasks', '/acts/:id', '/notifications', '/maintenance', '/profile',
  '/admin/users', '/admin/organizations', '/admin/spare-parts', '/admin/checklists', '/admin/sla', '/admin/audit',
]

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Page path="/login" />} />
        <Route path="/change-password" element={<Page path="/change-password" />} />
        <Route element={<Protected />}>
          <Route path="/" element={<Home />} />
          {PROTECTED_PATHS.map((path) => <Route key={path} path={path} element={<Page path={path} />} />)}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
