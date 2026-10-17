import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, patch, post, put, uuid } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, ConfirmModal, Empty, ErrorBox, Field, Modal, Pagination, Skeleton, Tabs, errText, useDebounced, useToast } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { Avatar } from '../components/Avatar'
import { IconButton } from '../components/IconButton'
import { PasswordFields } from '../components/PasswordFields'
import { PageHeader } from '../components/PageHeader'
import { QueryBoundary } from '../components/QueryBoundary'
import { GeoPicker, geoBody } from '../components/GeoPicker'
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
  const [pwFor, setPwFor] = useState<any | null>(null)
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
      <PageHeader title="Пользователи" actions={isAdmin && <Button variant="primary" onClick={() => setEdit('new')}>Создать пользователя</Button>} />
      <div className="card row"><div style={{ flex: 1, minWidth: 200 }}><Field label="Поиск"><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="ФИО или email" /></Field></div>
        <div style={{ minWidth: 180 }}><Field label="Роль"><select value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }}><option value="">Все</option>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div></div>
      <QueryBoundary query={users} isEmpty={(d) => !d.items.length} empty={<Empty title="Пользователей не найдено" />}>
        {(d) => (
          <DataTable rows={d.items} rowKey={(u: any) => u.id} footer={<Pagination page={d.page} totalPages={d.total_pages} onPage={setPage} />}
            columns={[
              { header: 'ФИО', cell: (u: any) => <span className="who-cell"><Avatar name={u.full_name} size={38} /><strong>{u.full_name}</strong></span> },
              { header: 'Email', cell: (u: any) => u.email },
              { header: 'Роль', cell: (u: any) => ROLE[u.role] },
              { header: 'Организация', hideSm: true, cell: (u: any) => u.organization.name },
              { header: 'Статус', cell: (u: any) => (u.is_active ? (u.must_change_password ? <span className="pill warn">Ждёт смены пароля</span> : <span className="pill ok">Активен</span>) : <span className="pill bad">Деактивирован</span>) },
              ...(isAdmin ? [{ header: 'Действия', bare: true, cell: (u: any) => (
                <div className="ibtns">
                  <IconButton icon="edit" label={`Изменить: ${u.full_name}`} onClick={() => setEdit(u)} />
                  <IconButton icon="lock" label={`Задать пароль: ${u.full_name}`} onClick={() => setPwFor(u)} />
                  {u.is_active
                    ? <><IconButton icon="key" label={`Сбросить пароль: ${u.full_name}`} onClick={() => setConfirm({ u, kind: 'reset' })} /><IconButton icon="ban" tone="danger" label={`Деактивировать: ${u.full_name}`} onClick={() => setConfirm({ u, kind: 'deactivate' })} /></>
                    : <IconButton icon="check" label={`Активировать: ${u.full_name}`} onClick={() => setConfirm({ u, kind: 'activate' })} />}
                </div>) }] : []),
            ]} />)}
      </QueryBoundary>
      {pwFor && <SetPasswordModal user={pwFor} onClose={() => setPwFor(null)} onSaved={() => { setPwFor(null); qc.invalidateQueries({ queryKey: ['users'] }) }} />}
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

/** Администратор задаёт конкретному пользователю свой пароль (каждому — разный) */
function SetPasswordModal({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [pw, setPw] = useState(''); const [must, setMust] = useState(false); const [err, setErr] = useState('')
  const m = useMutation({
    mutationFn: () => post(`/users/${user.id}/set-password`, { version: user.version, password: pw, must_change: must }),
    onSuccess: () => { toast(`Пароль для ${user.full_name} назначен. Прежние сеансы завершены.`); onSaved() },
    onError: (x) => setErr(x instanceof ApiError && x.status === 422 ? (x.fieldErrors().new_password ?? x.message) : errText(x)),
  })
  return (
    <Modal title={`Задать пароль: ${user.full_name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setErr(''); if (pw.length >= 12) m.mutate(); else setErr('Минимум 12 символов.') }}>
        <div className="small muted">{user.email}</div>
        <PasswordFields value={pw} onChange={setPw} mustChange={must} onMustChange={setMust} error={err || undefined} hint="Минимум 12 символов. Передайте пароль пользователю безопасным способом; он сразу заработает, прежние сеансы будут завершены." />
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={onClose}>Отмена</Button><Button variant="primary" type="submit" loading={m.isPending} disabled={!pw}>Назначить пароль</Button></div>
      </form>
    </Modal>
  )
}

function UserForm({ user, onClose, onSaved }: { user: any | null; onClose: () => void; onSaved: (r?: any) => void }) {
  const toast = useToast(); const key = useRef(uuid())
  const orgs = useQuery({ queryKey: ['orgs-all'], queryFn: () => get('/organizations', { page_size: 100 }) })
  const [f, setF] = useState<any>(user ? { full_name: user.full_name, phone: user.phone ?? '', role: user.role, organization_id: user.organization.id, capacity: user.capacity ?? 4, email: user.email } : { email: '', full_name: '', phone: '', role: 'client', organization_id: '', capacity: 4 })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [pw, setPw] = useState(''); const [must, setMust] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: async () => {
      const body: any = { full_name: f.full_name, phone: f.phone || null, role: f.role, organization_id: f.organization_id, capacity: f.role === 'engineer' ? Number(f.capacity) : undefined }
      if (user) {
        const r = await patch(`/users/${user.id}`, { ...body, version: user.version })
        if (pw) await post(`/users/${user.id}/set-password`, { version: r.version, password: pw, must_change: must })
        return r
      }
      return post('/users', { ...body, email: f.email, ...(pw ? { password: pw, must_change_password: must } : {}) }, key.current)
    },
    onSuccess: (r) => { toast(pw ? 'Сохранено, пароль назначен.' : 'Сохранено.'); onSaved(user ? undefined : r) },
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
        <PasswordFields label={user ? 'Новый пароль' : 'Пароль'} value={pw} onChange={setPw} mustChange={must} onMustChange={setMust} error={errs.new_password}
          hint={user ? 'Оставьте пустым, чтобы не менять. Прежние сеансы пользователя будут завершены.' : 'Оставьте пустым — система создаст временный пароль, который нужно будет сменить при первом входе.'} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={onClose}>Отмена</Button><Button variant="primary" type="submit" loading={m.isPending}>{user ? 'Сохранить' : 'Создать'}</Button></div>
      </form>
    </Modal>
  )
}

// ---------------- Организации и площадки ----------------
export function OrganizationsPage() {
  const qc = useQueryClient(); const toast = useToast()
  const [org, setOrg] = useState(false); const [siteFor, setSiteFor] = useState<any>(null); const [geoFor, setGeoFor] = useState<any | null>(null)
  const orgs = useQuery({ queryKey: ['orgs-admin'], queryFn: () => get('/organizations', { page_size: 100 }) })
  const sites = useQuery({ queryKey: ['sites-admin'], queryFn: () => get('/sites', { page_size: 100 }) })
  const archive = useMutation({ mutationFn: (o: any) => post(`/organizations/${o.id}/${o.archived_at ? 'unarchive' : 'archive'}`, { version: o.version }), onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs-admin'] }), onError: (x) => toast(errText(x), true) })
  return (
    <div className="stack">
      <PageHeader title="Организации и площадки" actions={<Button variant="primary" onClick={() => setOrg(true)}>Добавить клиента</Button>} />
      {orgs.isLoading ? <div className="card"><Skeleton /></div> : orgs.error ? <ErrorBox error={orgs.error} /> : orgs.data.items.map((o: any) => (
        <div key={o.id} className="card stack">
          <div className="row between"><div><h2 style={{ margin: 0 }}>{o.name}</h2><div className="muted small">{o.kind === 'service' ? 'Сервисная организация' : 'Клиент'}{o.archived_at && ' · в архиве'}</div></div>
            {o.kind === 'client' && <div className="row"><Button small onClick={() => setSiteFor(o)}>Добавить площадку</Button><Button small onClick={() => archive.mutate(o)}>{o.archived_at ? 'Вернуть из архива' : 'Архивировать'}</Button></div>}</div>
          {sites.data?.items.filter((s: any) => s.organization_id === o.id).map((s: any) => (
            <div key={s.id} className="row between small">
              <span><Icon name="pin" size={13} /> <strong>{s.name}</strong> — {s.address}{s.latitude != null ? <span className="muted"> · {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}</span> : <span className="err"> · нет координат</span>}</span>
              <Button small onClick={() => setGeoFor(s)}>Координаты</Button>
            </div>))}
        </div>))}
      {org && <OrgForm onClose={() => setOrg(false)} onSaved={() => { setOrg(false); qc.invalidateQueries({ queryKey: ['orgs-admin'] }) }} />}
      {geoFor && <SiteGeoForm site={geoFor} onClose={() => setGeoFor(null)} onSaved={() => { setGeoFor(null); qc.invalidateQueries({ queryKey: ['sites-admin'] }); qc.invalidateQueries({ queryKey: ['sites-map'] }) }} />}
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
function SiteGeoForm({ site, onClose, onSaved }: { site: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [geo, setGeo] = useState({ lat: site.latitude != null ? String(site.latitude) : '', lon: site.longitude != null ? String(site.longitude) : '' })
  const [err, setErr] = useState('')
  const m = useMutation({
    mutationFn: () => {
      const g = geoBody(geo)
      if (!('latitude' in g) && (geo.lat.trim() || geo.lon.trim())) throw new Error('Укажите и широту, и долготу числами.')
      return patch(`/sites/${site.id}`, { version: site.version, latitude: 'latitude' in g ? g.latitude : null, longitude: 'longitude' in g ? g.longitude : null })
    },
    onSuccess: () => { toast('Координаты сохранены.'); onSaved() },
    onError: (x) => { setErr(x instanceof Error && !(x instanceof ApiError) ? x.message : errText(x)) },
  })
  return (
    <Modal title={`Координаты: ${site.name}`} onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setErr(''); m.mutate() }}>
        <div className="small muted">{site.address}</div>
        <GeoPicker lat={geo.lat} lon={geo.lon} onChange={(lat, lon) => setGeo({ lat, lon })} />
        {err && <div className="banner err" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {(geo.lat || geo.lon) && <Button type="button" onClick={() => setGeo({ lat: '', lon: '' })}>Очистить</Button>}
          <Button type="button" onClick={onClose}>Отмена</Button>
          <Button variant="primary" type="submit" loading={m.isPending}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  )
}
function SiteForm({ org, onClose, onSaved }: { org: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [f, setF] = useState({ name: '', address: '' }); const [geo, setGeo] = useState({ lat: '', lon: '' }); const [errs, setErrs] = useState<Record<string, string>>({})
  const m = useMutation({ mutationFn: () => post('/sites', { organization_id: org.id, ...f, ...geoBody(geo) }), onSuccess: onSaved, onError: (x) => { if (x instanceof ApiError) setErrs({ ...x.fieldErrors(), ...(x.code === 'DUPLICATE' ? { name: x.message } : {}) }); toast(errText(x), true) } })
  return <Modal title={`Новая площадка: ${org.name}`} onClose={onClose} wide><form className="stack" onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate() }}>
    <Field label="Название" error={errs.name}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field><Field label="Адрес" error={errs.address}><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required /></Field>
    <GeoPicker lat={geo.lat} lon={geo.lon} onChange={(lat, lon) => setGeo({ lat, lon })} />
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
      <PageHeader title="Справочник запчастей" subtitle="Фиксируется только использованное при ремонте. Остатки, закупки и резервирование не ведутся." actions={<Button variant="primary" onClick={() => { setErrs({}); setAdd(true) }}>Добавить позицию</Button>} />
      <QueryBoundary query={q} lines={3}>
        {(d) => (
          <DataTable rows={d.items} rowKey={(p: any) => p.id} columns={[
            { header: 'Артикул', className: 'mono', cell: (p: any) => p.sku },
            { header: 'Название', cell: (p: any) => p.name },
            { header: 'Ед.', cell: (p: any) => UNITS[p.unit] },
            { header: 'Статус', cell: (p: any) => (p.is_active ? 'Активна' : 'Отключена') },
            { header: '', bare: true, cell: (p: any) => <Button small onClick={() => toggle.mutate(p)}>{p.is_active ? 'Отключить' : 'Включить'}</Button> },
          ]} />)}
      </QueryBoundary>
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
      <PageHeader title="Шаблоны чек-листов" subtitle="Опубликованные версии не изменяются. Заявка привязывается к версии, активной на момент начала работ." />
      <QueryBoundary query={list} lines={3}>
        {(items: any[]) => (
          <DataTable rows={items} rowKey={(t: any) => t.id} columns={[
            { header: 'Шаблон', cell: (t: any) => <>{t.title}<div className="small muted">{t.code}</div></> },
            { header: 'Тип', cell: (t: any) => EQ_TYPE[t.equipment_type] },
            { header: 'Версия', cell: (t: any) => t.version },
            { header: 'Статус', cell: (t: any) => st[t.status] },
            { header: 'Публикация', cell: (t: any) => fmtDateTime(t.published_at) },
            { header: '', bare: true, cell: (t: any) => (
              <div className="row"><Button small onClick={() => setView(t.id)}>Пункты</Button>{me?.role === 'admin' && (t.status === 'draft' ? <Button small variant="primary" onClick={() => pub.mutate(t.id)}>Опубликовать</Button> : <Button small onClick={() => nv.mutate(t.id)}>Новая версия</Button>)}</div>) },
          ]} />)}
      </QueryBoundary>
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
      <PageHeader title="Настройки SLA" />
      <div className="banner info">Демонстрационные значения для согласования с компанией. Время календарное (24/7), часы SLA останавливаются на паузе и в ожидании подтверждения клиента. Изменение действует на новые заявки.</div>
      <QueryBoundary query={q} lines={3}>
        {() => (
          <DataTable rows={data!} rowKey={(r: any) => r.priority}
            footer={me?.role === 'admin' && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button variant="primary" disabled={!rows} loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Button></div>}
            columns={[
              { header: 'Приоритет', cell: (r: any) => names[r.priority] },
              { header: 'Реакция, мин', cell: (r: any) => (
                <input className="input" type="number" inputMode="numeric" min={1} disabled={me?.role !== 'admin'} value={r.reaction_minutes} aria-label={`Реакция: ${names[r.priority]}`}
                  onChange={(e) => setRows(data!.map((x: any) => (x.priority === r.priority ? { ...x, reaction_minutes: e.target.value } : x)))} />) },
              { header: 'Выполнение, мин', cell: (r: any) => (
                <input className="input" type="number" inputMode="numeric" min={1} disabled={me?.role !== 'admin'} value={r.resolution_minutes} aria-label={`Выполнение: ${names[r.priority]}`}
                  onChange={(e) => setRows(data!.map((x: any) => (x.priority === r.priority ? { ...x, resolution_minutes: e.target.value } : x)))} />) },
              { header: 'Выполнение, ч', className: 'mono', cell: (r: any) => (Number(r.resolution_minutes) / 60).toFixed(1) },
            ]} />)}
      </QueryBoundary>
    </div>
  )
}

// ---------------- Аудит ----------------
export function AuditPage() {
  const [page, setPage] = useState(1); const [action, setAction] = useState('')
  const q = useQuery({ queryKey: ['audit', page, action], queryFn: () => get('/audit-log', { page, page_size: 30, action }) })
  return (
    <div className="stack">
      <PageHeader title="Журнал аудита" />
      <div className="card"><Field label="Действие (код)"><input value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} placeholder="login_failed, user_created, access_denied…" /></Field></div>
      <QueryBoundary query={q} isEmpty={(d) => !d.items.length} empty={<Empty title="Записей нет" />}>
        {(d) => (
          <DataTable rows={d.items} rowKey={(r: any) => r.id} footer={<Pagination page={d.page} totalPages={d.total_pages} onPage={setPage} />} columns={[
            { header: 'Время', cell: (r: any) => fmtDateTime(r.occurred_at) },
            { header: 'Действие', className: 'mono', cell: (r: any) => r.action },
            { header: 'Роль', cell: (r: any) => r.actor_role ?? '—' },
            { header: 'Объект', className: 'small', cell: (r: any) => `${r.object_type ?? ''} ${r.object_id?.slice(0, 8) ?? ''}` },
            { header: 'IP', className: 'small', cell: (r: any) => r.ip },
          ]} />)}
      </QueryBoundary>
    </div>
  )
}
