import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, post, uuid } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Uploader } from '../components/Uploader'
import { Button, Empty, ErrorBox, Field, Modal, Pagination, PriorityBadge, Skeleton, SlaChip, StatusBadge, errText, useDebounced, useToast } from '../components/ui'
import { EVENT, UNIT, fmtDateTime, KIND, PAUSE_REASON, PRIORITY, STAGE, STATUS, URGENCY } from '../lib/format'

export function TicketsPage() {
  const { me } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const dq = useDebounced(q)
  const status = sp.get('status') ?? ''
  const priority = sp.get('priority') ?? ''
  const overdue = sp.get('overdue') === '1'
  const [page, setPage] = useState(1)
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); setPage(1) }
  const data = useQuery({ queryKey: ['tickets', dq, status, priority, overdue, page], queryFn: () => get('/tickets', { q: dq, status, priority, overdue: overdue || undefined, page, page_size: 20, sort: overdue ? 'sla_due_at' : 'priority,-created_at' }), refetchInterval: 60_000 })
  const canCreate = me?.role === 'client' || me?.role === 'dispatcher'
  return (
    <div className="stack">
      <div className="row between"><div><h1>Заявки</h1><div className="muted small">{data.data ? `Найдено: ${data.data.total}` : ' '}</div></div>
        {canCreate && <Link className="btn primary" to="/tickets/new">Создать заявку</Link>}</div>
      <div className="card stack">
        <div className="row">
          <Button small variant={!status && !overdue ? 'primary' : undefined} onClick={() => { setSp({}); setQ('') }}>Все</Button>
          <Button small variant={overdue ? 'primary' : undefined} onClick={() => set('overdue', overdue ? '' : '1')}>⚠ Просроченные</Button>
          <Button small variant={status === 'awaiting_confirmation' ? 'primary' : undefined} onClick={() => set('status', status === 'awaiting_confirmation' ? '' : 'awaiting_confirmation')}>Ждут подтверждения</Button>
        </div>
        <div className="row">
          <div style={{ flex: 1, minWidth: 220 }}><Field label="Поиск"><input type="search" placeholder="Номер, тема, инв. номер" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
          <div style={{ minWidth: 180 }}><Field label="Статус"><select value={status} onChange={(e) => set('status', e.target.value)}><option value="">Все</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field></div>
          <div style={{ minWidth: 160 }}><Field label="Приоритет"><select value={priority} onChange={(e) => set('priority', e.target.value)}><option value="">Все</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
        </div>
      </div>
      {data.isLoading ? <div className="card"><Skeleton lines={6} /></div> : data.error ? <ErrorBox error={data.error} retry={() => data.refetch()} /> : !data.data.items.length ? (
        <div className="card"><Empty title="Заявок не найдено" text={canCreate ? 'Создайте первую заявку или измените фильтры.' : 'Измените фильтры.'} action={canCreate ? <Link className="btn primary" to="/tickets/new">Создать заявку</Link> : undefined} /></div>
      ) : (
        <>
          <div className="card table-wrap hide-sm">
            <table><thead><tr><th>Номер</th><th>Тема</th><th>Оборудование</th><th>Статус</th><th>Приоритет</th><th>Срок</th><th>Исполнитель</th></tr></thead>
              <tbody>{data.data.items.map((t: any) => (
                <tr key={t.id}><td><Link to={`/tickets/${t.id}`}><strong>{t.number}</strong></Link><div className="small muted">{fmtDateTime(t.created_at)}</div></td><td>{t.title}<div className="small muted">{KIND[t.kind]}</div></td>
                  <td>{t.equipment.name}<div className="small muted">{t.organization.name}</div></td><td><StatusBadge status={t.status} /></td><td><PriorityBadge priority={t.priority} /></td>
                  <td><SlaChip sla={t.sla} status={t.status} /></td><td>{t.assigned_engineer?.full_name ?? '—'}</td></tr>))}</tbody></table>
          </div>
          <div className="stack" style={{ display: 'none' }} />
          <div className="stack show-sm-only">
            {data.data.items.map((t: any) => (
              <Link key={t.id} to={`/tickets/${t.id}`} className="card task show-sm"><div className="row between"><strong>{t.number}</strong><StatusBadge status={t.status} /></div><div>{t.title}</div><div className="small muted">{t.equipment.name}</div><div className="row"><PriorityBadge priority={t.priority} /><SlaChip sla={t.sla} status={t.status} /></div></Link>))}
          </div>
          <Pagination page={data.data.page} totalPages={data.data.total_pages} onPage={setPage} />
        </>
      )}
      <style>{`.show-sm, .show-sm-only { display: none } @media (max-width: 640px) { .show-sm-only { display: block } .show-sm { display: block } .hide-sm { display: none } }`}</style>
    </div>
  )
}

export function TicketNewPage() {
  const { me } = useAuth()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const key = useRef(uuid())
  const [f, setF] = useState({ equipment_id: sp.get('equipment') ?? '', title: '', description: '', urgency: 'planned', contact_name: me?.full_name ?? '', contact_phone: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<any>(null)
  const eqs = useQuery({ queryKey: ['eq-select'], queryFn: () => get('/equipment', { page_size: 100 }) })
  const active = useQuery({ queryKey: ['eq-active', f.equipment_id], enabled: !!f.equipment_id, queryFn: () => get('/tickets', { equipment_id: f.equipment_id, status: ['new', 'accepted', 'assigned', 'in_progress', 'paused', 'awaiting_confirmation'], page_size: 3 }) })
  const create = useMutation({
    mutationFn: () => post('/tickets', { ...f, contact_phone: f.contact_phone || null, contact_name: f.contact_name || null }, key.current),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ['tickets'] }); key.current = uuid(); setCreated(t); toast(`Заявка ${t.number} создана.`) },
    onError: (x) => { if (x instanceof ApiError && x.status === 422) { setErrs(x.fieldErrors()); toast('Проверьте заполнение полей.', true) } else toast(errText(x), true) },
  })
  if (created) {
    return (
      <div className="stack"><h1>Заявка {created.number} создана</h1>
        <div className="card stack"><p>Добавьте фотографии неисправности — это ускорит работу инженера (необязательно).</p>
          <Uploader ticketId={created.id} stages={['other']} defaultStage="other" allowDocs />
          <div className="row"><Button variant="primary" onClick={() => nav(`/tickets/${created.id}`)}>Готово — открыть заявку</Button></div></div></div>
    )
  }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="card stack" onSubmit={(e: FormEvent) => { e.preventDefault(); setErrs({}); create.mutate() }} noValidate>
      <h1>Новая заявка</h1>
      <Field label="Оборудование" error={errs.equipment_id}>
        <select value={f.equipment_id} onChange={set('equipment_id')} required><option value="">Выберите оборудование…</option>
          {eqs.data?.items.map((e: any) => <option key={e.id} value={e.id}>{e.name} · {e.inventory_number}{me?.role !== 'client' ? ` · ${e.site?.name}` : ''}</option>)}</select>
      </Field>
      {active.data?.items.length > 0 && <div className="banner warn" role="status">По этому оборудованию уже есть активная заявка: {active.data.items.map((t: any) => <Link key={t.id} to={`/tickets/${t.id}`}>{t.number}</Link>).reduce((a: any, b: any) => [a, ', ', b])}. Проверьте, не дублируете ли вы обращение.</div>}
      <Field label="Тема" error={errs.title} hint="Коротко: что случилось"><input value={f.title} onChange={set('title')} maxLength={120} required /></Field>
      <Field label="Описание" error={errs.description} hint="Не менее 10 символов: симптомы, когда началось, что уже пробовали"><textarea value={f.description} onChange={set('description')} maxLength={4000} required /></Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 14 }}>Срочность</legend>
        <div className="grid cols-3">{(['planned', 'urgent', 'emergency'] as const).map((u) => (
          <label key={u} className="card row" style={{ cursor: 'pointer', borderColor: f.urgency === u ? 'var(--teal-600)' : undefined, boxShadow: f.urgency === u ? 'var(--focus)' : undefined }}>
            <input type="radio" name="urgency" value={u} checked={f.urgency === u} onChange={set('urgency')} />
            <span><strong>{URGENCY[u]}</strong><div className="small muted">{u === 'planned' ? 'Можно решить в обычном порядке' : u === 'urgent' ? 'Есть риск отказа или ограничения' : 'Остановка, авария, угроза безопасности'}</div></span></label>))}</div>
        {f.urgency === 'emergency' && <div className="banner warn" style={{ marginTop: 8 }}>При угрозе жизни или пожаре немедленно звоните в экстренные службы — заявка в системе не заменяет звонок.</div>}
      </fieldset>
      <div className="grid cols-2">
        <Field label="Контактное лицо" error={errs.contact_name}><input value={f.contact_name} onChange={set('contact_name')} /></Field>
        <Field label="Телефон" error={errs.contact_phone}><input type="tel" inputMode="tel" value={f.contact_phone} onChange={set('contact_phone')} placeholder="+7 700 000 00 00" /></Field>
      </div>
      <div className="sticky-actions"><Button variant="primary" type="submit" loading={create.isPending}>Отправить заявку</Button><Button type="button" onClick={() => nav(-1)}>Отмена</Button></div>
    </form>
  )
}

// ----------------------- карточка заявки -----------------------
const TERMINAL = ['closed', 'rejected', 'cancelled']
const ACTION_LABEL: Record<string, string> = {
  accept: 'Принять', reject: 'Отклонить', assign: 'Назначить инженера', reassign: 'Переназначить', start: 'Начать работу', pause: 'Приостановить',
  resume: 'Продолжить работу', complete: 'Завершить работы', confirm: 'Подтвердить результат', return: 'Вернуть на доработку', cancel: 'Отменить заявку', priority: 'Изменить приоритет',
}

export function ActionModal({ action, t, onClose, onDone }: { action: string; t: any; onClose: () => void; onDone: (r: any) => void }) {
  const toast = useToast()
  const key = useRef(uuid())
  const eng = useQuery({ queryKey: ['engineers'], enabled: action === 'assign' || action === 'reassign', queryFn: () => get('/engineers') })
  const [v, setV] = useState<any>({ priority: t.priority, reason_code: action === 'reject' ? 'duplicate' : 'waiting_parts', rating: 5 })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value })
  const iso = (x?: string) => (x ? new Date(x).toISOString() : undefined)
  const actId = t.current_act?.id
  const build = () => {
    switch (action) {
      case 'accept': return { priority: v.priority }
      case 'reject': return { reason_code: v.reason_code, comment: v.comment ?? '' }
      case 'assign': return { engineer_id: v.engineer_id, priority: t.status === 'new' ? v.priority : undefined, scheduled_at: iso(v.scheduled_at), comment: v.comment || undefined }
      case 'reassign': return { engineer_id: v.engineer_id, reason: v.reason ?? '' }
      case 'pause': return { reason_code: v.reason_code, comment: v.comment ?? '', next_action: v.next_action ?? '', expected_resume_at: iso(v.expected_resume_at) }
      case 'resume': return { comment: v.comment || undefined }
      case 'confirm': return { act_id: actId, rating: Number(v.rating), comment: v.comment || undefined }
      case 'return': return { act_id: actId, comment: v.comment ?? '' }
      case 'cancel': return { reason: v.reason ?? '' }
      case 'priority': return { priority: v.priority, reason: v.reason ?? '' }
      default: return {}
    }
  }
  const m = useMutation({
    mutationFn: () => post(`/tickets/${t.id}/${action}`, { version: t.version, ...build() }, key.current),
    onSuccess: (r) => { toast(`${ACTION_LABEL[action]}: выполнено.`); (r.warnings ?? []).forEach((w: any) => toast(w.message)); onDone(r) },
    onError: (x) => {
      if (x instanceof ApiError && (x.code === 'VERSION_CONFLICT' || x.code === 'INVALID_TRANSITION' || x.code === 'ACT_OUTDATED')) { toast(x.message, true); onDone(null); return }
      if (x instanceof ApiError && x.status === 422) setErrs(x.fieldErrors())
      toast(errText(x), true)
    },
  })
  const PRI = <Field label="Приоритет" error={errs.priority}><select value={v.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
  const Text = (k: string, label: string, hint?: string) => <Field label={label} error={errs[k]} hint={hint}><textarea value={v[k] ?? ''} onChange={set(k)} /></Field>
  const danger = ['reject', 'cancel', 'return'].includes(action)
  return (
    <Modal title={ACTION_LABEL[action]} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate() }}>
        {action === 'accept' && <>{PRI}<p className="hint">Подтвердите приоритет — от него зависят сроки SLA.</p></>}
        {action === 'reject' && <><Field label="Причина"><select value={v.reason_code} onChange={set('reason_code')}><option value="duplicate">Дубликат заявки</option><option value="not_in_scope">Вне зоны обслуживания</option><option value="insufficient_info">Недостаточно информации</option><option value="other">Другое</option></select></Field>{Text('comment', 'Комментарий для клиента', 'Не менее 10 символов')}</>}
        {(action === 'assign' || action === 'reassign') && <>
          <Field label="Инженер" error={errs.engineer_id}><select value={v.engineer_id ?? ''} onChange={set('engineer_id')} required><option value="">Выберите…</option>
            {eng.data?.filter((e: any) => e.id !== t.assigned_engineer?.id).map((e: any) => <option key={e.id} value={e.id}>{e.full_name} — загрузка {e.load} из {e.capacity}</option>)}</select></Field>
          {action === 'assign' && t.status === 'new' && PRI}
          {action === 'assign' && <><Field label="Плановое время визита (необязательно)"><input type="datetime-local" value={v.scheduled_at ?? ''} onChange={set('scheduled_at')} /></Field>{Text('comment', 'Комментарий инженеру')}</>}
          {action === 'reassign' && Text('reason', 'Причина переназначения', 'Не менее 5 символов; клиент её не увидит')}</>}
        {action === 'start' && <p>Работа будет начата, клиенту и диспетчеру придёт уведомление. Откроется черновик отчёта.</p>}
        {action === 'pause' && <><Field label="Причина"><select value={v.reason_code} onChange={set('reason_code')}>{Object.entries(PAUSE_REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {Text('comment', 'Что произошло', 'Не менее 10 символов')}{Text('next_action', 'Следующее действие', 'Кто и что должен сделать, чтобы продолжить')}
          <Field label="Ожидаемая дата возобновления" error={errs.expected_resume_at}><input type="datetime-local" required value={v.expected_resume_at ?? ''} onChange={set('expected_resume_at')} /></Field>
          <p className="hint">Пока работа на паузе, часы SLA остановлены.</p></>}
        {action === 'resume' && Text('comment', 'Комментарий (необязательно)')}
        {action === 'confirm' && <><p>Вы подтверждаете, что работы выполнены и акт <strong>{t.current_act?.number}</strong> принят. Подтверждение в системе фиксирует ваше решение и <strong>не является электронной подписью</strong>.</p>
          <Field label="Оценка работы"><select value={v.rating} onChange={set('rating')}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>{Text('comment', 'Комментарий (необязательно)')}</>}
        {action === 'return' && <>{Text('comment', 'Что нужно доработать', 'Не менее 10 символов. Текущий акт станет неактуальным.')}</>}
        {action === 'cancel' && Text('reason', 'Причина отмены', 'Не менее 5 символов')}
        {action === 'priority' && <>{PRI}{Text('reason', 'Причина изменения', 'Не менее 5 символов; клиент её не увидит')}</>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={m.isPending}>{ACTION_LABEL[action]}</Button>
        </div>
      </form>
    </Modal>
  )
}

export function TicketDetailPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [action, setAction] = useState<string | null>(null)
  const t = useQuery({ queryKey: ['ticket', id], queryFn: () => get(`/tickets/${id}`), refetchInterval: 30_000 })
  const events = useQuery({ queryKey: ['events', id], queryFn: () => get(`/tickets/${id}/events`, { page_size: 100 }) })
  const atts = useQuery({ queryKey: ['atts', id], queryFn: () => get(`/tickets/${id}/attachments`) })
  const acts = useQuery({ queryKey: ['acts', id], queryFn: () => get(`/tickets/${id}/acts`) })
  const comments = useQuery({ queryKey: ['comments', id], queryFn: () => get(`/tickets/${id}/comments`, { page_size: 100 }) })
  const parts = useQuery({ queryKey: ['parts', id], queryFn: () => get(`/tickets/${id}/parts`) })
  const report = useQuery({ queryKey: ['report', id], enabled: !!me && me.role !== 'client', retry: false, queryFn: () => get(`/tickets/${id}/report`) })
  const refresh = () => ['ticket', 'events', 'atts', 'acts', 'comments', 'parts', 'report'].forEach((k) => qc.invalidateQueries({ queryKey: [k, id] }))
  if (t.isLoading) return <div className="card"><Skeleton lines={6} /></div>
  if (t.error) return (t.error instanceof ApiError && t.error.status === 404)
    ? <div className="card"><h1>Заявка не найдена</h1><p className="muted">Заявки не существует или она недоступна для вашей учётной записи.</p><Link to="/tickets">К списку заявок</Link></div>
    : <ErrorBox error={t.error} retry={() => t.refetch()} />
  const d = t.data
  const al: string[] = d.allowed_actions
  const photos = (atts.data ?? []).filter((a: any) => a.kind === 'photo')
  const docs = (atts.data ?? []).filter((a: any) => a.kind === 'document')
  const canUpload = !TERMINAL.includes(d.status) && (me?.role === 'dispatcher' || (me?.role === 'client' && d.status !== 'awaiting_confirmation') || (me?.role === 'engineer' && d.assigned_engineer?.id === me.id))
  const pex = report.data?.photo_exception
  return (
    <div className="stack">
      <div className="row between">
        <div>
          <div className="muted small"><Link to="/tickets">Заявки</Link> / {d.number}</div>
          <h1>{d.title}</h1>
          <div className="row"><StatusBadge status={d.status} /><PriorityBadge priority={d.priority} /><SlaChip sla={d.sla} status={d.status} /><span className="muted small">{KIND[d.kind]} · {d.number}</span></div>
        </div>
        <div className="row">
          {al.filter((a) => a !== 'edit' && a !== 'complete').map((a) => <Button key={a} variant={['accept', 'assign', 'start', 'confirm', 'resume'].includes(a) ? 'primary' : ['reject', 'cancel'].includes(a) ? 'danger' : undefined} onClick={() => setAction(a)}>{ACTION_LABEL[a]}</Button>)}
          {al.includes('complete') && <Button variant="primary" onClick={() => nav(`/tickets/${d.id}/report`)}>Отчёт и завершение</Button>}
          {d.status === 'in_progress' && me?.role === 'engineer' && !al.includes('complete') && null}
          {(d.status === 'in_progress' || d.status === 'paused' || d.status === 'assigned') && me?.role === 'engineer' && d.assigned_engineer?.id === me.id && !al.includes('complete') && <Button onClick={() => nav(`/tickets/${d.id}/report`)}>Открыть отчёт</Button>}
        </div>
      </div>
      {d.status === 'paused' && d.pause && <div className="banner warn"><strong>Работа на паузе: {PAUSE_REASON[d.pause.reason_code]}.</strong> {d.pause.comment}<div className="small">Следующее действие: {d.pause.next_action}. Ожидаемое возобновление: {fmtDateTime(d.pause.expected_resume_at)}. Часы SLA остановлены.</div></div>}
      {d.status === 'awaiting_confirmation' && me?.role === 'client' && d.current_act && <div className="banner info row between"><span>Работы завершены. Проверьте акт и подтвердите результат или верните на доработку.</span><Link className="btn sm primary" to={`/acts/${d.current_act.id}`}>Открыть акт</Link></div>}
      {pex?.status === 'requested' && me?.role === 'dispatcher' && <PhotoException ticket={d} reason={pex.reason} version={report.data.version} onDone={refresh} />}
      <div className="grid cols-2">
        <div className="stack">
          <div className="card">
            <h2>Описание</h2><p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{d.description}</p>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
              {([['Оборудование', <Link key="e" to={`/equipment/${d.equipment.id}`}>{d.equipment.name} · {d.equipment.inventory_number}</Link>], ['Организация', d.organization.name], ['Площадка', `${d.site.name}, ${d.site.address}`],
                ['Контакт', [d.contact.name, d.contact.phone].filter(Boolean).join(', ') || '—'], ['Создал', d.created_by?.full_name ?? 'Система (план ТО)'], ['Создана', fmtDateTime(d.created_at)],
                ['Исполнитель', d.assigned_engineer?.full_name ?? '—'], ['Плановый визит', d.scheduled_at ? fmtDateTime(d.scheduled_at) : '—'], ['Возвратов на доработку', d.return_count]] as [string, any][]).map(([k, val]) => (
                <div key={k} style={{ display: 'contents' }}><dt className="muted small">{k}</dt><dd style={{ margin: 0 }}>{val}</dd></div>))}
            </dl>
            {me?.role !== 'client' && d.sla.consumed_seconds !== undefined && <div className="small muted" style={{ marginTop: 8 }}>SLA: израсходовано {Math.round(d.sla.consumed_seconds / 60)} мин из {Math.round(d.sla.resolution_limit_seconds / 60)} мин. Срок реакции до {fmtDateTime(d.sla.reaction_due_at)}.</div>}
          </div>
          <div className="card">
            <h2>Фотографии и документы</h2>
            {atts.isLoading ? <Skeleton /> : !photos.length && !docs.length ? <p className="muted">Файлов пока нет.</p> : <>
              {photos.length > 0 && <div className="photos">{photos.map((a: any) => <a key={a.id} href={a.urls.download} target="_blank" rel="noreferrer" title={`${STAGE[a.stage] ?? ''} · ${fmtDateTime(a.uploaded_at)}`}><img src={a.urls.thumbnail} alt={`Фото: ${STAGE[a.stage] ?? ''}`} loading="lazy" /><div className="small muted">{STAGE[a.stage]}</div></a>)}</div>}
              {docs.map((a: any) => <div key={a.id}><a href={a.urls.download} target="_blank" rel="noreferrer">📄 {a.original_filename}</a></div>)}</>}
            {canUpload && <details style={{ marginTop: 12 }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Добавить файлы</summary><div style={{ marginTop: 8 }}><Uploader ticketId={d.id} stages={me?.role === 'client' ? ['other'] : ['before', 'during', 'after', 'other']} defaultStage={me?.role === 'client' ? 'other' : 'before'} visibilityChoice={me?.role !== 'client'} onUploaded={refresh} /></div></details>}
          </div>
          {(parts.data?.length ?? 0) > 0 && <div className="card"><h2>Использованные запчасти</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{parts.data.map((p: any) => <li key={p.id}>{p.name} ({p.sku}) — {p.quantity} {UNIT[p.unit] ?? p.unit}</li>)}</ul></div>}
          <div className="card">
            <h2>Акты</h2>
            {!acts.data?.length ? <p className="muted">Акт формируется при завершении работ.</p> : acts.data.map((a: any) => (
              <div key={a.id} className="row between"><span><Link to={`/acts/${a.id}`}><strong>{a.number}</strong></Link> · версия {a.version} <span className="small muted">{fmtDateTime(a.generated_at)}</span></span>
                <span className="badge" style={{ background: a.is_current ? '#ede9fe' : '#e5e7eb', color: a.is_current ? '#5b21b6' : '#374151' }}>{a.decision === 'confirmed' ? 'Подтверждён' : a.decision === 'returned' ? 'Неактуален — возвращён клиентом' : a.is_current ? 'Актуален' : 'Неактуален'}</span></div>))}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2>История</h2>
            {events.isLoading ? <Skeleton lines={4} /> : (
              <ol className="timeline">{events.data?.items.filter((e: any) => !['attachment_added'].includes(e.event_type)).map((e: any) => (
                <li key={e.id} className={e.visibility === 'internal' ? 'internal' : ''}>
                  <div><strong>{EVENT[e.event_type] ?? e.event_type}</strong>{e.to_status && e.event_type !== 'comment_added' && e.from_status !== e.to_status && <> → {STATUS[e.to_status]?.label}</>}{e.visibility === 'internal' && <span title="Видно только сотрудникам"> 🔒</span>}</div>
                  <div className="small muted">{fmtDateTime(e.created_at)} · {e.actor?.full_name ?? 'Система'}</div>
                  {e.event_type === 'assigned' && (e.payload?.engineer_name) && <div className="small">Инженер: {e.payload.engineer_name}</div>}
                  {e.event_type === 'reassigned' && <div className="small">{e.payload.from_name} → {e.payload.to_name}</div>}
                  {e.event_type === 'paused' && <div className="small">{PAUSE_REASON[e.payload?.reason_code]}</div>}
                  {e.event_type === 'priority_changed' && <div className="small">{PRIORITY[e.payload?.from]} → {PRIORITY[e.payload?.to]}</div>}
                  {e.comment && e.event_type !== 'comment_added' && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>«{e.comment}»</div>}
                </li>))}</ol>)}
          </div>
          <Comments ticketId={d.id} data={comments.data?.items ?? []} loading={comments.isLoading} onAdded={refresh} />
        </div>
      </div>
      {action && <ActionModal action={action} t={d} onClose={() => setAction(null)} onDone={(r) => { setAction(null); refresh(); if (r && action === 'confirm') toast('Спасибо! Заявка закрыта.') }} />}
    </div>
  )
}

function PhotoException({ ticket, reason, version, onDone }: { ticket: any; reason: string; version: number; onDone: () => void }) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const m = useMutation({ mutationFn: (decision: string) => post(`/tickets/${ticket.id}/photo-exception/decision`, { version, decision, comment: comment || undefined }), onSuccess: () => { toast('Решение сохранено.'); onDone() }, onError: (x) => toast(errText(x), true) })
  return (
    <div className="banner warn stack"><strong>Инженер запрашивает исключение по фотографиям</strong><div>«{reason}»</div>
      <Field label="Комментарий (необязательно)"><input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <div className="row"><Button variant="primary" loading={m.isPending} onClick={() => m.mutate('approved')}>Согласовать</Button><Button loading={m.isPending} onClick={() => m.mutate('rejected')}>Отклонить</Button></div></div>
  )
}

function Comments({ ticketId, data, loading, onAdded }: { ticketId: string; data: any[]; loading: boolean; onAdded: () => void }) {
  const { me } = useAuth()
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const key = useRef(uuid())
  const toast = useToast()
  const m = useMutation({
    mutationFn: () => post(`/tickets/${ticketId}/comments`, { body, visibility: me?.role === 'client' ? 'public' : internal ? 'internal' : 'public' }, key.current),
    onSuccess: () => { setBody(''); key.current = uuid(); onAdded() }, onError: (x) => toast(errText(x), true),
  })
  return (
    <div className="card stack">
      <h2>Комментарии</h2>
      {loading ? <Skeleton /> : !data.length ? <p className="muted">Комментариев пока нет.</p> : data.map((c) => (
        <div key={c.id}><div className="small muted">{c.author?.full_name} · {fmtDateTime(c.created_at)}{c.visibility === 'internal' && ' · 🔒 внутренний'}</div><div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div></div>))}
      <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) m.mutate() }} className="stack">
        <Field label="Новый комментарий"><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
        <div className="row between">{me?.role !== 'client' ? <label className="row small"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Внутренний (клиент не увидит)</label> : <span />}
          <Button type="submit" variant="primary" loading={m.isPending} disabled={!body.trim()}>Отправить</Button></div>
      </form>
    </div>
  )
}
