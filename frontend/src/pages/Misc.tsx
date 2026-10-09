import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, Empty, ErrorBox, Pagination, Skeleton, errText, useToast } from '../components/ui'
import { fmtDate, fmtDateTime } from '../lib/format'
import { ActionModal } from './Tickets'

export function ActPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [action, setAction] = useState<string | null>(null)
  const act = useQuery({ queryKey: ['act', id], queryFn: () => get(`/acts/${id}`) })
  const t = useQuery({ queryKey: ['ticket', act.data?.ticket_id], enabled: !!act.data, queryFn: () => get(`/tickets/${act.data.ticket_id}`) })
  if (act.isLoading) return <div className="card"><Skeleton lines={4} /></div>
  if (act.error) return <ErrorBox error={act.error} retry={() => act.refetch()} />
  const a = act.data
  const ticket = t.data
  const canDecide = me?.role === 'client' && a.is_current && !a.decision && ticket?.allowed_actions?.includes('confirm')
  const status = a.decision === 'confirmed' ? ['Подтверждён', 'var(--ok-bg)', 'var(--ok)'] : a.decision === 'returned' || !a.is_current ? ['Неактуален — возвращён клиентом', '#e5e7eb', '#374151'] : ['Актуален', '#ede9fe', '#5b21b6']
  return (
    <div className="stack">
      <div className="row between">
        <div><div className="muted small">{ticket && <Link to={`/tickets/${ticket.id}`}>{ticket.number}</Link>} / акт</div><h1>Акт {a.number}</h1>
          <span className="badge" style={{ background: status[1], color: status[2] }}>{status[0]}</span> <span className="muted small">версия {a.version} · сформирован {fmtDateTime(a.generated_at)}</span></div>
        <div className="row">
          <a className="btn" href={`/api/v1/acts/${a.id}/pdf?download=1`}>⬇ Скачать PDF</a>
          {a.decision === 'confirmed' && <a className="btn" href={`/api/v1/acts/${a.id}/confirmation.pdf`} target="_blank" rel="noreferrer">Лист подтверждения</a>}
        </div>
      </div>
      {!a.is_current && !a.decision && <div className="banner warn">Эта версия акта неактуальна: по заявке сформирована более новая версия.</div>}
      {a.decision === 'returned' && <div className="banner warn">Клиент вернул заявку на доработку{a.decision_comment ? `: «${a.decision_comment}»` : ''}. Акт сохранён для истории.</div>}
      {a.decision === 'confirmed' && <div className="banner ok">Результат подтверждён {fmtDateTime(a.decided_at)}{a.rating ? ` · оценка ${a.rating}` : ''}. Подтверждение в системе не является электронной подписью.</div>}
      {canDecide && (
        <div className="card stack">
          <p style={{ margin: 0 }}>Проверьте акт. Подтверждение в системе фиксирует ваше решение и <strong>не является электронной подписью</strong>.</p>
          <div className="row"><Button variant="primary" onClick={() => setAction('confirm')}>Подтвердить результат</Button><Button variant="danger" onClick={() => setAction('return')}>Вернуть на доработку</Button></div>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <iframe title={`PDF акта ${a.number}`} src={`/api/v1/acts/${a.id}/pdf`} style={{ width: '100%', height: '75vh', border: 0 }} />
      </div>
      {action && ticket && <ActionModal action={action} t={ticket} onClose={() => setAction(null)} onDone={() => { setAction(null); qc.invalidateQueries(); if (ticket) nav(`/tickets/${ticket.id}`) }} />}
    </div>
  )
}

export function NotificationsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const [page, setPage] = useState(1)
  const [unread, setUnread] = useState(false)
  const q = useQuery({ queryKey: ['notifications', page, unread], queryFn: () => get('/notifications', { page, page_size: 30, unread }) })
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread'] }) }, onError: (x) => toast(errText(x), true) })
  const open = async (n: any) => {
    if (!n.read_at) { try { await post(`/notifications/${n.id}/read`) } catch { /* ignore */ } qc.invalidateQueries({ queryKey: ['unread'] }) }
    if (n.ticket_id) nav(`/tickets/${n.ticket_id}`)
  }
  return (
    <div className="stack">
      <div className="row between"><h1>Уведомления</h1><div className="row"><label className="row small"><input type="checkbox" checked={unread} onChange={(e) => { setUnread(e.target.checked); setPage(1) }} /> Только непрочитанные</label><Button small onClick={() => readAll.mutate()}>Прочитать все</Button></div></div>
      {q.isLoading ? <div className="card"><Skeleton lines={4} /></div> : q.error ? <ErrorBox error={q.error} /> : !q.data.items.length ? <div className="card"><Empty icon="🔔" title="Уведомлений нет" /></div> : (
        <div className="card" style={{ padding: 0 }}>
          {q.data.items.map((n: any) => (
            <button key={n.id} onClick={() => open(n)} style={{ display: 'block', width: '100%', textAlign: 'left', background: n.read_at ? 'transparent' : '#f0fdfa', border: 0, borderBottom: '1px solid var(--border)', padding: '12px 16px', cursor: 'pointer', minHeight: 56 }}>
              <div style={{ fontWeight: n.read_at ? 400 : 700 }}>{!n.read_at && <span aria-label="не прочитано">● </span>}{n.title}</div>
              <div className="small muted">{n.body} · {fmtDateTime(n.created_at)}</div>
            </button>))}
        </div>)}
      {q.data && <Pagination page={q.data.page} totalPages={q.data.total_pages} onPage={setPage} />}
    </div>
  )
}

export function MaintenancePage() {
  const q = useQuery({ queryKey: ['plans'], queryFn: () => get('/maintenance-plans', { page_size: 100 }) })
  return (
    <div className="stack">
      <h1>Плановые работы</h1>
      {q.isLoading ? <div className="card"><Skeleton lines={4} /></div> : q.error ? <ErrorBox error={q.error} /> : !q.data.items.length ? <div className="card"><Empty icon="📅" title="Планов обслуживания нет" text="Планы добавляются в паспорте оборудования (вкладка «План»)." /></div> : (
        <div className="card table-wrap"><table><thead><tr><th>Оборудование</th><th>План</th><th>Интервал</th><th>Последнее</th><th>Следующее</th></tr></thead>
          <tbody>{q.data.items.map((p: any) => {
            const over = new Date(p.next_due_date) < new Date()
            return <tr key={p.id}><td><Link to={`/equipment/${p.equipment_id}`}>{p.equipment?.name}</Link></td><td>{p.title}</td><td>{p.interval_days} дн.</td><td>{p.last_done_on ? fmtDate(p.last_done_on) : '—'}</td><td className={over ? 'err' : ''}>{fmtDate(p.next_due_date)}{over && ' · просрочено'}</td></tr>
          })}</tbody></table></div>)}
    </div>
  )
}
