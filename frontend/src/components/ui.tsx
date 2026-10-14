import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { PRIORITY, PRIORITY_COLOR, STATUS, slaText } from '../lib/format'
import { Icon } from './Icon'

// ---------- toasts ----------
type Toast = { id: number; text: string; err?: boolean }
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, err?: boolean) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, text, err }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), err ? 7000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.requestId && e.status >= 500 ? `${e.message} (код: ${e.requestId.slice(0, 8)})` : e.message
  return 'Не удалось выполнить действие.'
}

// ---------- базовые ----------
export function Button({ variant, small, loading, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost'; small?: boolean; loading?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || loading} className={`btn ${variant ?? ''} ${small ? 'sm' : ''} ${p.className ?? ''}`}>
      {loading ? 'Подождите…' : children}
    </button>
  )
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  const id = useRef('f' + Math.random().toString(36).slice(2)).current
  const child = React.isValidElement(children) ? React.cloneElement(children as any, { id, 'aria-invalid': !!error, 'aria-describedby': error ? id + 'e' : undefined, className: `input ${error ? 'invalid' : ''}` }) : children
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span id={id + 'e'} className="err" role="alert">{error}</span>}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input,select,textarea,[tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus() }
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={wide ? { width: 'min(760px,100%)' } : undefined}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, icon: '', bg: '#eee', fg: '#333' }
  return <span className="badge" style={{ background: s.bg, color: s.fg }}><Icon name={s.icon} size={13} />{s.label}</span>
}
export function PriorityBadge({ priority }: { priority: string }) {
  return <span className="badge" style={{ background: '#fff', border: `1px solid ${PRIORITY_COLOR[priority]}`, color: PRIORITY_COLOR[priority] }}>{PRIORITY[priority] ?? priority}</span>
}
export function SlaChip({ sla, status }: { sla: any; status: string }) {
  const { text, bad } = slaText(sla, status)
  if (!text) return null
  return <span className="badge" style={{ background: bad ? 'var(--danger-bg)' : '#f1f5f9', color: bad ? '#b42318' : 'var(--text-muted)' }}>{bad && <Icon name="alert" size={13} />}{text}</span>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="stack" aria-busy="true" aria-label="Загрузка">{Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>
}
export function Empty({ icon = 'inbox', title, text, action }: { icon?: string; title: string; text?: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="ico" aria-hidden><Icon name={icon} size={36} /></div><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error instanceof ApiError ? error : null
  return (
    <div className="banner err" role="alert">
      <strong>{errText(error)}</strong>
      {e?.requestId && <div className="small">Код запроса: {e.requestId}</div>}
      {retry && <div style={{ marginTop: 8 }}><Button small onClick={retry}>Повторить</Button></div>}
    </div>
  )
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
      <Button small disabled={page <= 1} onClick={() => onPage(page - 1)}>← Назад</Button>
      <span className="muted small">Страница {page} из {totalPages}</span>
      <Button small disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Вперёд →</Button>
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: [string, string][]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={active === k} className={`tab ${active === k ? 'active' : ''}`} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  )
}

export function ConfirmModal({ title, text, confirmLabel, danger, onConfirm, onClose, busy }: { title: string; text: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{text}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onClose} autoFocus>Отмена</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false)
    window.addEventListener('online', a); window.addEventListener('offline', b)
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b) }
  }, [])
  return on
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
