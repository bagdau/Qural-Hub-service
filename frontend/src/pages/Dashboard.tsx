import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Empty, ErrorBox, Field, Modal, PriorityBadge, Skeleton, SlaChip, StatusBadge } from '../components/ui'
import { fmtDate, fmtDateTime, fmtDuration, num, PRIORITY, STATUS } from '../lib/format'
import { Icon } from '../components/Icon'
import { CountUp } from '../components/charts/CountUp'
import { Gauge } from '../components/charts/Gauge'
import { Pie3D } from '../components/charts/Pie3D'
import { Columns3D } from '../components/charts/Columns3D'
import { ALERT_BG, ALERT_TITLE, type MapAlert } from '../lib/mapMeta'

const STATUS_COLOR: Record<string, string> = {
  new: '#0ea5e9', accepted: '#8b5cf6', assigned: '#6366f1', in_progress: '#0d7a5f', paused: '#f59e0b',
  awaiting_confirmation: '#ec4899', closed: '#64748b', rejected: '#ef4444', cancelled: '#a8b3c4',
}
const PRIORITY_BAR: Record<string, string> = { critical: '#d92d20', high: '#f79009', normal: '#2563eb', low: '#98a2b3' }
const good = (v: number | null | undefined, hi = 80, mid = 60) => (v == null ? '#98a2b3' : v >= hi ? '#0d7a5f' : v >= mid ? '#f79009' : '#d92d20')
const bad = (v: number | null | undefined, lo = 10, mid = 20) => (v == null ? '#98a2b3' : v <= lo ? '#0d7a5f' : v <= mid ? '#f79009' : '#d92d20')

/** Показатель: значок, «набегающее» число, подпись и мини-визуализация справа. Нажатие открывает список заявок. */
function Kpi({ label, value, sub, bad: isBad, onClick, icon, accent, visual, i = 0 }: {
  label: string; value: React.ReactNode; sub?: string; bad?: boolean; onClick?: () => void; icon: string; accent: string; visual?: React.ReactNode; i?: number
}) {
  const inner = (
    <>
      <div className="kpi-top"><span className="kpi-ico"><Icon name={icon} size={22} /></span>{visual}</div>
      <div className="v">{value}</div><div className="l">{label}</div>{sub && <div className="small muted">{sub}</div>}
    </>
  )
  const style = { ['--acc' as any]: accent, ['--i' as any]: i }
  return onClick
    ? <button className={`card kpi kpi2 ${isBad ? 'bad' : ''}`} style={style} onClick={onClick} aria-label={`${label}. Показать заявки`}>{inner}</button>
    : <div className={`card kpi kpi2 ${isBad ? 'bad' : ''}`} style={style}>{inner}</div>
}

/** Мини-столбик распределения активных заявок по приоритетам */
function PriorityStack({ by }: { by: Record<string, number> }) {
  const keys = ['critical', 'high', 'normal', 'low']
  return (
    <div className="kpi-stack" role="img" aria-label={keys.map((k) => `${PRIORITY[k]}: ${by[k] ?? 0}`).join(', ')}>
      {keys.map((k) => <i key={k} style={{ flexGrow: by[k] ?? 0, background: PRIORITY_BAR[k], flexBasis: 0 }} title={`${PRIORITY[k]}: ${by[k] ?? 0}`} />)}
    </div>
  )
}

/** Сводка сигналов по объектам: авария / вызов / плановые — со ссылкой на карту */
function Signals() {
  const q = useQuery({ queryKey: ['map-objects'], queryFn: () => get('/map/objects'), staleTime: 30_000 })
  if (!q.data) return null
  const c = q.data.counts as Record<MapAlert, number>
  return (
    <div className="signal-row" aria-label="Сигналы по объектам">
      {(['accident', 'call', 'plan'] as MapAlert[]).map((k) => <span key={k} className="chip-s" style={{ background: ALERT_BG[k] }}>{ALERT_TITLE[k]}: {c[k]}</span>)}
      <Link className="btn sm" to="/map"><Icon name="pin" size={15} /> Открыть карту</Link>
    </div>
  )
}

function Drill({ metric, title, onClose }: { metric: string; title: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['metric', metric], queryFn: () => get('/analytics/metric-tickets', { metric, page_size: 50 }) })
  return (
    <Modal title={title} onClose={onClose} wide>
      {q.isLoading ? <Skeleton /> : q.error ? <ErrorBox error={q.error} /> : !q.data.items.length ? <Empty title="Нет заявок" /> : (
        <div className="table-wrap"><table><thead><tr><th>Номер</th><th>Название</th><th>Статус</th><th>Приоритет</th></tr></thead>
          <tbody>{q.data.items.map((t: any) => (
            <tr key={t.id}><td><Link to={`/tickets/${t.id}`}>{t.number}</Link></td><td>{t.title}</td><td><StatusBadge status={t.status} /></td><td><PriorityBadge priority={t.priority} /></td></tr>
          ))}</tbody></table></div>
      )}
    </Modal>
  )
}

export function DashboardPage() {
  const { me } = useAuth()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [drill, setDrill] = useState<{ metric: string; title: string } | null>(null)
  const nav = useNavigate()
  const q = useQuery({
    queryKey: ['summary', from, to],
    queryFn: () => get('/analytics/summary', { from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to + 'T23:59:59').toISOString() : undefined }),
  })
  const up = useQuery({ queryKey: ['upcoming'], queryFn: () => get('/maintenance/upcoming', { days: 14 }) })
  const od = useQuery({ queryKey: ['metric', 'overdue-list'], queryFn: () => get('/analytics/metric-tickets', { metric: 'overdue', page_size: 10 }) })
  const s = q.data
  const isClient = me?.role === 'client'
  return (
    <div className="stack">
      <div className="row between dash-head">
        <div><h1>{isClient ? 'Главная' : 'Панель управления'}</h1><div className="muted small">{s && `Состояние на ${fmtDateTime(s.period.generated_at)}`}</div></div>
        <div className="row">
          <Field label="С"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="По"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </div>
      {q.isLoading && <div className="card"><Skeleton lines={4} /></div>}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {s && (
        <>
          <div className="kpis">
            <Kpi i={0} icon="board" accent="#5b46d6" label="Активные заявки" value={<CountUp value={s.active.count} />} sub="на текущий момент" visual={<PriorityStack by={s.active.by_priority} />}
              onClick={() => setDrill({ metric: 'active', title: 'Активные заявки' })} />
            <Kpi i={1} icon="alert" accent="#d92d20" label="Просроченные" value={<CountUp value={s.overdue.count} />} bad={s.overdue.count > 0} sub={`выполнение: ${s.overdue.resolution} · реакция: ${s.overdue.reaction}`}
              visual={<Gauge value={s.active.count ? (100 * s.overdue.count) / s.active.count : 0} color="#d92d20" label={`Доля просроченных среди активных: ${s.active.count ? Math.round((100 * s.overdue.count) / s.active.count) : 0}%`} />}
              onClick={() => setDrill({ metric: 'overdue', title: 'Просроченные заявки' })} />
            <Kpi i={2} icon="clock" accent="#2563eb" label="Среднее время реакции" value={<CountUp value={s.reaction.avg_seconds} format={(v) => fmtDuration(Math.round(v))} />} sub={`выборка: ${s.reaction.sample} · ожидают реакции: ${s.awaiting_reaction}`}
              onClick={() => setDrill({ metric: 'reaction', title: 'Заявки в расчёте времени реакции' })} />
            <Kpi i={3} icon="visit" accent="#7c3aed" label="Среднее время до завершения" value={<CountUp value={s.completion.avg_seconds} format={(v) => fmtDuration(Math.round(v))} />} sub={`активное время сервиса · выборка: ${s.completion.sample}`}
              onClick={() => setDrill({ metric: 'completion', title: 'Заявки в расчёте времени до завершения' })} />
            <Kpi i={4} icon="checklist" accent={good(s.on_time.pct)} label="Выполнено в срок" value={<CountUp value={s.on_time.pct} format={(v) => `${num(v)}%`} />} sub={`${s.on_time.count} из ${s.on_time.sample}`}
              visual={<Gauge value={s.on_time.pct} color={good(s.on_time.pct)} label={`Выполнено в срок: ${s.on_time.pct ?? 'нет данных'}%`} />}
              onClick={() => setDrill({ metric: 'on_time', title: 'Выполнены в срок' })} />
            <Kpi i={5} icon="audit" accent={bad(s.repeat_failures.pct)} label="Повторные неисправности" value={<CountUp value={s.repeat_failures.pct} format={(v) => `${num(v)}%`} />} sub={`${s.repeat_failures.count} из ${s.repeat_failures.corrective_total} (окно ${s.repeat_failures.window_days} дн.)`}
              visual={<Gauge value={s.repeat_failures.pct} color={bad(s.repeat_failures.pct)} label={`Повторные неисправности: ${s.repeat_failures.pct ?? 'нет данных'}%`} />}
              onClick={() => setDrill({ metric: 'repeat', title: 'Повторные неисправности' })} />
            <Kpi i={6} icon="dashboard" accent="#4535b5" label="Всего заявок за период" value={<CountUp value={s.tickets_total} />} />
            <Kpi i={7} icon="tasks" accent="#0d7a5f" label="Закрыто за период" value={<CountUp value={s.closed_in_period} />}
              visual={<Gauge value={s.tickets_total ? (100 * s.closed_in_period) / s.tickets_total : 0} color="#0d7a5f" label={`Закрыто ${s.closed_in_period} из ${s.tickets_total}`} />} />
          </div>
          <div className="grid cols-2">
            <div className="card chartcard">
              <h2>Заявки по статусам <small>нажмите на сектор — откроется список</small></h2>
              <Pie3D ariaLabel={`Заявки по статусам: ${Object.entries<number>(s.by_status).map(([k, v]) => `${STATUS[k].label} ${v}`).join(', ')}`}
                data={Object.entries<number>(s.by_status).map(([k, v]) => ({ key: k, label: STATUS[k].label, value: v, color: STATUS_COLOR[k] ?? '#64748b' }))}
                onSelect={(k) => nav(`/tickets?status=${k}`)} totalLabel="Всего заявок" />
            </div>
            <div className="card chartcard">
              <h2>Активные заявки по приоритетам <small>всего {s.active.count}</small></h2>
              <Columns3D ariaLabel="Активные заявки по приоритетам"
                data={['critical', 'high', 'normal', 'low'].map((k) => ({ key: k, label: PRIORITY[k], value: s.active.by_priority[k] ?? 0, color: PRIORITY_BAR[k] }))} />
              <Signals />
            </div>
          </div>
          <div className="grid cols-2">
            {!isClient && s.engineer_load && (
              <div className="card chartcard">
                <h2>Загрузка инженеров <small>колонка — в работе, тень — вместимость</small></h2>
                {!s.engineer_load.length ? <Empty title="Нет инженеров" /> : (
                  <Columns3D ariaLabel="Загрузка инженеров"
                    data={s.engineer_load.map((e: any) => ({ key: e.engineer_id, label: e.full_name.replace('Инженер ', 'Инж. '), value: e.load, ghost: e.capacity, note: `${num(e.load_pct)}%`,
                      color: e.load_pct >= 100 ? '#d92d20' : e.load_pct >= 70 ? '#f79009' : '#0d7a5f' }))} />
                )}
              </div>
            )}
            <div className="card">
              <h2>Просроченные заявки</h2>
              {od.isLoading ? <Skeleton /> : !od.data?.items.length ? <Empty icon="check-circle" title="Просроченных заявок нет" /> : (
                <div className="stack">{od.data.items.map((t: any) => (
                  <Link key={t.id} to={`/tickets/${t.id}`} className="row between" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span><strong>{t.number}</strong> {t.title}<div className="small muted">{t.equipment.name}</div></span>
                    <SlaChip sla={t.sla} status={t.status} />
                  </Link>
                ))}</div>
              )}
            </div>
          </div>
          <div className="card">
            <h2>Плановые даты (14 дней)</h2>
            {up.isLoading ? <Skeleton /> : !up.data?.length ? <Empty title="Нет плановых работ" text="В ближайшие 14 дней плановых работ нет." /> : (
              <div className="stack">{up.data.map((p: any) => (
                <Link key={p.id} to={`/equipment/${p.equipment_id}`} className="row between" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span>{p.title}<div className="small muted">{p.equipment?.name}</div></span>
                  <span className={p.overdue ? 'err' : 'mono'}>{fmtDate(p.next_due_date)}{p.overdue ? ' · просрочено' : ''}</span>
                </Link>
              ))}</div>
            )}
          </div>
        </>
      )}
      {drill && <Drill {...drill} onClose={() => setDrill(null)} />}
    </div>
  )
}
