import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './auth/AuthContext'
import { get } from './api/client'
import { Button, Skeleton, useOnline } from './components/ui'
import { Icon } from './components/Icon'
import { ROLE } from './lib/format'
import { LoginPage, ChangePasswordPage, ProfilePage } from './pages/Auth'
import { DashboardPage } from './pages/Dashboard'
import { EquipmentListPage, EquipmentDetailPage, EquipmentFormPage, QrResolverPage, ScanPage } from './pages/Equipment'
import { TicketsPage, TicketNewPage, TicketDetailPage } from './pages/Tickets'
import { MyTasksPage, ReportPage } from './pages/Engineer'
import { ActPage, NotificationsPage, MaintenancePage } from './pages/Misc'
import { WorkspacePage } from './pages/Workspace'
import { UsersPage, OrganizationsPage, SparePartsPage, ChecklistsPage, SlaPage, AuditPage } from './pages/Admin'

type NavItem = { to: string; label: string; icon: string }
const NAV: Record<string, NavItem[]> = {
  admin: [
    { to: '/', label: 'Дашборд', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/users', label: 'Пользователи', icon: 'users' },
    { to: '/admin/organizations', label: 'Организации', icon: 'building' }, { to: '/admin/spare-parts', label: 'Запчасти', icon: 'parts' },
    { to: '/admin/checklists', label: 'Чек-листы', icon: 'checklist' }, { to: '/admin/sla', label: 'Настройки SLA', icon: 'clock' }, { to: '/admin/audit', label: 'Журнал аудита', icon: 'audit' },
  ],
  dispatcher: [
    { to: '/', label: 'Дашборд', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' },
    { to: '/maintenance', label: 'Плановые работы', icon: 'calendar' }, { to: '/admin/spare-parts', label: 'Запчасти', icon: 'parts' }, { to: '/scan', label: 'Сканер QR', icon: 'qr' },
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
  engineer: [{ to: '/my-tasks', label: 'Задания', icon: 'tasks' }, { to: '/scan', label: 'Скан', icon: 'qr' }, { to: '/notifications', label: 'Уведомл.', icon: 'bell' }, { to: '/profile', label: 'Профиль', icon: 'user' }],
  default: [{ to: '/', label: 'Главная', icon: 'dashboard' }, { to: '/board', label: 'Заявки', icon: 'board' }, { to: '/equipment', label: 'Оборудование', icon: 'equipment' }, { to: '/notifications', label: 'Уведомл.', icon: 'bell' }, { to: '/profile', label: 'Ещё', icon: 'menu' }],
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
  if (!me) return null
  const items = NAV[me.role]
  const bottom = BOTTOM[me.role] ?? BOTTOM.default
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/"><svg viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#163a68" /><path d="M17 5 9 18h6l-1 9 9-14h-6z" fill="#2DD4BF" /></svg>Alageum Service Hub</a>
        <nav className="nav" aria-label="Основное меню">
          {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'}><Icon name={i.icon} />{i.label}</NavLink>)}
        </nav>
        <div className="spacer" />
        <NavLink to="/profile" className="nav" style={{ color: '#cbd5e1', textDecoration: 'none', padding: '8px 12px' }}><Icon name="user" size={18} /> {me.full_name}<br /><span className="small">{ROLE[me.role]}</span></NavLink>
      </aside>
      <div className="main">
        {!online && <div className="offline" role="alert">Нет соединения. Показаны сохранённые данные; действия временно недоступны.</div>}
        <header className="topbar">
          <div className="muted small">{me.organization.name}</div>
          <div className="row"><Bell /><Button small onClick={logout}>Выйти</Button></div>
        </header>
        <main className={`content ${loc.pathname === '/board' ? 'wide' : ''}`} id="main"><Outlet /></main>
      </div>
      <nav className="bottomnav" aria-label="Быстрая навигация">
        {bottom.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'}><Icon name={i.icon} size={22} />{i.label}</NavLink>)}
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
  return <DashboardPage />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Home />} />
        <Route path="/equipment" element={<EquipmentListPage />} />
        <Route path="/equipment/new" element={<EquipmentFormPage />} />
        <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
        <Route path="/equipment/:id/edit" element={<EquipmentFormPage />} />
        <Route path="/e/:code" element={<QrResolverPage />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/board" element={<WorkspacePage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/new" element={<TicketNewPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/tickets/:id/report" element={<ReportPage />} />
        <Route path="/my-tasks" element={<MyTasksPage />} />
        <Route path="/acts/:id" element={<ActPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/organizations" element={<OrganizationsPage />} />
        <Route path="/admin/spare-parts" element={<SparePartsPage />} />
        <Route path="/admin/checklists" element={<ChecklistsPage />} />
        <Route path="/admin/sla" element={<SlaPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
