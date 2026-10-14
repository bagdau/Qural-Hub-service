import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, del, get, post, put, uuid } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Uploader } from '../components/Uploader'
import { Button, Empty, ErrorBox, Field, PriorityBadge, Skeleton, StatusBadge, errText, useToast } from '../components/ui'
import { EQ_STATE, EQ_TYPE, EVENT, fmtDate, fmtDateTime, KIND, PAUSE_REASON, PRIORITY, STAGE, UNIT, STATUS } from '../lib/format'
import { flagOf } from '../pages/Engineer'
import { ActionModal } from '../pages/Tickets'
import { avatarColor, initials, slaView, useNow } from './boardLib'
import { SlaBadge } from './Kanban'
import { Icon } from '../components/Icon'

const ACTION_LABEL: Record<string, string> = {
  accept: 'Принять', reject: 'Отклонить', assign: 'Назначить инженера', reassign: 'Переназначить', start: 'Начать работу', pause: 'Приостановить',
  resume: 'Продолжить работу', confirm: 'Подтвердить результат', return: 'Вернуть на доработку', cancel: 'Отменить заявку', priority: 'Изменить приоритет',
}
const TABS: [string, string][] = [['overview', 'Обзор'], ['checklist', 'Чек-листы'], ['parts', 'Запчасти и материалы'], ['log', 'Журнал и чат']]

export function Drawer({ id, allTickets, onClose, onOpen }: { id: string; allTickets: any[]; onClose: () => void; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState('overview')
  const [action, setAction] = useState<string | null>(null)
  const qc = useQueryClient()
  const t = useQuery({ queryKey: ['ticket', id], queryFn: () => get(`/tickets/${id}`) })
  const ref = useRef<HTMLElement>(null)
  const now = useNow(15000)
  useEffect(() => { setTab('overview') }, [id])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog][aria-modal=true]')) onClose() }
    document.addEventListener('keydown', k)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', k)
  }, [onClose, id])
  const d = t.data
  return (
    <aside className="drawer" ref={ref} tabIndex={-1} aria-label="Подробности заявки" data-testid="drawer">
      <div className="drawer-head">
        {t.isLoading ? <Skeleton lines={2} /> : t.error ? <ErrorBox error={t.error} retry={() => t.refetch()} /> : (
          <>
            <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="small muted">{d.number} · {KIND[d.kind]}</div>
                <h2 style={{ margin: '2px 0 6px' }}>{d.title}</h2>
                <div className="row" style={{ gap: 8 }}><StatusBadge status={d.status} /><PriorityBadge priority={d.priority} /><SlaBadge t={d} now={now} /></div>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <Link className="btn sm" to={`/tickets/${d.id}`} title="Открыть на отдельной странице" aria-label="Открыть на отдельной странице"><Icon name="expand" size={16} /></Link>
                <button className="btn sm" onClick={onClose} aria-label="Закрыть панель">✕</button>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="tabs" role="tablist" style={{ margin: '0 20px' }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="drawer-body">
        {d && tab === 'overview' && <Overview t={d} allTickets={allTickets} onOpen={onOpen} onAction={setAction} />}
        {d && tab === 'checklist' && <ChecklistTab t={d} />}
        {d && tab === 'parts' && <PartsTab t={d} />}
        {d && tab === 'log' && <LogTab t={d} />}
      </div>
      {action && d && <ActionModal action={action} t={d} onClose={() => setAction(null)} onDone={() => { setAction(null); qc.invalidateQueries({ queryKey: ['board'] }); qc.invalidateQueries({ queryKey: ['ticket', id] }); qc.invalidateQueries({ queryKey: ['events', id] }) }} />}
    </aside>
  )
}

// ---------------- Обзор ----------------
function Overview({ t, allTickets, onOpen, onAction }: { t: any; allTickets: any[]; onOpen: (id: string) => void; onAction: (a: string) => void }) {
  const { me } = useAuth()
  const eq = useQuery({ queryKey: ['eq', t.equipment.id], queryFn: () => get(`/equipment/${t.equipment.id}`) })
  const now = useNow()
  const actions: string[] = t.allowed_actions.filter((a: string) => ACTION_LABEL[a])
  const sla = t.sla
  const history = allTickets.filter((x) => x.organization.id === t.organization.id && x.id !== t.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5)
  const v = slaView(t, now)
  return (
    <div className="stack">
      {actions.length > 0 && <div className="row">{actions.map((a) => (
        <Button key={a} variant={['accept', 'assign', 'start', 'confirm', 'resume'].includes(a) ? 'primary' : ['reject', 'cancel'].includes(a) ? 'danger' : undefined} onClick={() => onAction(a)}>{ACTION_LABEL[a]}</Button>))}
        {t.allowed_actions.includes('complete') && <Link className="btn primary" to={`/tickets/${t.id}/report`}>Отчёт и завершение</Link>}</div>}
      {t.status === 'paused' && t.pause && <div className="banner warn"><strong>{PAUSE_REASON[t.pause.reason_code]}.</strong> {t.pause.comment}<div className="small">Следующее действие: {t.pause.next_action}. Возобновление: {fmtDateTime(t.pause.expected_resume_at)}.</div></div>}
      <div className="card">
        <h3>Описание</h3>
        <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{t.description}</p>
        <dl className="facts">
          {([['Клиент', t.organization.name], ['Площадка', `${t.site.name}, ${t.site.address}`], ['Контакт', [t.contact.name, t.contact.phone].filter(Boolean).join(', ') || '—'],
            ['Создана', `${fmtDateTime(t.created_at)} · ${t.created_by?.full_name ?? 'Система (план ТО)'}`],
            ['Исполнитель', t.assigned_engineer ? <span className="who"><i style={{ background: avatarColor(t.assigned_engineer.id) }}>{initials(t.assigned_engineer.full_name)}</i>{t.assigned_engineer.full_name}</span> : 'Не назначен'],
            ['Плановый визит', t.scheduled_at ? fmtDateTime(t.scheduled_at) : '—'], ['Возвратов', t.return_count]] as [string, any][]).map(([k, val]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{val}</dd></div>)}
        </dl>
      </div>
      {me?.role !== 'client' && sla.consumed_seconds !== undefined && (
        <div className="card">
          <h3>SLA</h3>
          <div className="row between small"><span>{v.text || '—'}</span><span className="muted">{Math.round(sla.consumed_seconds / 60)} из {Math.round(sla.resolution_limit_seconds / 60)} мин</span></div>
          <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, (100 * sla.consumed_seconds) / sla.resolution_limit_seconds)}%`, background: v.tone === 'bad' ? 'var(--danger)' : v.tone === 'warn' ? 'var(--amber)' : 'var(--progress)' }} /></div>
          <div className="small muted" style={{ marginTop: 6 }}>Реакция до {fmtDateTime(sla.reaction_due_at)}{sla.first_reacted_at ? ` · принята ${fmtDateTime(sla.first_reacted_at)}` : ' · ещё не принята'}</div>
        </div>
      )}
      <div className="card">
        <div className="row between"><h3>Технический паспорт</h3><Link to={`/equipment/${t.equipment.id}`} className="small">Открыть паспорт →</Link></div>
        {eq.isLoading ? <Skeleton lines={2} /> : eq.data && (
          <dl className="facts">
            {([['Оборудование', `${eq.data.name} (${EQ_TYPE[eq.data.type]})`], ['Инв. / серийный №', `${eq.data.inventory_number} / ${eq.data.serial_number ?? '—'}`], ['Модель', `${eq.data.manufacturer ?? '—'} ${eq.data.model ?? ''}`],
              ['Мощность / напряжение', `${eq.data.rated_power_kva ? eq.data.rated_power_kva + ' кВА' : '—'} / ${eq.data.voltage_class_kv ? eq.data.voltage_class_kv + ' кВ' : '—'}`], ['Состояние', EQ_STATE[eq.data.technical_state]],
              ['Ближайшее ТО', eq.data.next_due_date ? fmtDate(eq.data.next_due_date) : '—'], ['Повторных неисправностей (90 дн.)', eq.data.repeat_failures_90d]] as [string, any][]).map(([k, val]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{val}</dd></div>)}
          </dl>)}
      </div>
      <div className="card">
        <h3>История клиента</h3>
        {!history.length ? <p className="muted" style={{ margin: 0 }}>Других заявок клиента нет.</p> : history.map((h) => (
          <button key={h.id} className="histrow" onClick={() => onOpen(h.id)}><span><b>{h.number}</b> {h.title}</span><StatusBadge status={h.status} /></button>))}
      </div>
    </div>
  )
}

// ---------------- Чек-листы ----------------
function ChecklistTab({ t }: { t: any }) {
  const { me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const r = useQuery({ queryKey: ['report', t.id], retry: false, enabled: me?.role !== 'client', queryFn: () => get(`/tickets/${t.id}/report`) })
  const [answers, setAnswers] = useState<Record<string, any> | null>(null)
  const version = useRef(0)
  const timer = useRef<any>(null)
  const [saving, setSaving] = useState<'saved' | 'saving' | 'error'>('saved')
  useEffect(() => { if (r.data) { version.current = r.data.version; setAnswers(r.data.checklist_answers ?? {}) } }, [r.data?.id, r.data?.revision]) // eslint-disable-line
  const editable = me?.role === 'engineer' && t.assigned_engineer?.id === me.id && r.data?.status === 'draft' && ['assigned', 'in_progress', 'paused'].includes(t.status)
  if (me?.role === 'client') return <Empty icon="file" title="Чек-лист доступен в акте" text="После завершения работ результаты проверок включаются в акт." />
  if (r.isLoading) return <Skeleton lines={4} />
  if (r.error) return <Empty icon="checklist" title="Чек-лист ещё не начат" text="Он появится, когда инженер начнёт работу." />
  const items: any[] = r.data.template.schema.items
  const ans = answers ?? {}
  const done = items.filter((i) => i.type !== 'text' && ans[i.key]?.value !== undefined && ans[i.key]?.value !== null && ans[i.key]?.value !== '').length
  const total = items.filter((i) => i.type !== 'text').length
  const save = (next: any) => {
    setSaving('saving'); clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await put(`/tickets/${t.id}/report`, { version: version.current, checklist_answers: next })
        version.current = res.version; setSaving('saved')
        qc.setQueryData(['report', t.id], res); qc.invalidateQueries({ queryKey: ['board'] })
      } catch (e) {
        setSaving('error')
        if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') { toast('Отчёт изменён на другом устройстве — данные обновлены.', true); r.refetch() } else toast(errText(e), true)
      }
    }, 900)
  }
  const setAns = (key: string, patch: any) => { const next = { ...ans, [key]: { ...(ans[key] ?? {}), ...patch } }; setAnswers(next); save(next) }
  const current = items.find((i) => i.type !== 'text' && (ans[i.key]?.value === undefined || ans[i.key]?.value === null || ans[i.key]?.value === ''))
  return (
    <div className="stack">
      <div className="card">
        <div className="row between"><strong>{r.data.template.title}</strong><span className="small muted">версия {r.data.template.version}</span></div>
        <div className="row between small" style={{ margin: '8px 0 4px' }}><span>Выполнено {done} из {total}</span><span aria-live="polite" className="muted">{editable ? (saving === 'saved' ? '✓ Сохранено' : saving === 'saving' ? 'Сохранение…' : 'Ошибка сохранения') : 'Только просмотр'}</span></div>
        <div className="progress"><i style={{ width: `${total ? (100 * done) / total : 0}%` }} /></div>
      </div>
      <ol className="steps-list">
        {items.map((i, idx) => {
          const a = ans[i.key] ?? {}
          const has = a.value !== undefined && a.value !== null && a.value !== ''
          const flagged = flagOf(i, a.value)
          const isCur = current?.key === i.key
          return (
            <li key={i.key} className={`${has ? 'done' : ''} ${isCur ? 'cur' : ''} ${flagged ? 'flag' : ''}`}>
              <div className="stepno" aria-hidden>{has ? '✓' : idx + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{i.label}</strong>{i.required && <span className="err"> *</span>}{i.unit && <span className="muted"> ({i.unit})</span>}</div>
                {i.type === 'boolean' && <div className="row" style={{ marginTop: 6 }}>
                  <Button small disabled={!editable} variant={a.value === true ? 'primary' : undefined} aria-pressed={a.value === true} onClick={() => setAns(i.key, { value: true })}>Норма</Button>
                  <Button small disabled={!editable} variant={a.value === false ? 'danger' : undefined} aria-pressed={a.value === false} onClick={() => setAns(i.key, { value: false })}>Не норма</Button></div>}
                {i.type === 'number' && <input className="input" style={{ marginTop: 6, maxWidth: 220 }} type="number" step="any" disabled={!editable} value={a.value ?? ''} aria-label={i.label} onChange={(e) => setAns(i.key, { value: e.target.value === '' ? null : Number(e.target.value) })} />}
                {i.type === 'enum' && <select className="input" style={{ marginTop: 6, maxWidth: 260 }} disabled={!editable} value={a.value ?? ''} aria-label={i.label} onChange={(e) => setAns(i.key, { value: e.target.value || null })}><option value="">Выберите…</option>{i.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
                {i.type === 'text' && <textarea className="input" style={{ marginTop: 6 }} disabled={!editable} value={a.value ?? ''} aria-label={i.label} onChange={(e) => setAns(i.key, { value: e.target.value })} />}
                {i.type !== 'text' && (flagged || a.comment) && <input className="input" style={{ marginTop: 6 }} disabled={!editable} placeholder={flagged ? 'Комментарий обязателен для «не норма»' : 'Комментарий'} value={a.comment ?? ''} aria-label={`Комментарий: ${i.label}`} onChange={(e) => setAns(i.key, { comment: e.target.value })} />}
              </div>
            </li>)
        })}
      </ol>
      {editable && t.allowed_actions.includes('complete') && <Link className="btn primary" to={`/tickets/${t.id}/report`}>Перейти к отчёту и завершению →</Link>}
    </div>
  )
}

// ---------------- Запчасти ----------------
function PartsTab({ t }: { t: any }) {
  const { me } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const parts = useQuery({ queryKey: ['parts', t.id], queryFn: () => get(`/tickets/${t.id}/parts`) })
  const report = useQuery({ queryKey: ['report', t.id], retry: false, enabled: me?.role !== 'client', queryFn: () => get(`/tickets/${t.id}/report`) })
  const cat = useQuery({ queryKey: ['catalog'], enabled: me?.role === 'engineer', queryFn: () => get('/spare-parts', { page_size: 100 }) })
  const [part, setPart] = useState(''); const [qty, setQty] = useState('1')
  const editable = me?.role === 'engineer' && t.assigned_engineer?.id === me.id && report.data?.status === 'draft' && ['assigned', 'in_progress', 'paused'].includes(t.status)
  const inv = () => { qc.invalidateQueries({ queryKey: ['parts', t.id] }); qc.invalidateQueries({ queryKey: ['report', t.id] }); qc.invalidateQueries({ queryKey: ['board'] }) }
  const add = useMutation({ mutationFn: () => post(`/tickets/${t.id}/parts`, { spare_part_id: part, quantity: Number(qty) }), onSuccess: () => { setPart(''); setQty('1'); inv() }, onError: (x) => toast(errText(x), true) })
  const rm = useMutation({ mutationFn: (uid: string) => del(`/tickets/${t.id}/parts/${uid}`), onSuccess: inv, onError: (x) => toast(errText(x), true) })
  return (
    <div className="stack">
      <div className="banner info small">Фиксируется то, что <strong>использовано при ремонте</strong>, — оно попадает в акт. Складской учёт (остатки, списание, резервирование) в MVP не ведётся.</div>
      {parts.isLoading ? <Skeleton /> : !parts.data?.length ? <Empty icon="parts" title="Запчасти не добавлены" text={editable ? 'Добавьте использованные позиции ниже.' : undefined} /> : (
        <div className="card table-wrap" style={{ padding: 0 }}><table className="dense"><thead><tr><th>Код</th><th>Наименование</th><th>Кол-во</th>{editable && <th />}</tr></thead>
          <tbody>{parts.data.map((p: any) => <tr key={p.id}><td className="mono"><b>{p.sku}</b></td><td>{p.name}</td><td>{p.quantity} {UNIT[p.unit] ?? p.unit}</td>{editable && <td><Button small onClick={() => rm.mutate(p.id)}>Удалить</Button></td>}</tr>)}</tbody></table></div>)}
      {editable && <div className="card row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}><Field label="Позиция справочника"><select value={part} onChange={(e) => setPart(e.target.value)}><option value="">Выберите…</option>{cat.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></Field></div>
        <div style={{ width: 100 }}><Field label="Кол-во"><input type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field></div>
        <Button variant="primary" onClick={() => add.mutate()} disabled={!part} loading={add.isPending}>Добавить</Button></div>}
    </div>
  )
}

// ---------------- Журнал и чат ----------------
const SLA_NOTE: Record<string, string> = { paused: 'часы SLA остановлены', resumed: 'часы SLA запущены', priority_changed: 'лимит SLA пересчитан', completed: 'часы SLA остановлены', returned: 'часы SLA продолжены', accepted: 'реакция зафиксирована' }

function LogTab({ t }: { t: any }) {
  const { me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const key = useRef(uuid())
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const events = useQuery({ queryKey: ['events', t.id], queryFn: () => get(`/tickets/${t.id}/events`, { page_size: 100 }) })
  const comments = useQuery({ queryKey: ['comments', t.id], queryFn: () => get(`/tickets/${t.id}/comments`, { page_size: 100 }) })
  const atts = useQuery({ queryKey: ['atts', t.id], queryFn: () => get(`/tickets/${t.id}/attachments`) })
  const send = useMutation({
    mutationFn: () => post(`/tickets/${t.id}/comments`, { body, visibility: me?.role === 'client' ? 'public' : internal ? 'internal' : 'public' }, key.current),
    onSuccess: () => { setBody(''); key.current = uuid(); qc.invalidateQueries({ queryKey: ['comments', t.id] }); qc.invalidateQueries({ queryKey: ['events', t.id] }); qc.invalidateQueries({ queryKey: ['board'] }) }, onError: (x) => toast(errText(x), true),
  })
  const feed = [
    ...(events.data?.items ?? []).filter((e: any) => !['comment_added', 'attachment_added'].includes(e.event_type)).map((e: any) => ({ at: e.created_at, kind: 'event', e, id: 'e' + e.id })),
    ...(comments.data?.items ?? []).map((c: any) => ({ at: c.created_at, kind: 'comment', c, id: 'c' + c.id })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const photos = (atts.data ?? []).filter((a: any) => a.kind === 'photo')
  const canUpload = !['closed', 'rejected', 'cancelled'].includes(t.status) && (me?.role === 'dispatcher' || (me?.role === 'client' && t.status !== 'awaiting_confirmation') || (me?.role === 'engineer' && t.assigned_engineer?.id === me.id))
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [feed.length])
  return (
    <div className="stack">
      <div className="card">
        <h3>Фотографии с места работ</h3>
        {!photos.length ? <p className="muted" style={{ margin: 0 }}>Фотографий пока нет.</p> : <div className="photos">{photos.map((a: any) => <a key={a.id} href={a.urls.download} target="_blank" rel="noreferrer"><img src={a.urls.thumbnail} alt={`Фото: ${STAGE[a.stage] ?? ''}`} loading="lazy" /><div className="small muted">{STAGE[a.stage]}</div></a>)}</div>}
        {canUpload && <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Добавить фото</summary><div style={{ marginTop: 8 }}>
          <Uploader ticketId={t.id} allowDocs={false} stages={me?.role === 'client' ? ['other'] : ['before', 'during', 'after', 'other']} defaultStage={me?.role === 'client' ? 'other' : 'before'} visibilityChoice={me?.role !== 'client'} onUploaded={() => qc.invalidateQueries({ queryKey: ['atts', t.id] })} /></div></details>}
      </div>
      <div className="card chat" aria-live="polite" aria-label="Журнал действий и комментарии">
        {events.isLoading || comments.isLoading ? <Skeleton lines={4} /> : !feed.length ? <Empty title="Записей пока нет" /> : feed.map((x: any) => x.kind === 'event' ? (
          <div key={x.id} className="evt"><span className="evt-dot" aria-hidden />
            <div><strong>{EVENT[x.e.event_type] ?? x.e.event_type}</strong>{x.e.to_status && x.e.from_status !== x.e.to_status && <> → {STATUS[x.e.to_status]?.label}</>}{x.e.visibility === 'internal' && <span title="Видно только сотрудникам"> <Icon name="lock" size={13} /></span>}
              <div className="small muted">{fmtDateTime(x.e.created_at)} · {x.e.actor?.full_name ?? 'Система'}{SLA_NOTE[x.e.event_type] ? ` · ${SLA_NOTE[x.e.event_type]}` : ''}</div>
              {x.e.event_type === 'paused' && <div className="small">{PAUSE_REASON[x.e.payload?.reason_code]}</div>}
              {x.e.event_type === 'priority_changed' && <div className="small">{PRIORITY[x.e.payload?.from]} → {PRIORITY[x.e.payload?.to]}</div>}
              {x.e.event_type === 'reassigned' && <div className="small">{x.e.payload.from_name} → {x.e.payload.to_name}</div>}
              {x.e.comment && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>«{x.e.comment}»</div>}</div></div>
        ) : (
          <div key={x.id} className={`msg ${x.c.author?.id === me?.id ? 'mine' : ''} ${x.c.visibility === 'internal' ? 'internal' : ''}`}>
            <div className="small muted">{x.c.author?.full_name} · {fmtDateTime(x.c.created_at)}{x.c.visibility === 'internal' && <> · <Icon name="lock" size={13} /> внутренний</>}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{x.c.body}</div></div>))}
        <div ref={endRef} />
      </div>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate() }}>
        <Field label="Сообщение"><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="Напишите комментарий…" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) send.mutate() }} /></Field>
        <div className="row between">{me?.role !== 'client' ? <label className="row small"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Внутренний (клиент не увидит)</label> : <span className="small muted">Ctrl+Enter — отправить</span>}
          <Button type="submit" variant="primary" loading={send.isPending} disabled={!body.trim()}>Отправить</Button></div>
      </form>
    </div>
  )
}
