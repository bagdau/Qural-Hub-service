import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './auth/AuthContext'
import { get } from './api/client'
import { Button, Modal, Skeleton, useOnline } from './components/ui'
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
    { to: '/admin/checklists', label: 'Чек-листы', icon: 'checklist' }, { to: '/admin/sla', label: 'Настройки SLA', icon: 'clock' }, { to: '/admin/audit', label: 'Журнал аудита', icon: 'audit' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/generator', label: 'Генератор QR', icon: 'print' }, { to: '/map', label: 'Карта', icon: 'pin' },
  ],
  dispatcher: [
    { to: '/', label: 'Дашборд', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/spare-parts', label: 'Запчасти', icon: 'parts' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/generator', label: 'Генератор QR', icon: 'print' }, { to: '/map', label: 'Карта', icon: 'pin' },
  ],
  manager: [
    { to: '/', label: 'Дашборд', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/users', label: 'Пользователи', icon: 'users' }, { to: '/map', label: 'Карта', icon: 'pin' },
  ],
  engineer: [
    { to: '/my-tasks', label: 'Мои задания', icon: 'tasks' }, { to: '/board', label: 'Доска заявок', icon: 'board' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' }, { to: '/map', label: 'Карта', icon: 'pin' },
  ],
  client: [
    { to: '/', label: 'Главная', icon: 'dashboard' }, { to: '/board', label: 'Мои заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/map', label: 'Карта', icon: 'pin' },
  ],
}
/** Нижняя панель телефона. Пункт «#more» — не страница, а кнопка, открывающая меню со всеми разделами. */
const MORE = '#more'
const BOTTOM: Record<string, NavItem[]> = {
  engineer: [{ to: '/my-tasks', label: 'Задания', icon: 'tasks' }, { to: '/scan', label: 'Скан', icon: 'qr' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' }, { to: MORE, label: 'Ещё', icon: 'menu' }],
  default: [{ to: '/', label: 'Главная', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' }, { to: MORE, label: 'Ещё', icon: 'menu' }],
}

/** Меню «Ещё»: все остальные разделы роли, профиль и выход — крупными строками для пальца */
function MoreSheet({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { me, logout } = useAuth()
  return (
    <Modal title="Меню" onClose={onClose}>
      <nav className="more-list" aria-label="Все разделы" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onClose() }}>
        {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'} onTouchStart={() => preload(i.to)}><Icon name={i.icon} size={22} /><span>{i.label}</span></NavLink>)}
        <NavLink to="/profile"><Icon name="user" size={22} /><span>Профиль<small>{me?.full_name} · {me ? ROLE[me.role] : ''}</small></span></NavLink>
      </nav>
      <button className="btn more-logout" onClick={() => { onClose(); logout() }}>Выйти из аккаунта</button>
    </Modal>
  )
}

/** Камера и геолокация работают только по HTTPS: на обычном http:// по IP предлагаем защищённый адрес */
function SecureBanner() {
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('alageum.secure-banner') === '1' } catch { return false } })
  const loc = useLocation()
  if (window.isSecureContext || hidden) return null
  const url = `https://${window.location.hostname}:8443${loc.pathname}${loc.search}`
  return (
    <div className="secure-banner" role="note">
      <span>Камера и геолокация работают только по HTTPS.</span>
      <a href={url}>Открыть защищённую версию</a>
      <button aria-label="Скрыть" onClick={() => { setHidden(true); try { sessionStorage.setItem('alageum.secure-banner', '1') } catch { /* без хранилища */ } }}>×</button>
    </div>
  )
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
  const [more, setMore] = useState(false)
  useEffect(() => { if (me) warmUp(['/board', '/equipment', '/scan', '/tickets', '/my-tasks']) }, [me])
  if (!me) return null
  const items = NAV[me.role]
  const bottom = BOTTOM[me.role] ?? BOTTOM.default
  const inBottom = new Set(bottom.map((b) => b.to))
  const moreItems = items.filter((i) => !inBottom.has(i.to))
  const moreActive = more || !bottom.some((b) => b.to !== MORE && (b.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(b.to)))
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
        <SecureBanner />
        {!online && <div className="offline" role="alert">Нет соединения. Показаны сохранённые данные; действия временно недоступны.</div>}
        <header className="topbar">
          <div className="muted small">{me.organization.name}</div>
          <div className="row"><Bell /><Button small onClick={logout}>Выйти</Button></div>
        </header>
        <RouteEffects main={main} />
        <main className={`content ${loc.pathname === '/board' ? 'wide' : ''}`} id="main" ref={main} tabIndex={-1}><Suspense fallback={<PageLoader inline />}><Outlet /></Suspense></main>
      </div>
      <nav className="bottomnav" aria-label="Быстрая навигация">
        {bottom.map((i) => i.to === MORE
          ? <button key={i.to} type="button" className={`more ${moreActive ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}><Icon name={i.icon} size={22} />{i.label}</button>
          : <NavLink key={i.to} to={i.to} end={i.to === '/'} onTouchStart={() => preload(i.to)} onFocus={() => preload(i.to)}><Icon name={i.icon} size={22} />{i.label}</NavLink>)}
      </nav>
      {more && <MoreSheet items={moreItems} onClose={() => setMore(false)} />}
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
  '/map', '/admin/users', '/admin/organizations', '/admin/spare-parts', '/admin/checklists', '/admin/sla', '/admin/audit',
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
