import { useEffect, useState } from 'react'
import { fmtDuration } from '../lib/format'
import { nowMs } from '../api/client'

// ---------------- колонки ----------------
export type ColumnId = 'new' | 'assigned' | 'in_progress' | 'waiting' | 'closed'
export const COLUMNS: { id: ColumnId; title: string; statuses: string[]; hint: string; accent: string }[] = [
  { id: 'new', title: 'Новая', statuses: ['new'], hint: 'Входящие, ждут диспетчера', accent: '#0284c7' },
  { id: 'assigned', title: 'Принята / Назначена', statuses: ['accepted', 'assigned'], hint: 'Инженер назначен, ждёт выезда', accent: '#6366f1' },
  { id: 'in_progress', title: 'В работе', statuses: ['in_progress'], hint: 'Идёт ремонт или обслуживание', accent: '#10b981' },
  { id: 'waiting', title: 'На паузе / Ждёт', statuses: ['paused', 'awaiting_confirmation'], hint: 'Запчасти, доступ, подтверждение клиента', accent: '#f59e0b' },
  { id: 'closed', title: 'Закрыта', statuses: ['closed', 'rejected', 'cancelled'], hint: 'Работы завершены и проверены', accent: '#64748b' },
]
export const columnOf = (status: string): ColumnId => COLUMNS.find((c) => c.statuses.includes(status))!.id

// ---------------- правила перетаскивания (сервер остаётся источником истины) ----------------
export type Drop =
  | { kind: 'noop' }
  | { kind: 'direct'; action: 'start' | 'resume'; to: string }
  | { kind: 'modal'; action: string }
  | { kind: 'navigate'; to: string }
  | { kind: 'deny'; reason: string }

export function resolveDrop(t: { id: string; status: string; allowed_actions: string[] }, target: ColumnId): Drop {
  const a = t.allowed_actions
  const can = (x: string) => a.includes(x)
  const from = columnOf(t.status)
  if (from === target) return { kind: 'noop' }
  switch (target) {
    case 'new':
      return { kind: 'deny', reason: 'Вернуть заявку в «Новые» нельзя.' }
    case 'assigned':
      if (t.status === 'new' && can('assign')) return { kind: 'modal', action: 'assign' }
      if (t.status === 'in_progress' && can('reassign')) return { kind: 'modal', action: 'reassign' }
      return { kind: 'deny', reason: 'Назначить инженера может только диспетчер.' }
    case 'in_progress':
      if (t.status === 'assigned' && can('start')) return { kind: 'direct', action: 'start', to: 'in_progress' }
      if (t.status === 'paused' && can('resume')) return { kind: 'direct', action: 'resume', to: 'in_progress' }
      if (t.status === 'awaiting_confirmation' && can('return')) return { kind: 'modal', action: 'return' }
      if (['new', 'accepted'].includes(t.status)) return { kind: 'deny', reason: 'Сначала назначьте инженера — перетащите заявку в «Принята / Назначена».' }
      if (t.status === 'assigned') return { kind: 'deny', reason: 'Начать работу может только назначенный инженер.' }
      return { kind: 'deny', reason: 'Это действие недоступно для вашей роли.' }
    case 'waiting':
      if (t.status === 'in_progress' && can('pause')) return { kind: 'modal', action: 'pause' }
      return { kind: 'deny', reason: 'На паузу можно поставить только заявку «В работе».' }
    case 'closed':
      if (t.status === 'awaiting_confirmation' && can('confirm')) return { kind: 'modal', action: 'confirm' }
      if (t.status === 'in_progress' && can('complete')) return { kind: 'navigate', to: `/tickets/${t.id}/report` }
      if (t.status === 'in_progress') return { kind: 'deny', reason: 'Завершить работы может назначенный инженер через отчёт.' }
      if (can('cancel')) return { kind: 'modal', action: 'cancel' }
      return { kind: 'deny', reason: 'Закрыть заявку может клиент после завершения работ.' }
  }
}

// ---------------- SLA ----------------
export type Tone = 'bad' | 'warn' | 'ok' | 'idle' | 'none'
export interface SlaView { tone: Tone; text: string; pulse: boolean }

export function slaView(t: any, now: number = nowMs()): SlaView {
  const s = t.sla
  if (!s) return { tone: 'none', text: '', pulse: false }
  if (t.status === 'closed') return s.resolved_within_sla === false ? { tone: 'bad', text: 'Срок нарушен', pulse: false } : { tone: 'ok', text: 'В срок', pulse: false }
  if (t.status === 'rejected' || t.status === 'cancelled') return { tone: 'none', text: '', pulse: false }
  if (t.status === 'awaiting_confirmation') return { tone: 'idle', text: 'Ждёт клиента · часы остановлены', pulse: false }
  if (t.status === 'paused') return { tone: s.is_overdue ? 'bad' : 'idle', text: s.is_overdue ? 'Пауза · срок уже превышен' : 'Пауза · часы остановлены', pulse: false }
  if (s.is_overdue) {
    const kind = s.overdue_kind
    if (kind === 'reaction' && s.reaction_due_at) return { tone: 'bad', text: `Реакция просрочена на ${fmtDuration((now - Date.parse(s.reaction_due_at)) / 1000)}`, pulse: true }
    const due = s.due_at ? Date.parse(s.due_at) : null
    if (due) return { tone: 'bad', text: `Просрочено на ${fmtDuration(Math.max(0, now - due) / 1000)}`, pulse: true }
    return { tone: 'bad', text: 'Просрочено', pulse: true }
  }
  if (s.due_at) {
    const left = (Date.parse(s.due_at) - now) / 1000
    if (left <= 0) return { tone: 'bad', text: `Просрочено на ${fmtDuration(-left)}`, pulse: true }
    const limit = s.resolution_limit_seconds
    const warn = left < 3600 || (limit ? left < limit * 0.25 : false)
    return { tone: warn ? 'warn' : 'ok', text: `Осталось ${fmtDuration(left)}`, pulse: false }
  }
  return { tone: 'none', text: '', pulse: false }
}

/** Секундный/полуминутный «тик» для обратного отсчёта без перезагрузки данных */
export function useNow(intervalMs = 15000): number {
  const [n, setN] = useState(nowMs())
  useEffect(() => {
    const id = setInterval(() => setN(nowMs()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return n
}

// ---------------- фильтры и сохранение рабочего пространства ----------------
export type ViewId = 'kanban' | 'list' | 'calendar' | 'gantt'
export interface Filters { statuses: string[]; priorities: string[]; engineers: string[]; from: string; to: string; q: string }
export interface Workspace { view: ViewId; density: 'standard' | 'compact'; filters: Filters }
export const EMPTY_FILTERS: Filters = { statuses: [], priorities: [], engineers: [], from: '', to: '', q: '' }
export const DEFAULT_WS: Workspace = { view: 'kanban', density: 'standard', filters: EMPTY_FILTERS }
const key = (uid: string) => `ash-workspace-v1:${uid}`

export function loadWorkspace(uid: string): Workspace {
  try {
    const raw = localStorage.getItem(key(uid))
    if (raw) {
      const w = JSON.parse(raw)
      return { ...DEFAULT_WS, ...w, filters: { ...EMPTY_FILTERS, ...(w.filters ?? {}) } }
    }
  } catch { /* повреждённые данные — берём значения по умолчанию */ }
  return DEFAULT_WS
}
export function saveWorkspace(uid: string, w: Workspace) {
  try { localStorage.setItem(key(uid), JSON.stringify(w)) } catch { /* хранилище недоступно */ }
}

export const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }
export const PRIORITY_TITLE: Record<string, string> = { critical: 'Критический', high: 'Высокий', normal: 'Средний', low: 'Низкий' }

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
export function matchesQuery(t: any, q: string): boolean {
  const n = norm(q.trim())
  if (!n) return true
  return [t.number, t.title, t.equipment?.name, t.equipment?.inventory_number, t.equipment?.model, t.organization?.name, t.assigned_engineer?.full_name, t.site?.name]
    .some((v) => v && norm(String(v)).includes(n))
}

export function applyFilters(tickets: any[], f: Filters): any[] {
  const from = f.from ? Date.parse(f.from + 'T00:00:00') : null
  const to = f.to ? Date.parse(f.to + 'T23:59:59') : null
  return tickets.filter((t) => {
    if (f.statuses.length && !f.statuses.includes(t.status)) return false
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false
    if (f.engineers.length) {
      const id = t.assigned_engineer?.id ?? 'none'
      if (!f.engineers.includes(id)) return false
    }
    const c = Date.parse(t.created_at)
    if (from !== null && c < from) return false
    if (to !== null && c > to) return false
    return matchesQuery(t, f.q)
  })
}

export const sortForBoard = (a: any, b: any) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || Date.parse(a.created_at) - Date.parse(b.created_at)

export const initials = (name?: string | null) => (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
const PALETTE = ['#0d7a5f', '#0284c7', '#7c3aed', '#c2410c', '#be185d', '#4d7c0f', '#0f766e', '#b45309']
export const avatarColor = (id?: string | null) => PALETTE[[...(id ?? 'x')].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length]

export const DAY_TZ = 'Asia/Almaty'
export const dayKey = (iso: string | number) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: DAY_TZ })
