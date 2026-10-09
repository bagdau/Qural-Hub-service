import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { PRIORITY_COLOR } from '../lib/format'
import { COLUMNS, avatarColor, columnOf, initials, resolveDrop, slaView, sortForBoard, useNow, PRIORITY_TITLE, type ColumnId, type Drop } from './boardLib'
import { useLive } from './live'

export function SlaBadge({ t, now }: { t: any; now: number }) {
  const v = slaView(t, now)
  if (!v.text) return null
  return <span className={`sla ${v.tone}`}><span aria-hidden>{v.tone === 'bad' ? '⚠' : v.tone === 'warn' ? '⏱' : v.tone === 'ok' ? '⏱' : '⏸'}</span>{v.text}</span>
}

export function PriorityPill({ p }: { p: string }) {
  return <span className="prio" style={{ ['--c' as any]: PRIORITY_COLOR[p] }}>{PRIORITY_TITLE[p] ?? p}</span>
}

export function TicketCard({ t, now, onOpen, overlay, selected }: { t: any; now: number; onOpen?: (id: string) => void; overlay?: boolean; selected?: boolean }) {
  const { flashed } = useLive()
  const v = slaView(t, now)
  const cl = t.checklist
  return (
    <div className={`kcard ${v.pulse ? 'pulse' : ''} ${flashed.has(t.id) ? 'flash' : ''} ${overlay ? 'overlay' : ''} ${selected ? 'selected' : ''}`} data-testid={`card-${t.number}`} data-status={t.status}>
      <div className="row between" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <a className="kcard-num" href={`?t=${t.id}`} onClick={(e) => { e.preventDefault(); onOpen?.(t.id) }} onPointerDown={(e) => e.stopPropagation()}>{t.number}</a>
        <PriorityPill p={t.priority} />
      </div>
      <div className="kcard-title">{t.title}</div>
      <div className="kcard-meta">
        <div title={t.equipment.name}>⚡ {t.equipment.name}{t.equipment.model ? <span className="muted"> · {t.equipment.model}</span> : null}</div>
        <div className="muted">🏢 {t.organization.name}</div>
        <div className="muted">📍 {t.site.name}</div>
      </div>
      <SlaBadge t={t} now={now} />
      <div className="kcard-foot">
        {t.assigned_engineer
          ? <span className="who" title={t.assigned_engineer.full_name}><i style={{ background: avatarColor(t.assigned_engineer.id) }} aria-hidden>{initials(t.assigned_engineer.full_name)}</i>{t.assigned_engineer.full_name}</span>
          : <span className="who muted">Не назначен</span>}
        <span className="counters">
          {cl && cl.total > 0 && <span title="Чек-лист" className={cl.done === cl.total ? 'done' : ''}>☑ {cl.done}/{cl.total}</span>}
          {t.parts_count > 0 && <span title="Запчасти">🔩 {t.parts_count}</span>}
          {t.comments_count > 0 && <span title="Комментарии">💬 {t.comments_count}</span>}
        </span>
      </div>
    </div>
  )
}

function DraggableCard({ t, now, onOpen, selected }: { t: any; now: number; onOpen: (id: string) => void; selected: boolean }) {
  const movable = t.allowed_actions.some((a: string) => ['accept', 'assign', 'reassign', 'start', 'pause', 'resume', 'complete', 'confirm', 'return', 'cancel'].includes(a))
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: t.id, disabled: !movable, data: { t } })
  return (
    <div ref={setNodeRef} {...(movable ? listeners : {})} {...attributes} role="group" tabIndex={-1} className={`kwrap ${isDragging ? 'dragging' : ''} ${movable ? 'movable' : ''}`}
      onClick={() => onOpen(t.id)} aria-label={`Заявка ${t.number}: ${t.title}`}>
      <TicketCard t={t} now={now} onOpen={onOpen} selected={selected} />
    </div>
  )
}

function Column({ col, items, now, onOpen, onAdd, state, selectedId, canAdd }: {
  col: (typeof COLUMNS)[number]; items: any[]; now: number; onOpen: (id: string) => void; onAdd: (c: ColumnId) => void
  state: 'idle' | 'valid' | 'invalid' | 'over'; selectedId: string | null; canAdd: { enabled: boolean; hint: string }
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id })
  const warnings = items.filter((t) => { const v = slaView(t, now); return v.tone === 'bad' || v.tone === 'warn' }).length
  const st = state === 'valid' && isOver ? 'over' : state
  return (
    <section className={`kcol ${st}`} ref={setNodeRef} aria-label={col.title} data-testid={`col-${col.id}`}>
      <header style={{ ['--a' as any]: col.accent }}>
        <div className="row between" style={{ flexWrap: 'nowrap' }}>
          <h2><span className="dot" aria-hidden />{col.title}</h2>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {warnings > 0 && <span className="warnbadge" title="Заявок с SLA под угрозой или просрочкой">⚠ {warnings}</span>}
            <span className="count" aria-label={`Заявок: ${items.length}`}>{items.length}</span>
            <button className="addbtn" onClick={() => onAdd(col.id)} disabled={!canAdd.enabled} title={canAdd.hint} aria-label={`Создать заявку: ${col.title}`}>+</button>
          </div>
        </div>
        <div className="small muted">{col.hint}</div>
      </header>
      <div className="kcol-body">
        {items.map((t) => <DraggableCard key={t.id} t={t} now={now} onOpen={onOpen} selected={selectedId === t.id} />)}
        {!items.length && <div className="kempty">Нет заявок</div>}
      </div>
    </section>
  )
}

export function Kanban({ tickets, onOpen, onDrop, onAdd, selectedId, canAddFor }: {
  tickets: any[]; onOpen: (id: string) => void; onDrop: (t: any, target: ColumnId, d: Drop) => void; onAdd: (c: ColumnId) => void
  selectedId: string | null; canAddFor: (c: ColumnId) => { enabled: boolean; hint: string }
}) {
  const now = useNow()
  const [active, setActive] = useState<any | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )
  const byCol = useMemo(() => {
    const m: Record<string, any[]> = {}
    COLUMNS.forEach((c) => (m[c.id] = []))
    ;[...tickets].sort(sortForBoard).forEach((t) => m[columnOf(t.status)].push(t))
    return m
  }, [tickets])
  const targets = useMemo(() => {
    if (!active) return null
    const r: Record<string, boolean> = {}
    COLUMNS.forEach((c) => { const d = resolveDrop(active, c.id); r[c.id] = d.kind !== 'deny' && d.kind !== 'noop' })
    return r
  }, [active])
  const start = (e: DragStartEvent) => setActive((e.active.data.current as any).t)
  const end = (e: DragEndEvent) => {
    const t = active
    setActive(null)
    if (!t || !e.over) return
    const target = e.over.id as ColumnId
    onDrop(t, target, resolveDrop(t, target))
  }
  return (
    <DndContext sensors={sensors} onDragStart={start} onDragEnd={end} onDragCancel={() => setActive(null)}>
      <div className="kanban" role="group" aria-label="Канбан-доска заявок">
        {COLUMNS.map((c) => (
          <Column key={c.id} col={c} items={byCol[c.id]} now={now} onOpen={onOpen} onAdd={onAdd} selectedId={selectedId} canAdd={canAddFor(c.id)}
            state={!targets ? 'idle' : columnOf(active.status) === c.id ? 'idle' : targets[c.id] ? 'valid' : 'invalid'} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160 }}>{active ? <TicketCard t={active} now={now} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}
