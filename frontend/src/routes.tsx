import { lazy, type ComponentType } from 'react'
import { matchPath } from 'react-router-dom'

/** Все страницы грузятся по требованию: первый экран получает только каркас и нужный раздел. */
type Loader = () => Promise<{ default: ComponentType<any> }>

const pick = <M extends Record<string, any>>(load: () => Promise<M>, name: keyof M): Loader => () => load().then((m) => ({ default: m[name] as ComponentType<any> }))

export interface RouteDef { path: string; title: string; load: Loader }

const auth = () => import('./pages/Auth')
const equipment = () => import('./pages/Equipment')
const tickets = () => import('./pages/Tickets')
const engineer = () => import('./pages/Engineer')
const misc = () => import('./pages/Misc')
const admin = () => import('./pages/Admin')
const qrpage = () => import('./pages/QrPage')

export const ROUTES: RouteDef[] = [
  { path: '/login', title: 'Вход', load: pick(auth, 'LoginPage') },
  { path: '/change-password', title: 'Смена пароля', load: pick(auth, 'ChangePasswordPage') },
  { path: '/profile', title: 'Профиль', load: pick(auth, 'ProfilePage') },
  { path: '/', title: 'Главная', load: pick(() => import('./pages/Dashboard'), 'DashboardPage') },
  { path: '/equipment', title: 'Оборудование', load: pick(equipment, 'EquipmentListPage') },
  { path: '/equipment/new', title: 'Новое оборудование', load: pick(equipment, 'EquipmentFormPage') },
  { path: '/equipment/:id', title: 'Паспорт оборудования', load: pick(equipment, 'EquipmentDetailPage') },
  { path: '/equipment/:id/edit', title: 'Редактирование оборудования', load: pick(equipment, 'EquipmentFormPage') },
  { path: '/equipment/:id/qr', title: 'QR-код оборудования', load: pick(qrpage, 'EquipmentQrPage') },
  { path: '/generator', title: 'Генератор QR и документов', load: pick(qrpage, 'GeneratorPage') },
  { path: '/e/:code', title: 'Оборудование по QR', load: pick(equipment, 'QrResolverPage') },
  { path: '/map', title: 'Карта объектов', load: pick(() => import('./pages/MapPage'), 'MapPage') },
  { path: '/scan', title: 'Сканер QR', load: pick(() => import('./pages/Scan'), 'ScanPage') },
  { path: '/board', title: 'Заявки', load: pick(() => import('./pages/Workspace'), 'WorkspacePage') },
  { path: '/tickets', title: 'Заявки', load: pick(tickets, 'TicketsPage') },
  { path: '/tickets/new', title: 'Новая заявка', load: pick(tickets, 'TicketNewPage') },
  { path: '/tickets/:id', title: 'Заявка', load: pick(tickets, 'TicketDetailPage') },
  { path: '/tickets/:id/report', title: 'Отчёт о работах', load: pick(engineer, 'ReportPage') },
  { path: '/my-tasks', title: 'Мои задания', load: pick(engineer, 'MyTasksPage') },
  { path: '/acts/:id', title: 'Акт', load: pick(misc, 'ActPage') },
  { path: '/notifications', title: 'Уведомления', load: pick(misc, 'NotificationsPage') },
  { path: '/maintenance', title: 'Плановые работы', load: pick(misc, 'MaintenancePage') },
  { path: '/admin/users', title: 'Пользователи', load: pick(admin, 'UsersPage') },
  { path: '/admin/organizations', title: 'Организации и площадки', load: pick(admin, 'OrganizationsPage') },
  { path: '/admin/spare-parts', title: 'Запчасти', load: pick(admin, 'SparePartsPage') },
  { path: '/admin/checklists', title: 'Чек-листы', load: pick(admin, 'ChecklistsPage') },
  { path: '/admin/sla', title: 'Настройки SLA', load: pick(admin, 'SlaPage') },
  { path: '/admin/audit', title: 'Журнал аудита', load: pick(admin, 'AuditPage') },
]

export const LazyRoute: Record<string, ComponentType<any>> = Object.fromEntries(ROUTES.map((r) => [r.path, lazy(r.load)]))

/** Заголовок вкладки браузера для адреса (для экранных дикторов и истории) */
export function titleFor(pathname: string): string {
  const r = ROUTES.find((x) => matchPath({ path: x.path, end: true }, pathname))
  return r ? `${r.title} · Qural Hub` : 'Qural Hub'
}

const warmed = new Set<string>()
/** Загружает код раздела заранее (наведение мыши, касание, простой браузера) — переход происходит мгновенно */
export function preload(pathname: string) {
  const r = ROUTES.find((x) => matchPath({ path: x.path, end: true }, pathname))
  if (!r || warmed.has(r.path)) return
  warmed.add(r.path)
  r.load().catch(() => warmed.delete(r.path))
}

/** После входа в фоне подгружаем самые частые разделы */
export function warmUp(paths: string[]) {
  const run = () => paths.forEach(preload)
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => void)
  if (ric) ric(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
