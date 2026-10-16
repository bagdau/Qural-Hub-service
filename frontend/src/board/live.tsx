import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export type LiveState = 'connecting' | 'live' | 'offline'
interface LiveCtx { state: LiveState; flashed: Set<string>; markLocal: (id: string) => void }
const Ctx = createContext<LiveCtx>({ state: 'connecting', flashed: new Set(), markLocal: () => {} })
export const useLive = () => useContext(Ctx)

/** Подписка на SSE: при изменении заявки на сервере обновляет доску, карточку и связанные данные. */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const [state, setState] = useState<LiveState>('connecting')
  const [flashed, setFlashed] = useState<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  const timer = useRef<any>(null)
  const localIds = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (typeof EventSource === 'undefined') { setState('offline'); return }
    let es: EventSource | null = null
    let closed = false
    let retry: any
    const flush = () => {
      const ids = [...pending.current]
      pending.current.clear()
      qc.invalidateQueries({ queryKey: ['board'] })
      qc.invalidateQueries({ queryKey: ['unread'] })
      qc.invalidateQueries({ queryKey: ['map-objects'] })
      for (const id of ids) for (const k of ['ticket', 'events', 'comments', 'atts', 'acts', 'parts', 'report']) qc.invalidateQueries({ queryKey: [k, id] })
      // подсветка карточек, изменённых другими пользователями
      const now = Date.now()
      const external = ids.filter((id) => now - (localIds.current.get(id) ?? 0) > 2500)
      if (external.length) {
        setFlashed((s) => new Set([...s, ...external]))
        setTimeout(() => setFlashed((s) => { const n = new Set(s); external.forEach((i) => n.delete(i)); return n }), 3000)
      }
    }
    const connect = () => {
      if (closed) return
      es = new EventSource('/api/v1/events/stream')
      es.addEventListener('ready', () => { setState('live'); qc.invalidateQueries({ queryKey: ['board'] }) })
      es.addEventListener('ticket', (e) => {
        try { pending.current.add(JSON.parse((e as MessageEvent).data).ticket_id) } catch { return }
        clearTimeout(timer.current)
        timer.current = setTimeout(flush, 250)
      })
      es.onerror = () => {
        setState('offline')
        if (es && es.readyState === EventSource.CLOSED) { es.close(); retry = setTimeout(connect, 5000) } // сессия/сервер недоступны — пробуем позже
      }
    }
    connect()
    const onOnline = () => { es?.close(); connect() }
    window.addEventListener('online', onOnline)
    return () => { closed = true; es?.close(); clearTimeout(retry); clearTimeout(timer.current); window.removeEventListener('online', onOnline) }
  }, [qc])

  const markLocal = (id: string) => localIds.current.set(id, Date.now())
  return <Ctx.Provider value={{ state, flashed, markLocal }}>{children}</Ctx.Provider>
}

export function LiveIndicator() {
  const { state } = useLive()
  const label = state === 'live' ? 'Обновляется в реальном времени' : state === 'connecting' ? 'Подключение…' : 'Нет связи — обновление вручную'
  return (
    <span className={`live ${state}`} role="status" title={label} aria-label={label}>
      <i aria-hidden /> <span className="hide-sm">{state === 'live' ? 'Онлайн' : state === 'connecting' ? 'Подключение' : 'Офлайн'}</span>
    </span>
  )
}
