import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, get, patch, post, uuid } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, ConfirmModal, Empty, ErrorBox, Field, Modal, Pagination, Skeleton, StatusBadge, Tabs, errText, useDebounced, useToast } from '../components/ui'
import { EQ_STATE, EQ_TYPE, UNIT, fmtDate, fmtDateTime, PRIORITY } from '../lib/format'
import { Icon } from '../components/Icon'

export function EquipmentListPage() {
  const { me } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const dq = useDebounced(q)
  const [type, setType] = useState(sp.get('type') ?? '')
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<string[]>([])
  const staff = me?.role === 'admin' || me?.role === 'dispatcher'
  const data = useQuery({ queryKey: ['equipment', dq, type, page], queryFn: () => get('/equipment', { q: dq, type, page, page_size: 20 }) })
  useEffect(() => { setPage(1) }, [dq, type])
  useEffect(() => { setSp({ ...(dq ? { q: dq } : {}), ...(type ? { type } : {}) }, { replace: true }) }, [dq, type])
  return (
    <div className="stack">
      <div className="row between">
        <div><h1>Оборудование</h1><div className="muted small">Реестр единиц оборудования и цифровые паспорта</div></div>
        <div className="row">
          {staff && sel.length > 0 && <a className="btn" href={`/api/v1/equipment/qr-labels.pdf?ids=${sel.join(',')}`} target="_blank" rel="noreferrer">Печать этикеток ({sel.length})</a>}
          {staff && <Link className="btn primary" to="/equipment/new">Добавить</Link>}
        </div>
      </div>
      <div className="card row">
        <div style={{ flex: 1, minWidth: 220 }}><Field label="Поиск"><input type="search" placeholder="Название, инв. или серийный номер" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
        <div style={{ minWidth: 200 }}><Field label="Тип"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">Все</option>{Object.entries(EQ_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
      </div>
      {data.isLoading ? <div className="card"><Skeleton lines={5} /></div> : data.error ? <ErrorBox error={data.error} retry={() => data.refetch()} /> : !data.data.items.length ? (
        <div className="card"><Empty title="Оборудование не найдено" text="Измените условия поиска или попросите диспетчера добавить оборудование." /></div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr>{staff && <th />}<th>Название</th><th>Инв. №</th><th className="hide-sm">Тип</th><th className="hide-sm">Площадка</th><th>Состояние</th><th className="hide-sm">Ближайшее ТО</th><th>Заявки</th></tr></thead>
            <tbody>{data.data.items.map((e: any) => (
              <tr key={e.id}>
                {staff && <td><input type="checkbox" aria-label={`Выбрать ${e.name}`} checked={sel.includes(e.id)} onChange={(ev) => setSel(ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} /></td>}
                <td><Link to={`/equipment/${e.id}`}><strong>{e.name}</strong></Link></td><td className="mono">{e.inventory_number}</td>
                <td className="hide-sm">{e.type_label}</td><td className="hide-sm">{e.site?.name}</td><td>{EQ_STATE[e.technical_state]}</td>
                <td className="hide-sm">{e.next_due_date ? fmtDate(e.next_due_date) : '—'}</td><td>{e.active_tickets_count || '—'}</td>
              </tr>))}</tbody>
          </table>
          <Pagination page={data.data.page} totalPages={data.data.total_pages} onPage={setPage} />
        </div>
      )}
    </div>
  )
}

export function EquipmentDetailPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const [tab, setTab] = useState('overview')
  const qc = useQueryClient()
  const toast = useToast()
  const [rotate, setRotate] = useState(false)
  const e = useQuery({ queryKey: ['eq', id], queryFn: () => get(`/equipment/${id}`) })
  const mine = useQuery({ queryKey: ['eq-mine', id], enabled: me?.role === 'engineer', queryFn: () => get('/tickets', { equipment_id: id, status: ['assigned', 'in_progress', 'paused', 'awaiting_confirmation'], page_size: 5 }) })
  const rot = useMutation({ mutationFn: () => post(`/equipment/${id}/qr/rotate`, { version: e.data.version }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['eq', id] }); setRotate(false); toast('QR-код перевыпущен. Старые этикетки больше не работают.') }, onError: (x) => toast(errText(x), true) })
  if (e.isLoading) return <div className="card"><Skeleton lines={5} /></div>
  if (e.error) return <ErrorBox error={e.error} retry={() => e.refetch()} />
  const d = e.data
  const staff = me?.role === 'admin' || me?.role === 'dispatcher'
  const myTicket = mine.data?.items?.find((t: any) => t.assigned_engineer?.id === me?.id)
  return (
    <div className="stack">
      <div className="row between">
        <div><h1>{d.name}</h1><div className="muted">{d.type_label} · инв. № {d.inventory_number} · {d.organization.name}</div></div>
        <div className="row">
          {(me?.role === 'client' || me?.role === 'dispatcher') && !d.archived_at && <Link className="btn primary" to={`/tickets/new?equipment=${d.id}`}>Создать заявку</Link>}
          {staff && <Link className="btn" to={`/equipment/${d.id}/edit`}>Изменить</Link>}
        </div>
      </div>
      {myTicket && <div className="banner info row between"><span>Ваша заявка <strong>{myTicket.number}</strong>: {myTicket.title}</span><Link className="btn sm primary" to={`/tickets/${myTicket.id}`}>Открыть заявку</Link></div>}
      {d.archived_at && <div className="banner warn">Оборудование в архиве.</div>}
      <Tabs tabs={[['overview', 'Обзор'], ['history', 'История'], ['docs', 'Документы'], ['plan', 'План']]} active={tab} onChange={setTab} />
      {tab === 'overview' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Характеристики</h2>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
              {([['Состояние', EQ_STATE[d.technical_state]], ['Площадка', `${d.site.name}, ${d.site.address}`], ['Место', d.location_description ?? '—'],
                ['Производитель / модель', `${d.manufacturer ?? '—'} / ${d.model ?? '—'}`], ['Серийный №', d.serial_number ?? '—'], ['Год выпуска', d.manufacture_year ?? '—'],
                ['Ввод в эксплуатацию', fmtDate(d.commissioned_on)], ['Мощность', d.rated_power_kva ? `${d.rated_power_kva} кВА` : '—'], ['Класс напряжения', d.voltage_class_kv ? `${d.voltage_class_kv} кВ` : '—'],
                ['Ближайшее ТО', d.next_due_date ? fmtDate(d.next_due_date) : '—'], ['Последнее ТО', d.last_done_on ? fmtDate(d.last_done_on) : '—'],
                ['Активные заявки', d.active_tickets_count], ['Повторные неисправности (90 дн.)', d.repeat_failures_90d]] as [string, any][]).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}><dt className="muted small">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>))}
            </dl>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h2>QR-код паспорта</h2>
            <img src={`/api/v1/equipment/${d.id}/qr?format=svg&size=8`} alt={`QR-код оборудования ${d.name}`} width={200} height={200} />
            <div className="small muted">Код: <span className="mono">{d.qr_code}</span></div>
            <div className="small muted" style={{ wordBreak: 'break-all' }}>{d.qr_url}</div>
            {staff && <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
              <a className="btn sm" href={`/api/v1/equipment/qr-labels.pdf?ids=${d.id}`} target="_blank" rel="noreferrer">Печать этикетки</a>
              <Button small onClick={() => setRotate(true)}>Перевыпустить</Button></div>}
          </div>
        </div>
      )}
      {tab === 'history' && <History id={d.id} />}
      {tab === 'docs' && <Docs id={d.id} canEdit={staff} />}
      {tab === 'plan' && <Plans id={d.id} canEdit={staff} />}
      {rotate && <ConfirmModal title="Перевыпустить QR-код?" text="Старый код перестанет работать: напечатанные этикетки нужно будет заменить." confirmLabel="Перевыпустить" danger busy={rot.isPending} onConfirm={() => rot.mutate()} onClose={() => setRotate(false)} />}
    </div>
  )
}

function History({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const h = useQuery({ queryKey: ['eq-history', id, page], queryFn: () => get(`/equipment/${id}/history`, { page, page_size: 10 }) })
  if (h.isLoading) return <Skeleton lines={4} />
  if (h.error) return <ErrorBox error={h.error} />
  if (!h.data.items.length) return <div className="card"><Empty title="История пуста" text="Заявок по этому оборудованию ещё не было." /></div>
  return (
    <div className="stack">
      {h.data.items.map((x: any) => (
        <div className="card" key={x.ticket.id}>
          <div className="row between"><Link to={`/tickets/${x.ticket.id}`}><strong>{x.ticket.number}</strong> · {x.ticket.title}</Link><StatusBadge status={x.ticket.status} /></div>
          <div className="small muted">{fmtDateTime(x.ticket.created_at)} · {x.ticket.kind === 'planned' ? 'плановая' : 'корректирующая'} · {PRIORITY[x.ticket.priority]}</div>
          {x.diagnosis && <p style={{ margin: '8px 0 0' }}><strong>Диагностика:</strong> {x.diagnosis}</p>}
          {x.work_performed && <p style={{ margin: '4px 0 0' }}><strong>Работы:</strong> {x.work_performed}</p>}
          {x.parts.length > 0 && <p className="small" style={{ margin: '4px 0 0' }}>Запчасти: {x.parts.map((p: any) => `${p.name} — ${p.quantity} ${UNIT[p.unit] ?? p.unit}`).join('; ')}</p>}
          {x.current_act_id && <Link className="small" to={`/acts/${x.current_act_id}`}>Открыть акт</Link>}
        </div>
      ))}
      <Pagination page={h.data.page} totalPages={h.data.total_pages} onPage={setPage} />
    </div>
  )
}

function Docs({ id, canEdit }: { id: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const ref = useRef<HTMLInputElement>(null)
  const [pct, setPct] = useState<number | null>(null)
  const docs = useQuery({ queryKey: ['eq-docs', id], queryFn: () => get(`/equipment/${id}/documents`) })
  const up = async (f: File) => {
    const form = new FormData(); form.append('file', f)
    setPct(0)
    try { await api('POST', `/equipment/${id}/documents`, { form, onProgress: setPct }); toast('Документ загружен.'); qc.invalidateQueries({ queryKey: ['eq-docs', id] }) } catch (x) { toast(errText(x), true) } finally { setPct(null) }
  }
  return (
    <div className="card stack">
      {canEdit && <div><input ref={ref} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && up(e.target.files[0])} /><Button onClick={() => ref.current?.click()}>Загрузить PDF</Button>
        {pct !== null && <div className="progress" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>}</div>}
      {docs.isLoading ? <Skeleton /> : !docs.data?.length ? <Empty title="Документов нет" /> : docs.data.map((a: any) => (
        <div className="row between" key={a.id}><span><Icon name="file" size={16} /> {a.original_filename} <span className="muted small">{fmtDateTime(a.uploaded_at)}</span></span><a className="btn sm" href={a.urls.download} target="_blank" rel="noreferrer">Открыть</a></div>))}
    </div>
  )
}

function Plans({ id, canEdit }: { id: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const plans = useQuery({ queryKey: ['eq-plans', id], queryFn: () => get('/maintenance-plans', { equipment_id: id }) })
  const f = useState({ title: '', interval_days: '90', lead_days: '7', priority: 'low', next_due_date: '' })
  const [form, setForm] = f
  const [errs, setErrs] = useState<Record<string, string>>({})
  const create = useMutation({
    mutationFn: () => post('/maintenance-plans', { equipment_id: id, title: form.title, interval_days: +form.interval_days, lead_days: +form.lead_days, priority: form.priority, next_due_date: form.next_due_date }),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['eq-plans', id] }); qc.invalidateQueries({ queryKey: ['eq', id] }); toast('План создан.') },
    onError: (x) => { if (x instanceof ApiError) setErrs(x.fieldErrors()); else toast(errText(x), true) },
  })
  return (
    <div className="card stack">
      {canEdit && <div><Button onClick={() => { setErrs({}); setOpen(true) }}>Добавить план</Button></div>}
      {plans.isLoading ? <Skeleton /> : !plans.data?.items.length ? <Empty title="Планов обслуживания нет" /> : (
        <div className="table-wrap"><table><thead><tr><th>План</th><th>Интервал</th><th>Последнее</th><th>Следующее</th><th>Активен</th></tr></thead>
          <tbody>{plans.data.items.map((p: any) => <tr key={p.id}><td>{p.title}</td><td>{p.interval_days} дн.</td><td>{p.last_done_on ? fmtDate(p.last_done_on) : '—'}</td><td>{fmtDate(p.next_due_date)}</td><td>{p.is_active ? 'Да' : 'Нет'}</td></tr>)}</tbody></table></div>)}
      {open && (
        <Modal title="Новый план обслуживания" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={(ev) => { ev.preventDefault(); create.mutate() }}>
            <Field label="Название" error={errs.title}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
            <div className="grid cols-2">
              <Field label="Интервал, дней" error={errs.interval_days}><input type="number" min={1} value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} /></Field>
              <Field label="Создавать заявку за, дней" error={errs.lead_days}><input type="number" min={0} value={form.lead_days} onChange={(e) => setForm({ ...form, lead_days: e.target.value })} /></Field>
              <Field label="Приоритет"><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Первая плановая дата" error={errs.next_due_date}><input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} required /></Field>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={() => setOpen(false)}>Отмена</Button><Button variant="primary" type="submit" loading={create.isPending}>Создать</Button></div>
          </form>
        </Modal>)}
    </div>
  )
}

export function EquipmentFormPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const { me } = useAuth()
  const qc = useQueryClient()
  const orgs = useQuery({ queryKey: ['orgs-client'], queryFn: () => get('/organizations', { kind: 'client', page_size: 100 }) })
  const existing = useQuery({ queryKey: ['eq', id], enabled: !!id, queryFn: () => get(`/equipment/${id}`) })
  const [f, setF] = useState<any>({ organization_id: '', site_id: '', type: 'transformer', inventory_number: '', name: '', manufacturer: '', model: '', serial_number: '', manufacture_year: '', voltage_class_kv: '', rated_power_kva: '', technical_state: 'operational', location_description: '' })
  const [loaded, setLoaded] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const sites = useQuery({ queryKey: ['sites', f.organization_id], enabled: !!f.organization_id, queryFn: () => get('/sites', { organization_id: f.organization_id, page_size: 100 }) })
  useEffect(() => {
    if (existing.data && !loaded) { const d = existing.data; setF({ ...d, manufacture_year: d.manufacture_year ?? '', voltage_class_kv: d.voltage_class_kv ?? '', rated_power_kva: d.rated_power_kva ?? '', manufacturer: d.manufacturer ?? '', model: d.model ?? '', serial_number: d.serial_number ?? '', location_description: d.location_description ?? '' }); setLoaded(true) }
  }, [existing.data, loaded])
  const save = useMutation({
    mutationFn: () => {
      const n = (v: any) => (v === '' || v === null ? null : Number(v))
      const body: any = { site_id: f.site_id, inventory_number: f.inventory_number, name: f.name, manufacturer: f.manufacturer || null, model: f.model || null, serial_number: f.serial_number || null, manufacture_year: n(f.manufacture_year), voltage_class_kv: n(f.voltage_class_kv), rated_power_kva: n(f.rated_power_kva), technical_state: f.technical_state, location_description: f.location_description || null }
      return id ? patch(`/equipment/${id}`, { ...body, version: existing.data.version }) : post('/equipment', { ...body, organization_id: f.organization_id, type: f.type })
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['equipment'] }); toast('Сохранено.'); nav(`/equipment/${r.id}`) },
    onError: (x) => { if (x instanceof ApiError && x.status === 422) setErrs(x.fieldErrors()); else toast(errText(x), true) },
  })
  if (me && !['admin', 'dispatcher'].includes(me.role)) return <Navigate to="/equipment" replace />
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="card stack" onSubmit={(e: FormEvent) => { e.preventDefault(); setErrs({}); save.mutate() }}>
      <h1>{id ? 'Изменить оборудование' : 'Новое оборудование'}</h1>
      <div className="grid cols-2">
        <Field label="Организация" error={errs.organization_id}><select value={f.organization_id} onChange={(e) => setF({ ...f, organization_id: e.target.value, site_id: '' })} disabled={!!id} required><option value="">Выберите…</option>{orgs.data?.items.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Площадка" error={errs.site_id}><select value={f.site_id} onChange={set('site_id')} required><option value="">Выберите…</option>{sites.data?.items.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Тип" error={errs.type}><select value={f.type} onChange={set('type')} disabled={!!id}>{Object.entries(EQ_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Инвентарный номер" error={errs.inventory_number}><input value={f.inventory_number} onChange={set('inventory_number')} required maxLength={50} /></Field>
        <Field label="Название" error={errs.name}><input value={f.name} onChange={set('name')} required minLength={2} /></Field>
        <Field label="Состояние"><select value={f.technical_state} onChange={set('technical_state')}>{Object.entries(EQ_STATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Производитель"><input value={f.manufacturer} onChange={set('manufacturer')} /></Field>
        <Field label="Модель"><input value={f.model} onChange={set('model')} /></Field>
        <Field label="Серийный номер"><input value={f.serial_number} onChange={set('serial_number')} /></Field>
        <Field label="Год выпуска" error={errs.manufacture_year}><input type="number" value={f.manufacture_year} onChange={set('manufacture_year')} /></Field>
        <Field label="Мощность, кВА" error={errs.rated_power_kva} hint="Обязательно для трансформатора и подстанции"><input type="number" step="any" value={f.rated_power_kva} onChange={set('rated_power_kva')} /></Field>
        <Field label="Класс напряжения, кВ" error={errs.voltage_class_kv}><input type="number" step="any" value={f.voltage_class_kv} onChange={set('voltage_class_kv')} /></Field>
      </div>
      <Field label="Место установки"><input value={f.location_description} onChange={set('location_description')} /></Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={() => nav(-1)}>Отмена</Button><Button variant="primary" type="submit" loading={save.isPending}>Сохранить</Button></div>
    </form>
  )
}

export function QrResolverPage() {
  const { code } = useParams()
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['qr', code], queryFn: () => get(`/equipment/by-qr/${code}`), retry: false })
  useEffect(() => { if (q.data) nav(q.data.redirect, { replace: true }) }, [q.data, nav])
  if (q.isLoading) return <div className="card"><Skeleton lines={2} /><p className="muted">Открываем паспорт оборудования…</p></div>
  return (
    <div className="stack">
      <div className="banner warn" role="alert">Оборудование не найдено или недоступно для вашей учётной записи. Возможно, QR-код был перевыпущен.</div>
      <ManualSearch />
    </div>
  )
}

function ManualSearch() {
  const [v, setV] = useState('')
  const dv = useDebounced(v, 350)
  const nav = useNavigate()
  const r = useQuery({ queryKey: ['search', dv], enabled: dv.trim().length >= 2, queryFn: () => get('/search', { q: dv.trim() }) })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const code = v.trim().toUpperCase()
    if (/^[A-Z0-9]{12}$/.test(code)) { try { const x = await get(`/equipment/by-qr/${code}`); nav(x.redirect); return } catch { /* продолжаем поиск */ } }
  }
  return (
    <div className="card stack">
      <h2>Ручной поиск</h2>
      <form onSubmit={submit}><Field label="Инвентарный/серийный номер, код QR или номер заявки"><input value={v} onChange={(e) => setV(e.target.value)} placeholder="Например: DM-KTP-0002 или SR-2026-0013" autoComplete="off" /></Field></form>
      {r.data && (
        <div className="stack">
          {r.data.equipment.map((e: any) => <Link key={e.id} to={`/equipment/${e.id}`} className="btn" style={{ justifyContent: 'flex-start' }}><Icon name="equipment" size={16} /> {e.name} · {e.inventory_number}</Link>)}
          {r.data.tickets.map((t: any) => <Link key={t.id} to={`/tickets/${t.id}`} className="btn" style={{ justifyContent: 'flex-start' }}><Icon name="board" size={16} /> {t.number} · {t.title}</Link>)}
          {!r.data.equipment.length && !r.data.tickets.length && <Empty icon="search" title="Ничего не найдено" />}
        </div>)}
    </div>
  )
}

export function ScanPage() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const secure = window.isSecureContext
  const supported = 'BarcodeDetector' in window
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setOn(false) }
  useEffect(() => stop, [])
  const start = async () => {
    setMsg(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      stream.current = s; setOn(true)
      await new Promise((r) => setTimeout(r, 50))
      if (video.current) { video.current.srcObject = s; await video.current.play() }
      const det = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      const loop = async () => {
        if (!stream.current || !video.current) return
        try {
          const codes = await det.detect(video.current)
          for (const c of codes) {
            const m = String(c.rawValue).match(/\/e\/([A-Za-z0-9]{12})/)
            if (m) { navigator.vibrate?.(60); stop(); nav(`/e/${m[1].toUpperCase()}`); return }
          }
        } catch { /* кадр не готов */ }
        setTimeout(loop, 250)
      }
      loop()
    } catch { setMsg('Нет доступа к камере. Разрешите доступ в настройках браузера или воспользуйтесь ручным поиском ниже.'); stop() }
  }
  return (
    <div className="stack">
      <h1>Сканер QR-кода</h1>
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>Самый простой способ — навести <strong>штатную камеру телефона</strong> на QR-код: откроется паспорт оборудования. Встроенный сканер ниже работает только по HTTPS.</p>
        {!secure && <div className="banner warn">Страница открыта не по HTTPS — встроенный сканер недоступен. Используйте камеру телефона или ручной поиск.</div>}
        {secure && !supported && <div className="banner warn">Этот браузер не поддерживает распознавание QR. Используйте камеру телефона или ручной поиск.</div>}
        {msg && <div className="banner err" role="alert">{msg}</div>}
        {secure && supported && (on ? <><video ref={video} muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} /><Button onClick={stop}>Выключить камеру</Button></> : <Button variant="primary" onClick={start}>Включить камеру</Button>)}
      </div>
      <ManualSearch />
    </div>
  )
}
