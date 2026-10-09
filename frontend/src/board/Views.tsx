import { useMemo, useState } from 'react'
import { fmtDateTime, STATUS } from '../lib/format'
import { nowMs } from '../api/client'
import { DAY_TZ, PRIORITY_RANK, dayKey, slaView, sortForBoard, useNow } from './boardLib'
import { PriorityPill, SlaBadge } from './Kanban'
import { Empty, StatusBadge } from '../components/ui'

// ---------------- Список ----------------
export function ListView({ tickets, onOpen, selectedId }: { tickets: any[]; onOpen: (id: string) => void; selectedId: string | null }) {
  const now = useNow()
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: 'priority', dir: 1 })
  const rows = useMemo(() => {
    const val: Record<string, (t: any) => any> = {
      number: (t) => t.number, title: (t) => t.title, client: (t) => t.organization.name, status: (t) => t.status,
      priority: (t) => PRIORITY_RANK[t.priority], created: (t) => Date.parse(t.created_at),
      sla: (t) => (t.sla.due_at ? Date.parse(t.sla.due_at) : Infinity), engineer: (t) => t.assigned_engineer?.full_name ?? '~',
    }
    const f = val[sort.k]
    return [...tickets].sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : sortForBoard(a, b)) * sort.dir)
  }, [tickets, sort])
  if (!tickets.length) return <div className="card"><Empty title="Заявок не найдено" text="Измените условия фильтра." /></div>
  const H = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <th aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="thbtn" onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : 1 })}>{children}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
    </th>
  )
  return (
    <div className="card table-wrap" style={{ padding: 0 }}>
      <table className="dense">
        <thead><tr><H k="number">Номер</H><H k="title">Тема</H><H k="client">Клиент / оборудование</H><H k="status">Статус</H><H k="priority">Приоритет</H><H k="sla">SLA</H><H k="engineer">Инженер</H><H k="created">Создана</H></tr></thead>
        <tbody>{rows.map((t) => (
          <tr key={t.id} className={`link ${selectedId === t.id ? 'sel' : ''}`} onClick={() => onOpen(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}>
            <td><strong>{t.number}</strong></td><td>{t.title}</td>
            <td>{t.organization.name}<div className="small muted">{t.equipment.name}</div></td>
            <td><StatusBadge status={t.status} /></td><td><PriorityPill p={t.priority} /></td><td><SlaBadge t={t} now={now} /></td>
            <td>{t.assigned_engineer?.full_name ?? <span className="muted">—</span>}</td><td className="small">{fmtDateTime(t.created_at)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
}

// ---------------- Календарь ----------------
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** Дата размещения заявки: плановый визит → срок SLA → дата закрытия/создания */
export function calendarDate(t: any): string {
  if (t.scheduled_at) return dayKey(t.scheduled_at)
  if (['closed', 'rejected', 'cancelled'].includes(t.status)) return dayKey(t.closed_at ?? t.updated_at ?? t.created_at)
  if (t.sla?.due_at) return dayKey(t.sla.due_at)
  return dayKey(t.created_at)
}

export function CalendarView({ tickets, onOpen }: { tickets: any[]; onOpen: (id: string) => void }) {
  const today = dayKey(nowMs())
  const [ym, setYm] = useState(() => ({ y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 }))
  const byDay = useMemo(() => {
    const m: Record<string, any[]> = {}
    tickets.forEach((t) => (m[calendarDate(t)] ??= []).push(t))
    Object.values(m).forEach((a) => a.sort(sortForBoard))
    return m
  }, [tickets])
  const first = new Date(Date.UTC(ym.y, ym.m, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate()
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
    const d = i - lead + 1
    return d < 1 || d > days ? null : `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  })
  const shift = (n: number) => setYm((s) => { const d = new Date(Date.UTC(s.y, s.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() } })
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{MONTHS[ym.m]} {ym.y}</h2>
        <div className="row"><button className="btn sm" onClick={() => shift(-1)} aria-label="Предыдущий месяц">←</button>
          <button className="btn sm" onClick={() => setYm({ y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 })}>Сегодня</button>
          <button className="btn sm" onClick={() => shift(1)} aria-label="Следующий месяц">→</button></div>
      </div>
      <div className="cal" role="grid" aria-label="Календарь заявок">
        {WD.map((d) => <div key={d} className="calh" role="columnheader">{d}</div>)}
        {cells.map((c, i) => (
          <div key={i} className={`calc ${c === today ? 'today' : ''} ${c ? '' : 'out'}`} role="gridcell">
            {c && <div className="cald">{+c.slice(8)}</div>}
            {c && (byDay[c] ?? []).slice(0, 4).map((t) => {
              const v = slaView(t)
              return <button key={t.id} className={`calchip ${v.tone}`} onClick={() => onOpen(t.id)} title={`${t.number} · ${t.title}`}><b>{t.number.slice(-4)}</b> {t.title}</button>
            })}
            {c && (byDay[c]?.length ?? 0) > 4 && <div className="small muted">+ ещё {byDay[c].length - 4}</div>}
          </div>))}
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>Заявки размещены на дате планового визита, либо срока SLA (активные), либо закрытия. Часовой пояс: {DAY_TZ}.</div>
    </div>
  )
}

// ---------------- Диаграмма Ганта / шкала SLA ----------------
const DAY = 86400000
export function GanttView({ tickets, onOpen }: { tickets: any[]; onOpen: (id: string) => void }) {
  const now = useNow(30000)
  const [span, setSpan] = useState(21)
  const [onlyActive, setOnlyActive] = useState(true)
  const start = now - span * 0.65 * DAY
  const end = now + span * 0.35 * DAY
  const px = 44 // пикселей на сутки
  const width = ((end - start) / DAY) * px
  const x = (ms: number) => Math.max(0, Math.min(width, ((ms - start) / DAY) * px))
  const rows = useMemo(() => tickets.filter((t) => !['rejected', 'cancelled'].includes(t.status) && (!onlyActive || !['closed'].includes(t.status))).sort(sortForBoard), [tickets, onlyActive])
  const ticks: number[] = []
  for (let t = Math.ceil(start / DAY) * DAY; t < end; t += DAY) ticks.push(t)
  if (!rows.length) return <div className="card"><Empty title="Нет заявок для шкалы" text="Измените фильтры или включите закрытые заявки." /></div>
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Шкала SLA</h2>
        <div className="row">
          <label className="row small"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Только активные</label>
          {[14, 21, 45].map((d) => <button key={d} className={`btn sm ${span === d ? 'primary' : ''}`} onClick={() => setSpan(d)}>{d} дн.</button>)}
        </div>
      </div>
      <div className="gantt">
        <div className="gnames">
          <div className="gh">Заявка</div>
          {rows.map((t) => <button key={t.id} className="gname" onClick={() => onOpen(t.id)} title={t.title}><b>{t.number}</b> {t.title}</button>)}
        </div>
        <div className="gscroll">
          <div style={{ width, position: 'relative' }}>
            <div className="gh gaxis">{ticks.map((tk) => <span key={tk} style={{ left: x(tk) }}>{new Date(tk).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: DAY_TZ })}</span>)}</div>
            {ticks.map((tk) => <i key={tk} className="gtick" style={{ left: x(tk) }} />)}
            <i className="gnow" style={{ left: x(now) }} title="Сейчас" />
            {rows.map((t) => {
              const created = Date.parse(t.created_at)
              const finished = t.closed_at ? Date.parse(t.closed_at) : t.completed_at && t.status === 'awaiting_confirmation' ? Date.parse(t.completed_at) : now
              const due = t.sla.due_at ? Date.parse(t.sla.due_at) : null
              const v = slaView(t, now)
              const barEnd = Math.min(finished, now)
              return (
                <div className="grow" key={t.id} onClick={() => onOpen(t.id)}>
                  <span className={`gbar ${v.tone}`} style={{ left: x(created), width: Math.max(4, x(barEnd) - x(created)) }} title={`${t.number}: создана ${fmtDateTime(t.created_at)}`} />
                  {due && due > now && <span className="gbudget" style={{ left: x(now), width: Math.max(2, x(due) - x(now)) }} title={`Осталось до срока SLA: до ${fmtDateTime(t.sla.due_at)}`} />}
                  {due && <i className={`gdue ${due < now ? 'late' : ''}`} style={{ left: x(due) }} title={`Срок SLA: ${fmtDateTime(t.sla.due_at)}`} />}
                  {!due && ['paused', 'awaiting_confirmation'].includes(t.status) && <span className="gstop" style={{ left: x(now), width: 18 }} title="Часы SLA остановлены">⏸</span>}
                  <span className="glabel" style={{ left: x(Math.max(created, start)) + 4 }}>{STATUS[t.status]?.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="small muted row" style={{ marginTop: 8 }}>
        <span><i className="lg ok" /> в пределах срока</span><span><i className="lg warn" /> срок поджимает</span><span><i className="lg bad" /> просрочено</span><span><i className="lg idle" /> часы остановлены</span><span>▏ срок SLA · линия «сейчас»</span>
      </div>
    </div>
  )
}
