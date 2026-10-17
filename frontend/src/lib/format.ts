export const STATUS: Record<string, { label: string; icon: string; bg: string; fg: string }> = {
  new: { label: 'Новая', icon: 'dot', bg: '#dbeafe', fg: '#1e3a8a' },
  accepted: { label: 'Принята', icon: 'check', bg: '#e0e7ff', fg: '#3730a3' },
  assigned: { label: 'Назначена', icon: 'user', bg: '#ccfbf1', fg: '#115e59' },
  in_progress: { label: 'В работе', icon: 'cog', bg: '#d1fae5', fg: '#065f46' },
  paused: { label: 'На паузе', icon: 'pause', bg: '#fef3c7', fg: '#92400e' },
  awaiting_confirmation: { label: 'Ждёт подтверждения', icon: 'hourglass', bg: '#ede9fe', fg: '#5b21b6' },
  closed: { label: 'Закрыта', icon: 'check', bg: '#dcfce7', fg: '#166534' },
  rejected: { label: 'Отклонена', icon: 'x', bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { label: 'Отменена', icon: 'ban', bg: '#e5e7eb', fg: '#374151' },
}
export const PRIORITY: Record<string, string> = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', critical: 'Критический' }
export const PRIORITY_COLOR: Record<string, string> = { low: '#475467', normal: '#1e3a8a', high: '#b45309', critical: '#c9300a' }
export const KIND: Record<string, string> = { corrective: 'Корректирующая', planned: 'Плановая' }
export const EQ_TYPE: Record<string, string> = { transformer: 'Трансформатор', substation: 'Подстанция (КТП)', switchgear: 'РУ (распределительная подстанция)' }
export const EQ_STATE: Record<string, string> = { operational: 'Исправно', degraded: 'Ограниченно', out_of_service: 'Выведено из работы' }
export const ROLE: Record<string, string> = { admin: 'Администратор', dispatcher: 'Диспетчер', engineer: 'Инженер', manager: 'Руководитель', client: 'Клиент' }
export const STAGE: Record<string, string> = { before: 'До', during: 'В ходе', after: 'После', other: 'Прочее' }
export const URGENCY: Record<string, string> = { planned: 'Плановая (не срочно)', urgent: 'Срочно', emergency: 'Авария' }
export const PAUSE_REASON: Record<string, string> = {
  waiting_client: 'Ожидание клиента', waiting_access: 'Ожидание доступа', waiting_parts: 'Ожидание запчастей',
  shutdown_window: 'Ожидание окна отключения', other: 'Другое',
}
export const EVENT: Record<string, string> = {
  created: 'Заявка создана', edited: 'Заявка изменена', accepted: 'Заявка принята', rejected: 'Заявка отклонена',
  assigned: 'Назначен инженер', reassigned: 'Инженер переназначен', started: 'Работы начаты', paused: 'Работы приостановлены',
  resumed: 'Работы возобновлены', priority_changed: 'Изменён приоритет', completed: 'Работы завершены',
  act_generated: 'Сформирован акт', returned: 'Возвращена на доработку', confirmed: 'Результат подтверждён',
  cancelled: 'Заявка отменена', comment_added: 'Комментарий', attachment_added: 'Добавлено вложение',
  photo_exception_requested: 'Запрошено исключение по фото', photo_exception_approved: 'Исключение по фото одобрено',
  photo_exception_rejected: 'Исключение по фото отклонено', archived: 'Архивирована', unarchived: 'Возвращена из архива',
}

const tz = 'Asia/Almaty'
export const fmtDateTime = (s?: string | null) =>
  s ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: tz }).format(new Date(s)) : '—'
export const fmtDate = (s?: string | null) =>
  s ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: s.length === 10 ? 'UTC' : tz }).format(new Date(s)) : '—'

export function fmtDuration(sec?: number | null) {
  if (sec === null || sec === undefined) return '—'
  const s = Math.abs(Math.round(sec))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (d) return `${d} д ${h} ч`
  if (h) return `${h} ч ${m} мин`
  if (m) return `${m} мин${s < 3600 && r ? ` ${r} с` : ''}`
  return `${r} с`
}

export function slaText(sla: any, status: string): { text: string; bad: boolean } {
  if (!sla) return { text: '', bad: false }
  if (['closed', 'rejected', 'cancelled'].includes(status)) return { text: sla.resolved_within_sla === false ? 'Срок нарушен' : '', bad: sla.resolved_within_sla === false }
  if (!sla.clock_running) return { text: sla.is_overdue ? 'Часы остановлены · срок превышен' : 'Часы SLA остановлены', bad: !!sla.is_overdue }
  if (sla.is_overdue) {
    const over = sla.consumed_seconds !== undefined ? sla.consumed_seconds - sla.resolution_limit_seconds : null
    return { text: over && over > 0 ? `Просрочено на ${fmtDuration(over)}` : 'Просрочено', bad: true }
  }
  if (sla.due_at) {
    const left = (new Date(sla.due_at).getTime() - Date.now()) / 1000
    return { text: left > 0 ? `Ещё ${fmtDuration(left)}` : 'Срок истекает', bad: false }
  }
  return { text: '', bad: false }
}

export const num = (v: any, d = 1) => (v === null || v === undefined ? '—' : Number(v).toFixed(d).replace(/\.0+$/, ''))

export const UNIT: Record<string, string> = { pcs: 'шт', l: 'л', kg: 'кг', m: 'м', set: 'компл.' }
