import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './auth/AuthContext'
import { get } from './api/client'
import { Button, Modal, Skeleton, useOnline } from './components/ui'
import { Icon } from './components/Icon'
import { Avatar } from './components/Avatar'
import { Logo } from './components/Logo'
import { BackdropButton, SIDE_PHOTOS, SideBackdrop, useSideBackdrop } from './components/SideBackdrop'
import { useMedia } from './lib/useMedia'
import { ROLE } from './lib/format'
import { LazyRoute as R, preload, titleFor, warmUp } from './routes'
import { PageLoader } from './components/PageLoader'

type NavItem = { to: string; label: string; icon: string }
const NAV: Record<string, NavItem[]> = {
  admin: [
    { to: '/', label: 'Панель управления', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/users', label: 'Пользователи', icon: 'users' },
    { to: '/admin/organizations', label: 'Организации', icon: 'building' }, { to: '/admin/spare-parts', label: 'Запчасти', icon: 'parts' },
    { to: '/admin/checklists', label: 'Чек-листы', icon: 'checklist' }, { to: '/admin/sla', label: 'Настройки SLA', icon: 'clock' }, { to: '/admin/audit', label: 'Журнал аудита', icon: 'audit' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/generator', label: 'Генератор QR', icon: 'print' }, { to: '/map', label: 'Карта', icon: 'pin' },
  ],
  dispatcher: [
    { to: '/', label: 'Панель управления', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/spare-parts', label: 'Запчасти', icon: 'parts' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' }, { to: '/generator', label: 'Генератор QR', icon: 'print' }, { to: '/map', label: 'Карта', icon: 'pin' },
  ],
  manager: [
    { to: '/', label: 'Панель управления', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
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

/** Меню «Ещё»: поиск, остальные разделы, уведомления, профиль и выход — крупными строками для пальца (на телефоне шапки нет, всё внизу) */
function MoreSheet({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { me, logout } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => get('/notifications/unread-count'), refetchInterval: () => (document.hidden ? false : 30_000) }).data?.count ?? 0
  return (
    <Modal title="Меню" onClose={onClose}>
      <form className="more-search" role="search" onSubmit={(e) => { e.preventDefault(); const v = q.trim(); if (v) { onClose(); nav(`/tickets?q=${encodeURIComponent(v)}`) } }}>
        <Icon name="search" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: номер заявки, оборудование…" aria-label="Поиск по заявкам" />
      </form>
      <nav className="more-list" aria-label="Все разделы" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onClose() }}>
        {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'} onTouchStart={() => preload(i.to)}><Icon name={i.icon} size={22} /><span>{i.label}</span></NavLink>)}
        <NavLink to="/notifications"><Icon name="bell" size={22} /><span>Уведомления{unread > 0 && <b className="more-count">{unread > 99 ? '99+' : unread}</b>}</span></NavLink>
        <NavLink to="/profile"><Avatar name={me?.full_name ?? '?'} size={26} /><span>Профиль<small>{me?.full_name} · {me ? ROLE[me.role] : ''}</small></span></NavLink>
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

/** Поиск в шапке: Enter открывает список заявок с этим запросом (номер, оборудование, клиент) */
function GlobalSearch() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  return (
    <form className="gsearch" role="search" onSubmit={(e) => { e.preventDefault(); const v = q.trim(); if (v) { nav(`/tickets?q=${encodeURIComponent(v)}`); setQ('') } }}>
      <Icon name="search" size={18} />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: номер заявки, оборудование…" aria-label="Поиск по заявкам" />
    </form>
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
  const compact = useMedia('(max-width: 1024px)')
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('alageum.side') === 'rail' } catch { return false } })
  const bg = useSideBackdrop()
  const [expanded, setExpanded] = useState(false)   // планшет: панель из значков временно раскрывается поверх страницы
  useEffect(() => { try { localStorage.setItem('alageum.side', rail ? 'rail' : 'open') } catch { /* без хранилища */ } }, [rail])
  useEffect(() => { setExpanded(false) }, [loc.pathname])
  useEffect(() => {
    if (!expanded) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [expanded])
  const unreadN = useQuery({ queryKey: ['unread'], queryFn: () => get('/notifications/unread-count'), refetchInterval: () => (document.hidden ? false : 30_000) }).data?.count ?? 0
  useEffect(() => { if (me) warmUp(['/board', '/equipment', '/scan', '/tickets', '/my-tasks']) }, [me])
  if (!me) return null
  const items = NAV[me.role]
  const bottom = BOTTOM[me.role] ?? BOTTOM.default
  const inBottom = new Set(bottom.map((b) => b.to))
  const moreItems = items.filter((i) => !inBottom.has(i.to))
  const moreActive = more || !bottom.some((b) => b.to !== MORE && (b.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(b.to)))
  return (
    <div className={`shell ${rail ? 'rail' : ''} ${expanded ? 'expanded' : ''}`}>
      <header className="topbar">
        <button type="button" className="side-toggle" aria-label={(compact ? expanded : !rail) ? 'Свернуть меню' : 'Развернуть меню'} aria-expanded={compact ? expanded : !rail} aria-controls="side-nav"
          onClick={() => (compact ? setExpanded(!expanded) : setRail(!rail))}><Icon name={(compact ? expanded : !rail) ? 'panel-close' : 'panel-open'} size={22} /></button>
        <a className="brand" href="/" aria-label="Qural Hub — на главную">
          <Logo size={40} />
          <span className="brand-text">Qural Hub</span>
        </a>
        <GlobalSearch />
        <div className="top-actions">
          <span className="org-name" title="Организация">{me.organization.name}</span>
          <Bell />
          <NavLink to="/profile" className="userchip" aria-label={`Профиль: ${me.full_name}`}>
            <Avatar name={me.full_name} size={38} />
            <span className="who"><b>{me.full_name}</b><small>{ROLE[me.role]}</small></span>
          </NavLink>
          <button className="btn logout" onClick={logout} aria-label="Выйти"><Icon name="logout" size={18} /><span className="logout-text">Выйти</span></button>
        </div>
      </header>
      <aside className="sidebar" id="side-nav">
        <SideBackdrop index={bg.index} />
        <nav className="nav" aria-label="Основное меню">
          {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'} title={rail || (compact && !expanded) ? i.label : undefined} onMouseEnter={() => preload(i.to)} onFocus={() => preload(i.to)} onTouchStart={() => preload(i.to)}><Icon name={i.icon} /><span className="nav-label">{i.label}</span></NavLink>)}
        </nav>
        <div className="spacer" />
        <div className="side-foot"><i className={`dot ${online ? 'on' : ''}`} aria-hidden /><span className="side-foot-text">{online ? 'Система на связи' : 'Нет связи'}</span><BackdropButton onClick={bg.next} name={SIDE_PHOTOS[bg.index].name} /></div>
      </aside>
      {expanded && <div className="scrim" onClick={() => setExpanded(false)} aria-hidden />}
      <div className="main">
        <SecureBanner />
        {!online && <div className="offline" role="alert">Нет соединения. Показаны сохранённые данные; действия временно недоступны.</div>}
        <RouteEffects main={main} />
        <main className={`content ${loc.pathname === '/board' ? 'wide' : ''}`} id="main" ref={main} tabIndex={-1}><Suspense fallback={<PageLoader inline />}><Outlet /></Suspense></main>
      </div>
      <nav className="bottomnav" aria-label="Быстрая навигация">
        {bottom.map((i) => i.to === MORE
          ? <button key={i.to} type="button" className={`more ${moreActive ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}><span className="more-ico"><Icon name={i.icon} size={22} />{unreadN > 0 && <i className="more-dot" aria-label={`Непрочитанных уведомлений: ${unreadN}`} />}</span>{i.label}</button>
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
