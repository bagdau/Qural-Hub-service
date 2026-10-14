import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, patch, post, put, uuid } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, ConfirmModal, Empty, ErrorBox, Field, Modal, Pagination, Skeleton, Tabs, errText, useDebounced, useToast } from '../components/ui'
import { fmtDateTime, ROLE, EQ_TYPE } from '../lib/format'
import { Icon } from '../components/Icon'

// ---------------- Пользователи ----------------
export function UsersPage() {
  const { me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const qc = useQueryClient()
  const toast = useToast()
  const [q, setQ] = useState(''); const dq = useDebounced(q)
  const [role, setRole] = useState(''); const [page, setPage] = useState(1)
  const [edit, setEdit] = useState<any | 'new' | null>(null)
  const [temp, setTemp] = useState<{ pw: string; email: string } | null>(null)
  const [confirm, setConfirm] = useState<{ u: any; kind: 'deactivate' | 'reset' | 'activate' } | null>(null)
  const users = useQuery({ queryKey: ['users', dq, role, page], queryFn: () => get('/users', { q: dq, role, page, page_size: 20 }) })
  const act = useMutation({
    mutationFn: async ({ u, kind }: { u: any; kind: string }) => {
      const body = { version: u.version }
      return kind === 'reset' ? post(`/users/${u.id}/reset-password`, body, uuid()) : post(`/users/${u.id}/${kind}`, body)
    },
    onSuccess: (r, { u, kind }) => {
      qc.invalidateQueries({ queryKey: ['users'] }); setConfirm(null)
      if (r.temp_password) setTemp({ pw: r.temp_password, email: u.email }); else toast('Готово.')
    },
    onError: (x) => { setConfirm(null); if (x instanceof ApiError && x.code === 'USER_HAS_ACTIVE_ASSIGNMENTS') toast(`${x.message} ${x.details.tickets.map((t: any) => t.number).join(', ')}`, true); else toast(errText(x), true) },
  })
  return (
    <div className="stack">
      <div className="row between"><h1>Пользователи</h1>{isAdmin && <Button variant="primary" onClick={() => setEdit('new')}>Создать пользователя</Button>}</div>
      <div className="card row"><div style={{ flex: 1, minWidth: 200 }}><Field label="Поиск"><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="ФИО или email" /></Field></div>
        <div style={{ minWidth: 180 }}><Field label="Роль"><select value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }}><option value="">Все</option>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div></div>
      {users.isLoading ? <div className="card"><Skeleton lines={5} /></div> : users.error ? <ErrorBox error={users.error} /> : !users.data.items.length ? <div className="card"><Empty title="Пользователей не найдено" /></div> : (
        <div className="card table-wrap"><table><thead><tr><th>ФИО</th><th>Email</th><th>Роль</th><th className="hide-sm">Организация</th><th>Статус</th>{isAdmin && <th />}</tr></thead>
          <tbody>{users.data.items.map((u: any) => (
            <tr key={u.id}><td><strong>{u.full_name}</strong></td><td>{u.email}</td><td>{ROLE[u.role]}</td><td className="hide-sm">{u.organization.name}</td>
              <td>{u.is_active ? (u.must_change_password ? 'Ждёт смены пароля' : 'Активен') : 'Деактивирован'}</td>
              {isAdmin && <td><div className="row">
                <Button small onClick={() => setEdit(u)}>Изменить</Button>
                {u.is_active ? <><Button small onClick={() => setConfirm({ u, kind: 'reset' })}>Сбросить пароль</Button><Button small onClick={() => setConfirm({ u, kind: 'deactivate' })}>Деактивировать</Button></> : <Button small onClick={() => setConfirm({ u, kind: 'activate' })}>Активировать</Button>}</div></td>}
            </tr>))}</tbody></table><Pagination page={users.data.page} totalPages={users.data.total_pages} onPage={setPage} /></div>)}
      {edit && <UserForm user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(r) => { setEdit(null); qc.invalidateQueries({ queryKey: ['users'] }); if (r?.temp_password) setTemp({ pw: r.temp_password, email: r.user.email }) }} />}
      {confirm && <ConfirmModal title={confirm.kind === 'deactivate' ? 'Деактивировать пользователя?' : confirm.kind === 'reset' ? 'Сбросить пароль?' : 'Активировать пользователя?'}
        text={confirm.kind === 'deactivate' ? `${confirm.u.full_name} потеряет доступ, все его сессии будут завершены.` : confirm.kind === 'reset' ? `Будет создан новый временный пароль для ${confirm.u.full_name}, все его сессии завершатся.` : `Для ${confirm.u.full_name} будет создан временный пароль.`}
        confirmLabel="Подтвердить" danger={confirm.kind === 'deactivate'} busy={act.isPending} onConfirm={() => act.mutate(confirm)} onClose={() => setConfirm(null)} />}
      {temp && (
        <Modal title="Временный пароль" onClose={() => setTemp(null)}>
          <div className="banner warn">Пароль показывается <strong>один раз</strong>. Передайте его пользователю безопасным способом. Он будет действовать 72 часа, при первом входе потребуется сменить его.</div>
          <p>Пользователь: <strong>{temp.email}</strong></p>
          <div className="row"><code style={{ fontSize: 20, background: '#f1f5f9', padding: '8px 12px', borderRadius: 8 }} data-testid="temp-password">{temp.pw}</code><Button onClick={() => { navigator.clipboard?.writeText(temp.pw); toast('Скопировано.') }}>Копировать</Button></div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><Button variant="primary" onClick={() => setTemp(null)}>Я передал(а) пароль</Button></div>
        </Modal>)}
    </div>
  )
}

function UserForm({ user, onClose, onSaved }: { user: any | null; onClose: () => void; onSaved: (r?: any) => void }) {
  const toast = useToast(); const key = useRef(uuid())
  const orgs = useQuery({ queryKey: ['orgs-all'], queryFn: () => get('/organizations', { page_size: 100 }) })
  const [f, setF] = useState<any>(user ? { full_name: user.full_name, phone: user.phone ?? '', role: user.role, organization_id: user.organization.id, capacity: user.capacity ?? 4, email: user.email } : { email: '', full_name: '', phone: '', role: 'client', organization_id: '', capacity: 4 })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: () => {
      const body: any = { full_name: f.full_name, phone: f.phone || null, role: f.role, organization_id: f.organization_id, capacity: f.role === 'engineer' ? Number(f.capacity) : undefined }
      return user ? patch(`/users/${user.id}`, { ...body, version: user.version }) : post('/users', { ...body, email: f.email }, key.current)
    },
    onSuccess: (r) => { toast('Сохранено.'); onSaved(user ? undefined : r) },
    onError: (x) => { if (x instanceof ApiError && (x.status === 422 || x.status === 409)) setErrs({ ...x.fieldErrors(), ...(x.code === 'DUPLICATE' ? { email: x.message } : {}) }); toast(errText(x), true) },
  })
  const service = orgs.data?.items.find((o: any) => o.kind === 'service')
  const list = orgs.data?.items.filter((o: any) => (f.role === 'client' ? o.kind === 'client' : o.kind === 'service')) ?? []
  return (
    <Modal title={user ? 'Изменить пользователя' : 'Новый пользователь'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate() }}>
        <Field label="Email" error={errs.email}><input type="email" value={f.email} onChange={set('email')} disabled={!!user} required /></Field>
        <Field label="ФИО" error={errs.full_name}><input value={f.full_name} onChange={set('full_name')} required minLength={2} /></Field>
        <Field label="Телефон" error={errs.phone}><input type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Роль" error={errs.role}><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, organization_id: e.target.value === 'client' ? '' : service?.id ?? '' })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Организация" error={errs.organization_id}><select value={f.organization_id} onChange={set('organization_id')} required><option value="">Выберите…</option>{list.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        {f.role === 'engineer' && <Field label="Максимум одновременных заявок" error={errs.capacity}><input type="number" min={1} max={20} value={f.capacity} onChange={set('capacity')} /></Field>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={onClose}>Отмена</Button><Button variant="primary" type="submit" loading={m.isPending}>{user ? 'Сохранить' : 'Создать'}</Button></div>
      </form>
    </Modal>
  )
}

// ---------------- Организации и площадки ----------------
export function OrganizationsPage() {
  const qc = useQueryClient(); const toast = useToast()
  const [org, setOrg] = useState(false); const [siteFor, setSiteFor] = useState<any>(null)
  const orgs = useQuery({ queryKey: ['orgs-admin'], queryFn: () => get('/organizations', { page_size: 100 }) })
  const sites = useQuery({ queryKey: ['sites-admin'], queryFn: () => get('/sites', { page_size: 100 }) })
  const archive = useMutation({ mutationFn: (o: any) => post(`/organizations/${o.id}/${o.archived_at ? 'unarchive' : 'archive'}`, { version: o.version }), onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs-admin'] }), onError: (x) => toast(errText(x), true) })
  return (
    <div className="stack">
      <div className="row between"><h1>Организации и площадки</h1><Button variant="primary" onClick={() => setOrg(true)}>Добавить клиента</Button></div>
      {orgs.isLoading ? <div className="card"><Skeleton /></div> : orgs.error ? <ErrorBox error={orgs.error} /> : orgs.data.items.map((o: any) => (
        <div key={o.id} className="card stack">
          <div className="row between"><div><h2 style={{ margin: 0 }}>{o.name}</h2><div className="muted small">{o.kind === 'service' ? 'Сервисная организация' : 'Клиент'}{o.archived_at && ' · в архиве'}</div></div>
            {o.kind === 'client' && <div className="row"><Button small onClick={() => setSiteFor(o)}>Добавить площадку</Button><Button small onClick={() => archive.mutate(o)}>{o.archived_at ? 'Вернуть из архива' : 'Архивировать'}</Button></div>}</div>
          {sites.data?.items.filter((s: any) => s.organization_id === o.id).map((s: any) => <div key={s.id} className="small"><Icon name="pin" size={13} /> <strong>{s.name}</strong> — {s.address}</div>)}
        </div>))}
      {org && <OrgForm onClose={() => setOrg(false)} onSaved={() => { setOrg(false); qc.invalidateQueries({ queryKey: ['orgs-admin'] }) }} />}
      {siteFor && <SiteForm org={siteFor} onClose={() => setSiteFor(null)} onSaved={() => { setSiteFor(null); qc.invalidateQueries({ queryKey: ['sites-admin'] }) }} />}
    </div>
  )
}
function OrgForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [f, setF] = useState<any>({ name: '', short_name: '', contact_email: '', contact_phone: '', address: '' }); const [errs, setErrs] = useState<Record<string, string>>({})
  const m = useMutation({ mutationFn: () => post('/organizations', Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null]))), onSuccess: onSaved, onError: (x) => { if (x instanceof ApiError) setErrs({ ...x.fieldErrors(), ...(x.code === 'DUPLICATE' ? { name: x.message } : {}) }); toast(errText(x), true) } })
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  return <Modal title="Новая клиентская организация" onClose={onClose}><form className="stack" onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate() }}>
    <Field label="Название" error={errs.name}><input value={f.name} onChange={set('name')} required /></Field><Field label="Краткое название" error={errs.short_name}><input value={f.short_name} onChange={set('short_name')} /></Field>
    <Field label="Email" error={errs.contact_email}><input type="email" value={f.contact_email} onChange={set('contact_email')} /></Field><Field label="Телефон" error={errs.contact_phone}><input value={f.contact_phone} onChange={set('contact_phone')} /></Field>
    <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={onClose}>Отмена</Button><Button variant="primary" type="submit" loading={m.isPending}>Создать</Button></div></form></Modal>
}
function SiteForm({ org, onClose, onSaved }: { org: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [f, setF] = useState({ name: '', address: '' }); const [errs, setErrs] = useState<Record<string, string>>({})
  const m = useMutation({ mutationFn: () => post('/sites', { organization_id: org.id, ...f }), onSuccess: onSaved, onError: (x) => { if (x instanceof ApiError) setErrs({ ...x.fieldErrors(), ...(x.code === 'DUPLICATE' ? { name: x.message } : {}) }); toast(errText(x), true) } })
  return <Modal title={`Новая площадка: ${org.name}`} onClose={onClose}><form className="stack" onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate() }}>
    <Field label="Название" error={errs.name}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field><Field label="Адрес" error={errs.address}><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required /></Field>
    <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={onClose}>Отмена</Button><Button variant="primary" type="submit" loading={m.isPending}>Создать</Button></div></form></Modal>
}

// ---------------- Запчасти ----------------
const UNITS: Record<string, string> = { pcs: 'шт', l: 'л', kg: 'кг', m: 'м', set: 'компл.' }
export function SparePartsPage() {
  const qc = useQueryClient(); const toast = useToast()
  const [add, setAdd] = useState(false); const [f, setF] = useState({ sku: '', name: '', unit: 'pcs', category: '' }); const [errs, setErrs] = useState<Record<string, string>>({})
  const q = useQuery({ queryKey: ['spare-parts'], queryFn: () => get('/spare-parts', { page_size: 100 }) })
  const create = useMutation({ mutationFn: () => post('/spare-parts', { ...f, category: f.category || null }), onSuccess: () => { setAdd(false); setF({ sku: '', name: '', unit: 'pcs', category: '' }); qc.invalidateQueries({ queryKey: ['spare-parts'] }); toast('Позиция добавлена.') }, onError: (x) => { if (x instanceof ApiError) setErrs({ ...x.fieldErrors(), ...(x.code === 'DUPLICATE' ? { sku: x.message } : {}) }); toast(errText(x), true) } })
  const toggle = useMutation({ mutationFn: (p: any) => patch(`/spare-parts/${p.id}`, { version: p.version, is_active: !p.is_active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['spare-parts'] }), onError: (x) => toast(errText(x), true) })
  return (
    <div className="stack">
      <div className="row between"><div><h1>Справочник запчастей</h1><div className="muted small">Фиксируется только использованное при ремонте. Остатки, закупки и резервирование не ведутся.</div></div><Button variant="primary" onClick={() => { setErrs({}); setAdd(true) }}>Добавить позицию</Button></div>
      {q.isLoading ? <div className="card"><Skeleton /></div> : q.error ? <ErrorBox error={q.error} /> : (
        <div className="card table-wrap"><table><thead><tr><th>Артикул</th><th>Название</th><th>Ед.</th><th>Статус</th><th /></tr></thead>
          <tbody>{q.data.items.map((p: any) => <tr key={p.id}><td className="mono">{p.sku}</td><td>{p.name}</td><td>{UNITS[p.unit]}</td><td>{p.is_active ? 'Активна' : 'Отключена'}</td><td><Button small onClick={() => toggle.mutate(p)}>{p.is_active ? 'Отключить' : 'Включить'}</Button></td></tr>)}</tbody></table></div>)}
      {add && <Modal title="Новая позиция" onClose={() => setAdd(false)}><form className="stack" onSubmit={(e) => { e.preventDefault(); setErrs({}); create.mutate() }}>
        <Field label="Артикул" error={errs.sku}><input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} required /></Field><Field label="Название" error={errs.name}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Единица"><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={() => setAdd(false)}>Отмена</Button><Button variant="primary" type="submit" loading={create.isPending}>Добавить</Button></div></form></Modal>}
    </div>
  )
}

// ---------------- Чек-листы ----------------
export function ChecklistsPage() {
  const { me } = useAuth(); const qc = useQueryClient(); const toast = useToast()
  const [view, setView] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['templates'], queryFn: () => get('/checklist-templates') })
  const detail = useQuery({ queryKey: ['template', view], enabled: !!view, queryFn: () => get(`/checklist-templates/${view}`) })
  const nv = useMutation({ mutationFn: (id: string) => post(`/checklist-templates/${id}/new-version`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast('Создан черновик новой версии.') }, onError: (x) => toast(errText(x), true) })
  const pub = useMutation({ mutationFn: (id: string) => post(`/checklist-templates/${id}/publish`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast('Версия опубликована.') }, onError: (x) => toast(errText(x), true) })
  const st: Record<string, string> = { draft: 'Черновик', active: 'Активна', retired: 'Выведена' }
  return (
    <div className="stack">
      <h1>Шаблоны чек-листов</h1>
      <div className="muted small">Опубликованные версии не изменяются. Заявка привязывается к версии, активной на момент начала работ.</div>
      {list.isLoading ? <div className="card"><Skeleton /></div> : list.error ? <ErrorBox error={list.error} /> : (
        <div className="card table-wrap"><table><thead><tr><th>Шаблон</th><th>Тип</th><th>Версия</th><th>Статус</th><th>Публикация</th><th /></tr></thead>
          <tbody>{list.data.map((t: any) => <tr key={t.id}><td>{t.title}<div className="small muted">{t.code}</div></td><td>{EQ_TYPE[t.equipment_type]}</td><td>{t.version}</td><td>{st[t.status]}</td><td>{fmtDateTime(t.published_at)}</td>
            <td><div className="row"><Button small onClick={() => setView(t.id)}>Пункты</Button>{me?.role === 'admin' && (t.status === 'draft' ? <Button small variant="primary" onClick={() => pub.mutate(t.id)}>Опубликовать</Button> : <Button small onClick={() => nv.mutate(t.id)}>Новая версия</Button>)}</div></td></tr>)}</tbody></table></div>)}
      {view && <Modal title="Пункты шаблона" onClose={() => setView(null)} wide>{detail.isLoading ? <Skeleton /> : detail.data && (
        <ol>{detail.data.schema.items.map((i: any) => <li key={i.key}>{i.label} <span className="muted small">[{i.type}{i.unit ? `, ${i.unit}` : ''}{i.required ? ', обязательно' : ''}]</span></li>)}</ol>)}</Modal>}
    </div>
  )
}

// ---------------- SLA ----------------
export function SlaPage() {
  const { me } = useAuth(); const qc = useQueryClient(); const toast = useToast()
  const q = useQuery({ queryKey: ['sla'], queryFn: () => get('/settings/sla') })
  const [rows, setRows] = useState<any[] | null>(null)
  const data = rows ?? q.data
  const names: Record<string, string> = { critical: 'Критический', high: 'Высокий', normal: 'Обычный', low: 'Низкий' }
  const save = useMutation({ mutationFn: () => put('/settings/sla', { items: data!.map((r: any) => ({ priority: r.priority, reaction_minutes: Number(r.reaction_minutes), resolution_minutes: Number(r.resolution_minutes) })) }), onSuccess: () => { toast('Настройки сохранены. Они применяются к новым заявкам.'); setRows(null); qc.invalidateQueries({ queryKey: ['sla'] }) }, onError: (x) => toast(errText(x), true) })
  return (
    <div className="stack">
      <h1>Настройки SLA</h1>
      <div className="banner info">Демонстрационные значения для согласования с компанией. Время календарное (24/7), часы SLA останавливаются на паузе и в ожидании подтверждения клиента. Изменение действует на новые заявки.</div>
      {q.isLoading ? <div className="card"><Skeleton /></div> : q.error ? <ErrorBox error={q.error} /> : (
        <div className="card table-wrap"><table><thead><tr><th>Приоритет</th><th>Реакция, мин</th><th>Выполнение, мин</th><th>Выполнение, ч</th></tr></thead>
          <tbody>{data!.map((r: any, i: number) => <tr key={r.priority}><td>{names[r.priority]}</td>
            <td><input className="input" type="number" min={1} disabled={me?.role !== 'admin'} value={r.reaction_minutes} onChange={(e) => setRows(data!.map((x: any, j: number) => (j === i ? { ...x, reaction_minutes: e.target.value } : x)))} aria-label={`Реакция: ${names[r.priority]}`} /></td>
            <td><input className="input" type="number" min={1} disabled={me?.role !== 'admin'} value={r.resolution_minutes} onChange={(e) => setRows(data!.map((x: any, j: number) => (j === i ? { ...x, resolution_minutes: e.target.value } : x)))} aria-label={`Выполнение: ${names[r.priority]}`} /></td>
            <td className="mono">{(Number(r.resolution_minutes) / 60).toFixed(1)}</td></tr>)}</tbody></table>
          {me?.role === 'admin' && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button variant="primary" disabled={!rows} loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Button></div>}</div>)}
    </div>
  )
}

// ---------------- Аудит ----------------
export function AuditPage() {
  const [page, setPage] = useState(1); const [action, setAction] = useState('')
  const q = useQuery({ queryKey: ['audit', page, action], queryFn: () => get('/audit-log', { page, page_size: 30, action }) })
  return (
    <div className="stack">
      <h1>Журнал аудита</h1>
      <div className="card"><Field label="Действие (код)"><input value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} placeholder="login_failed, user_created, access_denied…" /></Field></div>
      {q.isLoading ? <div className="card"><Skeleton /></div> : q.error ? <ErrorBox error={q.error} /> : !q.data.items.length ? <div className="card"><Empty title="Записей нет" /></div> : (
        <div className="card table-wrap"><table><thead><tr><th>Время</th><th>Действие</th><th>Роль</th><th>Объект</th><th>IP</th></tr></thead>
          <tbody>{q.data.items.map((r: any) => <tr key={r.id}><td>{fmtDateTime(r.occurred_at)}</td><td className="mono">{r.action}</td><td>{r.actor_role ?? '—'}</td><td className="small">{r.object_type ?? ''} {r.object_id?.slice(0, 8) ?? ''}</td><td className="small">{r.ip}</td></tr>)}</tbody></table>
          <Pagination page={q.data.page} totalPages={q.data.total_pages} onPage={setPage} /></div>)}
    </div>
  )
}
