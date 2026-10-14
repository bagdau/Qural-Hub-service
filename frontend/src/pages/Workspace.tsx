import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, uuid } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, ErrorBox, Skeleton, errText, useToast } from '../components/ui'
import { STATUS } from '../lib/format'
import { Drawer } from '../board/Drawer'
import { Kanban } from '../board/Kanban'
import { LiveIndicator, LiveProvider, useLive } from '../board/live'
import { QuickCreate } from '../board/QuickCreate'
import { CalendarView, GanttView, ListView } from '../board/Views'
import { ActionModal } from './Tickets'
import { Icon } from '../components/Icon'
import {
  COLUMNS, DEFAULT_WS, EMPTY_FILTERS, PRIORITY_TITLE, applyFilters, loadWorkspace, matchesQuery, saveWorkspace, columnOf, type ColumnId, type Drop, type Filters, type ViewId, type Workspace as WS,
} from '../board/boardLib'

const VIEW_COLOR: Record<string, string> = { kanban: '#0d7a5f', list: '#2563eb', calendar: '#d97706', gantt: '#7c3aed' }
const VIEWS: [ViewId, string, string][] = [['kanban', 'Канбан', 'board'], ['list', 'Список', 'list'], ['calendar', 'Календарь', 'calendar'], ['gantt', 'Шкала SLA', 'gantt']]

function MultiSelect({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  return (
    <div className="ms" ref={ref}>
      <button className={`btn sm ${value.length ? 'active' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>{label}{value.length ? ` · ${value.length}` : ''} ▾</button>
      {open && (
        <div className="ms-pop" role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.map(([k, l]) => (
            <label key={k} className="ms-opt"><input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} /> {l}</label>))}
          {!options.length && <div className="small muted" style={{ padding: 8 }}>Нет вариантов</div>}
          {value.length > 0 && <button className="btn sm ghost" onClick={() => onChange([])}>Сбросить</button>}
        </div>)}
    </div>
  )
}

function SearchBox({ tickets, value, onChange, onPick }: { tickets: any[]; value: string; onChange: (v: string) => void; onPick: (id: string) => void }) {
  const [focus, setFocus] = useState(false)
  const [idx, setIdx] = useState(0)
  const sugg = useMemo(() => (value.trim().length >= 2 ? tickets.filter((t) => matchesQuery(t, value)).slice(0, 8) : []), [tickets, value])
  useEffect(() => setIdx(0), [value])
  return (
    <div className="search" role="combobox" aria-expanded={focus && sugg.length > 0} aria-haspopup="listbox">
      <input type="search" value={value} placeholder="Поиск: SR-2026-0017, оборудование, клиент…" aria-label="Поиск заявок" aria-autocomplete="list"
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, sugg.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && sugg[idx]) { e.preventDefault(); onPick(sugg[idx].id); setFocus(false) }
        }} />
      {focus && sugg.length > 0 && (
        <ul className="sugg" role="listbox">
          {sugg.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === idx} className={i === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); onPick(t.id); setFocus(false) }}>
              <b>{t.number}</b> {t.title}<div className="small muted">{t.organization.name} · {t.equipment.name}</div>
            </li>))}
        </ul>)}
    </div>
  )
}

function WorkspaceInner() {
  const { me } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { markLocal } = useLive()
  const [sp, setSp] = useSearchParams()
  const uid = me!.id
  const [ws, setWs] = useState<WS>(() => loadWorkspace(uid))
  const [create, setCreate] = useState<ColumnId | null>(null)
  const [modal, setModal] = useState<{ action: string; t: any } | null>(null)
  const selected = sp.get('t')
  useEffect(() => saveWorkspace(uid, ws), [uid, ws])

  const board = useQuery({
    queryKey: ['board'],
    queryFn: async () => {
      let page = 1, all: any[] = [], total = 1
      do {
        const r = await get('/tickets', { page, page_size: 100, sort: '-created_at' })
        all = all.concat(r.items); total = r.total_pages; page++
      } while (page <= total && page <= 10)
      return all
    },
    refetchInterval: 60_000,
  })
  const tickets: any[] = board.data ?? []
  const filtered = useMemo(() => applyFilters(tickets, ws.filters), [tickets, ws.filters])
  const engineers = useMemo(() => {
    const m = new Map<string, string>()
    tickets.forEach((t) => t.assigned_engineer && m.set(t.assigned_engineer.id, t.assigned_engineer.full_name))
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [tickets])
  const setF = (patch: Partial<Filters>) => setWs((w) => ({ ...w, filters: { ...w.filters, ...patch } }))
  const open = useCallback((id: string) => { const n = new URLSearchParams(sp); n.set('t', id); setSp(n, { replace: false }) }, [sp, setSp])
  const close = useCallback(() => { const n = new URLSearchParams(sp); n.delete('t'); setSp(n, { replace: true }) }, [sp, setSp])
  const activeFilters = ws.filters.statuses.length + ws.filters.priorities.length + ws.filters.engineers.length + (ws.filters.from ? 1 : 0) + (ws.filters.to ? 1 : 0) + (ws.filters.q ? 1 : 0)
  const canCreate = me!.role === 'client' || me!.role === 'dispatcher'

  const move = async (t: any, target: ColumnId, d: Drop) => {
    if (d.kind === 'noop') return
    if (d.kind === 'deny') { toast(d.reason, true); return }
    if (d.kind === 'navigate') { toast('Завершение работ — через отчёт инженера.'); nav(d.to); return }
    if (d.kind === 'modal') { setModal({ action: d.action, t }); return }
    // прямое действие: оптимистично двигаем карточку, при ошибке откатываем
    const prev = qc.getQueryData<any[]>(['board'])
    qc.setQueryData<any[]>(['board'], (old) => (old ?? []).map((x) => (x.id === t.id ? { ...x, status: d.to } : x)))
    markLocal(t.id)
    try {
      await post(`/tickets/${t.id}/${d.action}`, { version: t.version }, uuid())
      toast(d.action === 'start' ? `${t.number}: работа начата.` : `${t.number}: работа продолжена.`)
    } catch (e) {
      qc.setQueryData(['board'], prev)
      toast(errText(e), true)
    } finally {
      qc.invalidateQueries({ queryKey: ['board'] })
      qc.invalidateQueries({ queryKey: ['ticket', t.id] })
    }
  }
  const canAddFor = (c: ColumnId) => {
    if (!canCreate) return { enabled: false, hint: 'Создавать заявки могут клиент и диспетчер' }
    if (c === 'new') return { enabled: true, hint: 'Создать заявку' }
    if (c === 'assigned') return me!.role === 'dispatcher' ? { enabled: true, hint: 'Создать заявку и сразу назначить инженера' } : { enabled: false, hint: 'Назначать инженера может диспетчер' }
    if (c === 'in_progress') return { enabled: false, hint: 'В работу заявку переводит назначенный инженер' }
    if (c === 'waiting') return { enabled: false, hint: 'На паузу переводят из «В работе»' }
    return { enabled: false, hint: 'Заявку закрывает клиент после завершения работ' }
  }
  const warnTotal = filtered.filter((t) => t.sla?.is_overdue).length

  return (
    <div className={`workspace ${ws.density}`} data-density={ws.density}>
      <div className="wsbar">
        <div className="seg" role="tablist" aria-label="Представление">
          {VIEWS.map(([id, label, icon]) => <button key={id} role="tab" aria-selected={ws.view === id} className={ws.view === id ? 'on' : ''} onClick={() => setWs({ ...ws, view: id })}><Icon name={icon} size={16} color={VIEW_COLOR[id]} /> {label}</button>)}
        </div>
        <div className="wsright">
          <LiveIndicator />
          <button className="btn sm" onClick={() => setWs({ ...ws, density: ws.density === 'compact' ? 'standard' : 'compact' })} aria-pressed={ws.density === 'compact'} title="Плотность интерфейса">{ws.density === 'compact' ? <><Icon name="compact" size={16} /> Компактно</> : <><Icon name="standard" size={16} /> Стандарт</>}</button>
          {canCreate && <Button variant="primary" onClick={() => setCreate('new')}>+ Создать заявку</Button>}
        </div>
      </div>
      <div className="wsfilters">
        <SearchBox tickets={tickets} value={ws.filters.q} onChange={(q) => setF({ q })} onPick={open} />
        <MultiSelect label="Статусы" options={Object.entries(STATUS).map(([k, v]) => [k, v.label])} value={ws.filters.statuses} onChange={(statuses) => setF({ statuses })} />
        <MultiSelect label="Приоритеты" options={Object.entries(PRIORITY_TITLE).map(([k, v]) => [k, v])} value={ws.filters.priorities} onChange={(priorities) => setF({ priorities })} />
        {me!.role !== 'engineer' && <MultiSelect label="Инженеры" options={[['none', 'Не назначен'], ...engineers]} value={ws.filters.engineers} onChange={(engineers) => setF({ engineers })} />}
        <label className="dt"><span className="sr-only">Создана с</span><input type="date" value={ws.filters.from} onChange={(e) => setF({ from: e.target.value })} aria-label="Создана с" /></label>
        <span className="muted">—</span>
        <label className="dt"><span className="sr-only">Создана по</span><input type="date" value={ws.filters.to} onChange={(e) => setF({ to: e.target.value })} aria-label="Создана по" /></label>
        {activeFilters > 0 && <button className="btn sm ghost" onClick={() => setWs({ ...ws, filters: EMPTY_FILTERS })}>✕ Сбросить ({activeFilters})</button>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{filtered.length} из {tickets.length}{warnTotal > 0 && <> · <span style={{ color: 'var(--danger)' }}><Icon name="alert" size={13} /> просрочено: {warnTotal}</span></>}</span>
      </div>
      {board.isLoading ? <div className="card"><Skeleton lines={6} /></div> : board.error ? <ErrorBox error={board.error} retry={() => board.refetch()} /> : (
        <div className={`wsmain ${selected ? 'withdrawer' : ''}`}>
          {ws.view === 'kanban' && <Kanban tickets={filtered} onOpen={open} onDrop={move} onAdd={setCreate} selectedId={selected} canAddFor={canAddFor} />}
          {ws.view === 'list' && <ListView tickets={filtered} onOpen={open} selectedId={selected} />}
          {ws.view === 'calendar' && <CalendarView tickets={filtered} onOpen={open} />}
          {ws.view === 'gantt' && <GanttView tickets={filtered} onOpen={open} />}
        </div>
      )}
      {selected && <Drawer id={selected} allTickets={tickets} onClose={close} onOpen={open} />}
      {create && <QuickCreate column={create} onClose={() => setCreate(null)} onCreated={(id) => { setCreate(null); open(id) }} />}
      {modal && <ActionModal action={modal.action} t={modal.t} onClose={() => setModal(null)} onDone={() => { markLocal(modal.t.id); setModal(null); qc.invalidateQueries({ queryKey: ['board'] }); qc.invalidateQueries({ queryKey: ['ticket', modal.t.id] }) }} />}
    </div>
  )
}

export function WorkspacePage() {
  return <LiveProvider><WorkspaceInner /></LiveProvider>
}
