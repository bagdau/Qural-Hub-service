import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Empty, ErrorBox, Field, Modal, PriorityBadge, Skeleton, SlaChip, StatusBadge } from '../components/ui'
import { fmtDate, fmtDateTime, fmtDuration, num, STATUS } from '../lib/format'

function Kpi({ label, value, sub, bad, onClick }: { label: string; value: any; sub?: string; bad?: boolean; onClick?: () => void }) {
  const inner = <><div className="v">{value}</div><div className="l">{label}</div>{sub && <div className="small muted">{sub}</div>}</>
  return onClick
    ? <button className={`card kpi ${bad ? 'bad' : ''}`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={onClick} aria-label={`${label}: ${value}. Показать заявки`}>{inner}</button>
    : <div className={`card kpi ${bad ? 'bad' : ''}`}>{inner}</div>
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
  const maxStatus = s ? Math.max(1, ...Object.values<number>(s.by_status)) : 1
  return (
    <div className="stack">
      <div className="row between">
        <div><h1>{isClient ? 'Главная' : 'Дашборд'}</h1><div className="muted small">{s && `Состояние на ${fmtDateTime(s.period.generated_at)}`}</div></div>
        <div className="row">
          <Field label="С"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="По"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </div>
      {q.isLoading && <div className="card"><Skeleton lines={4} /></div>}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {s && (
        <>
          <div className="grid cols-4">
            <Kpi label="Активные заявки" value={s.active.count} sub="на текущий момент" onClick={() => setDrill({ metric: 'active', title: 'Активные заявки' })} />
            <Kpi label="Просроченные" value={s.overdue.count} bad={s.overdue.count > 0} sub={`выполнение: ${s.overdue.resolution} · реакция: ${s.overdue.reaction}`} onClick={() => setDrill({ metric: 'overdue', title: 'Просроченные заявки' })} />
            <Kpi label="Среднее время реакции" value={fmtDuration(s.reaction.avg_seconds)} sub={`выборка: ${s.reaction.sample} · ожидают реакции: ${s.awaiting_reaction}`} onClick={() => setDrill({ metric: 'reaction', title: 'Заявки в расчёте времени реакции' })} />
            <Kpi label="Среднее время до завершения" value={fmtDuration(s.completion.avg_seconds)} sub={`активное время сервиса · выборка: ${s.completion.sample}`} onClick={() => setDrill({ metric: 'completion', title: 'Заявки в расчёте времени до завершения' })} />
            <Kpi label="Выполнено в срок" value={s.on_time.pct === null ? '—' : `${num(s.on_time.pct)}%`} sub={`${s.on_time.count} из ${s.on_time.sample}`} onClick={() => setDrill({ metric: 'on_time', title: 'Выполнены в срок' })} />
            <Kpi label="Повторные неисправности" value={s.repeat_failures.pct === null ? '—' : `${num(s.repeat_failures.pct)}%`} sub={`${s.repeat_failures.count} из ${s.repeat_failures.corrective_total} (окно ${s.repeat_failures.window_days} дн.)`} onClick={() => setDrill({ metric: 'repeat', title: 'Повторные неисправности' })} />
            <Kpi label="Всего заявок за период" value={s.tickets_total} />
            <Kpi label="Закрыто за период" value={s.closed_in_period} />
          </div>
          <div className="grid cols-2">
            <div className="card">
              <h2>Заявки по статусам</h2>
              <div className="stack" role="list">
                {Object.entries<number>(s.by_status).map(([k, v]) => (
                  <div key={k} className="bar" role="listitem" onClick={() => nav(`/tickets?status=${k}`)} style={{ cursor: 'pointer' }}>
                    <span style={{ width: 160 }} className="small">{STATUS[k].label}</span>
                    <span className="track"><span className="fill" style={{ display: 'block', width: `${(100 * v) / maxStatus}%` }} /></span>
                    <span className="mono" style={{ width: 28, textAlign: 'right' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="small muted" style={{ marginTop: 10 }}>Активные по приоритетам: критический {s.active.by_priority.critical} · высокий {s.active.by_priority.high} · обычный {s.active.by_priority.normal} · низкий {s.active.by_priority.low}</div>
            </div>
            {!isClient && s.engineer_load && (
              <div className="card">
                <h2>Загрузка инженеров</h2>
                {!s.engineer_load.length ? <Empty title="Нет инженеров" /> : (
                  <div className="stack">{s.engineer_load.map((e: any) => (
                    <div key={e.engineer_id}>
                      <div className="row between"><span>{e.full_name}</span><span className="mono small">{e.load} из {e.capacity} · {num(e.load_pct)}%</span></div>
                      <div className="bar"><span className="track"><span className={`fill ${e.load_pct >= 100 ? 'hot' : ''}`} style={{ display: 'block', width: `${Math.min(100, e.load_pct)}%` }} /></span></div>
                    </div>
                  ))}</div>
                )}
              </div>
            )}
          </div>
          <div className="grid cols-2">
            <div className="card">
              <h2>Просроченные заявки</h2>
              {od.isLoading ? <Skeleton /> : !od.data?.items.length ? <Empty icon="✅" title="Просроченных заявок нет" /> : (
                <div className="stack">{od.data.items.map((t: any) => (
                  <Link key={t.id} to={`/tickets/${t.id}`} className="row between" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span><strong>{t.number}</strong> {t.title}<div className="small muted">{t.equipment.name}</div></span>
                    <SlaChip sla={t.sla} status={t.status} />
                  </Link>
                ))}</div>
              )}
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
          </div>
        </>
      )}
      {drill && <Drill {...drill} onClose={() => setDrill(null)} />}
    </div>
  )
}
