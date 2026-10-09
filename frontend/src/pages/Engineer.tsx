import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, del, get, post, put, uuid } from '../api/client'
import { Uploader } from '../components/Uploader'
import { Button, Empty, ErrorBox, Field, Modal, PriorityBadge, Skeleton, SlaChip, StatusBadge, errText, useOnline, useToast } from '../components/ui'
import { fmtDateTime, PAUSE_REASON } from '../lib/format'

const GROUPS: [string, string][] = [['today', 'Сегодня'], ['upcoming', 'Ближайшие'], ['paused', 'На паузе'], ['awaiting', 'Ожидают подтверждения клиента'], ['done', 'Завершённые']]

export function MyTasksPage() {
  const q = useQuery({ queryKey: ['my-tasks'], queryFn: () => get('/me/tasks'), refetchInterval: 60_000 })
  const [open, setOpen] = useState<Record<string, boolean>>({ done: false })
  return (
    <div className="stack">
      <div className="row between"><h1>Мои задания</h1><Link className="btn" to="/scan">▣ Сканер QR</Link></div>
      {q.isLoading ? <div className="card"><Skeleton lines={4} /></div> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (
        <>
          {Object.values<any[]>(q.data).every((g) => !g.length) && <div className="card"><Empty icon="🛠" title="У вас пока нет заданий" text="Когда диспетчер назначит заявку, она появится здесь." /></div>}
          {GROUPS.map(([k, label]) => {
            const items: any[] = q.data[k] ?? []
            if (!items.length) return null
            const collapsed = open[k] === false
            return (
              <section key={k} aria-label={label}>
                <button className="btn ghost" style={{ padding: 0 }} onClick={() => setOpen({ ...open, [k]: collapsed })} aria-expanded={!collapsed}><h2 style={{ margin: 0 }}>{collapsed ? '▸' : '▾'} {label} ({items.length})</h2></button>
                {!collapsed && <div style={{ marginTop: 8 }}>{items.map((t) => (
                  <Link key={t.id} to={`/tickets/${t.id}`} className="card task stack">
                    <div className="row between"><strong>{t.number}</strong><StatusBadge status={t.status} /></div>
                    <div><strong>{t.title}</strong></div>
                    <div className="small muted">⚡ {t.equipment.name} · {t.equipment.inventory_number}<br />📍 {t.site.name}, {t.site.address}{t.scheduled_at && <><br />🕒 Визит: {fmtDateTime(t.scheduled_at)}</>}</div>
                    <div className="row"><PriorityBadge priority={t.priority} /><SlaChip sla={t.sla} status={t.status} />{t.work_stage && <span className="badge" style={{ background: '#f1f5f9' }}>{t.work_stage === 'diagnostics' ? 'Диагностика' : t.work_stage === 'repair' ? 'Выполнение работ' : 'Готово к завершению'}</span>}</div>
                  </Link>))}</div>}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}

const STEPS = ['Диагностика', 'Чек-лист', 'Работы', 'Запчасти', 'Фото', 'Проверка']

function draftKey(id: string) { return `ash-report-${id}` }

export function ReportPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const online = useOnline()
  const [step, setStep] = useState(0)
  const t = useQuery({ queryKey: ['ticket', id], queryFn: () => get(`/tickets/${id}`) })
  const r = useQuery({ queryKey: ['report', id], retry: false, queryFn: () => get(`/tickets/${id}/report`) })
  const [local, setLocal] = useState<any>(null)
  const [state, setState] = useState<'saved' | 'saving' | 'dirty' | 'offline'>('saved')
  const version = useRef(0)
  const timer = useRef<any>(null)
  const [failed, setFailed] = useState<any[] | null>(null)
  const [pause, setPause] = useState(false)
  const [pex, setPex] = useState(false)
  const completeKey = useRef(uuid())

  useEffect(() => {
    if (r.data && !local) {
      version.current = r.data.version
      let d = pick(r.data)
      try { const raw = localStorage.getItem(draftKey(id!)); if (raw) { const s = JSON.parse(raw); if (s.base === r.data.version) { d = { ...d, ...s.data }; setState('dirty') } } } catch { /* ignore */ }
      setLocal(d)
    }
  }, [r.data, local, id])

  const editable = r.data?.status === 'draft' && t.data?.allowed_actions && ['in_progress', 'paused', 'assigned'].includes(t.data.status)

  const flush = async (data = local) => {
    if (!data) return
    setState('saving')
    try {
      const res = await put(`/tickets/${id}/report`, { ...data, version: version.current })
      version.current = res.version
      localStorage.removeItem(draftKey(id!))
      qc.setQueryData(['report', id], res)
      setState('saved')
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) { setState('offline'); localStorage.setItem(draftKey(id!), JSON.stringify({ base: version.current, data })) }
      else if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') { toast('Отчёт изменён на другом устройстве. Данные обновлены.', true); setLocal(null); localStorage.removeItem(draftKey(id!)); r.refetch() }
      else { setState('dirty'); toast(errText(e), true) }
    }
  }
  const change = (patch: any) => {
    const next = { ...local, ...patch }
    setLocal(next); setState('dirty')
    try { localStorage.setItem(draftKey(id!), JSON.stringify({ base: version.current, data: next })) } catch { /* ignore */ }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(next), 1500)
  }
  useEffect(() => { if (online && state === 'offline' && local) flush() }, [online]) // eslint-disable-line

  const check = useQuery({ queryKey: ['check', id, state], enabled: step === 5 && state === 'saved', queryFn: () => get(`/tickets/${id}/report/completion-check`) })
  const complete = useMutation({
    mutationFn: () => post(`/tickets/${id}/complete`, { version: t.data.version }, completeKey.current),
    onSuccess: () => { toast('Работы завершены, акт сформирован.'); ['ticket', 'report', 'my-tasks', 'acts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); nav(`/tickets/${id}`) },
    onError: (x) => {
      if (x instanceof ApiError && x.code === 'COMPLETION_REQUIREMENTS_NOT_MET') setFailed(x.details.failed_checks)
      else toast(errText(x), true)
    },
  })

  if (t.isLoading || r.isLoading) return <div className="card"><Skeleton lines={5} /></div>
  if (r.error) return <div className="stack"><ErrorBox error={r.error} /><Link to={`/tickets/${id}`}>К заявке</Link></div>
  if (!local) return null
  const rep = r.data
  const tpl = rep.template
  const items: any[] = tpl.schema.items
  const sections = Array.from(new Set(items.map((i) => i.section ?? '')))
  const ans = local.checklist_answers ?? {}
  const setAns = (key: string, patch: any) => change({ checklist_answers: { ...ans, [key]: { ...(ans[key] ?? {}), ...patch } } })
  const badges: Record<string, string> = { saved: '✔ Сохранено', saving: 'Сохранение…', dirty: 'Не сохранено', offline: '⚠ Нет сети — черновик сохранён на устройстве' }
  const failedCodes = (failed ?? check.data?.failed_checks ?? []) as any[]

  return (
    <div className="stack">
      <div className="row between"><div><div className="muted small"><Link to={`/tickets/${id}`}>{t.data.number}</Link> / отчёт · ревизия {rep.revision}</div><h1>{t.data.title}</h1></div><span className="badge" style={{ background: state === 'saved' ? 'var(--ok-bg)' : 'var(--warn-bg)', color: state === 'saved' ? 'var(--ok)' : 'var(--warn)' }} aria-live="polite">{badges[state]}</span></div>
      {!editable && <div className="banner info">Отчёт доступен только для просмотра.</div>}
      <div className="steps" role="tablist">{STEPS.map((s, i) => <button key={s} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setStep(i)} role="tab" aria-selected={i === step}>{i + 1}. {s}</button>)}</div>
      <fieldset disabled={!editable} style={{ border: 0, margin: 0, minWidth: 0 }} className="card stack">
        {step === 0 && <>
          <h2>Диагностика</h2>
          <Field label="Результаты диагностики" hint="Не менее 20 символов: что обнаружено и причина"><textarea value={local.diagnosis} onChange={(e) => change({ diagnosis: e.target.value })} /></Field>
        </>}
        {step === 1 && <>
          <h2>Чек-лист: {tpl.title} <span className="muted small">(версия {tpl.version})</span></h2>
          {sections.map((sec) => (
            <div key={sec} className="stack"><h3>{sec}</h3>
              {items.filter((i) => (i.section ?? '') === sec).map((i) => {
                const a = ans[i.key] ?? {}
                const flagged = flagOf(i, a.value)
                return (
                  <div key={i.key} className="card" style={{ borderColor: flagged ? 'var(--danger)' : undefined }}>
                    <div><strong>{i.label}</strong>{i.required && <span className="err"> *</span>}{i.unit && <span className="muted"> ({i.unit})</span>}</div>
                    {i.type === 'boolean' && <div className="row" role="radiogroup" aria-label={i.label}>
                      <Button small variant={a.value === true ? 'primary' : undefined} aria-pressed={a.value === true} onClick={() => setAns(i.key, { value: true })}>Норма</Button>
                      <Button small variant={a.value === false ? 'danger' : undefined} aria-pressed={a.value === false} onClick={() => setAns(i.key, { value: false })}>Не норма</Button></div>}
                    {i.type === 'number' && <input className="input" type="number" inputMode="decimal" step="any" min={i.min} max={i.max} value={a.value ?? ''} onChange={(e) => setAns(i.key, { value: e.target.value === '' ? null : Number(e.target.value) })} aria-label={i.label} />}
                    {i.type === 'enum' && <select className="input" value={a.value ?? ''} onChange={(e) => setAns(i.key, { value: e.target.value || null })} aria-label={i.label}><option value="">Выберите…</option>{i.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
                    {i.type === 'text' && <textarea className="input" value={a.value ?? ''} onChange={(e) => setAns(i.key, { value: e.target.value })} aria-label={i.label} />}
                    {i.type !== 'text' && (flagged || a.comment) && <div style={{ marginTop: 8 }}><input className="input" placeholder={flagged ? 'Комментарий обязателен для значения «не норма»' : 'Комментарий'} value={a.comment ?? ''} onChange={(e) => setAns(i.key, { comment: e.target.value })} aria-label={`Комментарий: ${i.label}`} /></div>}
                  </div>)
              })}</div>))}
        </>}
        {step === 2 && <>
          <h2>Выполненные работы и результат</h2>
          <Field label="Выполненные работы" hint="Не менее 20 символов"><textarea value={local.work_performed} onChange={(e) => change({ work_performed: e.target.value })} /></Field>
          <Field label="Результат"><select value={local.result_code ?? ''} onChange={(e) => change({ result_code: e.target.value || null })}><option value="">Выберите…</option><option value="resolved">Неисправность устранена</option><option value="resolved_with_remarks">Устранена с замечаниями</option></select></Field>
          <Field label="Итог для клиента" hint="Не менее 10 символов"><input value={local.result_summary} onChange={(e) => change({ result_summary: e.target.value })} /></Field>
          {local.result_code === 'resolved_with_remarks' && <Field label="Рекомендации" hint="Обязательно при «с замечаниями» (≥ 10 символов)"><textarea value={local.recommendations} onChange={(e) => change({ recommendations: e.target.value })} /></Field>}
          <Field label="Трудозатраты, мин"><input type="number" min={0} value={local.labor_minutes ?? ''} onChange={(e) => change({ labor_minutes: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        </>}
        {step === 3 && <PartsStep id={id!} rep={rep} editable={!!editable} confirmed={local.parts_confirmed} onConfirm={(v: boolean) => change({ parts_confirmed: v })} onChanged={() => r.refetch()} />}
        {step === 4 && <>
          <h2>Фотографии</h2>
          <p className="muted" style={{ marginTop: 0 }}>Нужно хотя бы одно фото «до» и одно «после» либо согласованное исключение.</p>
          <PhotoSummary id={id!} />
          {editable && <Uploader ticketId={id!} onUploaded={() => { qc.invalidateQueries({ queryKey: ['atts', id] }); qc.invalidateQueries({ queryKey: ['check', id] }); qc.invalidateQueries({ queryKey: ['photo-sum', id] }) }} />}
          {editable && <div className="banner info stack">
            <strong>Съёмка невозможна?</strong>
            {rep.photo_exception.status === 'none' || rep.photo_exception.status === 'rejected'
              ? <><span>{rep.photo_exception.status === 'rejected' ? `Исключение отклонено: ${rep.photo_exception.comment ?? ''}` : 'Запросите согласованное исключение у диспетчера.'}</span><div><Button onClick={() => setPex(true)}>Запросить исключение</Button></div></>
              : rep.photo_exception.status === 'requested' ? <span>Запрос отправлен диспетчеру, ожидайте решения.</span> : <span style={{ color: 'var(--ok)' }}>✔ Исключение согласовано: {rep.photo_exception.reason}</span>}</div>}
        </>}
        {step === 5 && <>
          <h2>Проверка и завершение</h2>
          {state !== 'saved' && <div className="banner warn">Идёт сохранение черновика… <Button small onClick={() => flush()}>Сохранить сейчас</Button></div>}
          {check.isLoading && state === 'saved' && <Skeleton />}
          {state === 'saved' && check.data && (check.data.ok && !failed ? <div className="banner ok">Все обязательные условия выполнены. Можно завершать работы.</div> : (
            <div className="banner err" role="alert"><strong>Не выполнено:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{failedCodes.map((f) => <li key={f.code}>{f.message}{f.keys && <span className="small"> ({f.keys.map((k: string) => items.find((i) => i.key === k)?.label ?? k).join(', ')})</span>}</li>)}</ul></div>))}
          {failed && <div className="banner err" role="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{failed.map((f) => <li key={f.code}>{f.message}</li>)}</ul></div>}
        </>}
      </fieldset>
      <div className="sticky-actions">
        <Button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Назад</Button>
        {step < 5 ? <Button variant="primary" onClick={() => setStep(step + 1)}>Далее →</Button> : editable && <Button variant="primary" disabled={!online || state !== 'saved' || !check.data?.ok} loading={complete.isPending} onClick={() => { setFailed(null); complete.mutate() }}>Завершить работы</Button>}
        {editable && t.data.status === 'in_progress' && <Button onClick={() => setPause(true)}>⏸ Приостановить</Button>}
        {!online && <span className="err">Нет сети: завершение недоступно</span>}
      </div>
      {pause && <PauseModal t={t.data} onClose={() => setPause(false)} onDone={() => { setPause(false); ['ticket', 'my-tasks'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); nav(`/tickets/${id}`) }} />}
      {pex && <PexModal id={id!} version={rep.version} onClose={() => setPex(false)} onDone={() => { setPex(false); r.refetch() }} />}
    </div>
  )
}

const pick = (r: any) => ({ diagnosis: r.diagnosis ?? '', work_performed: r.work_performed ?? '', result_code: r.result_code, result_summary: r.result_summary ?? '', recommendations: r.recommendations ?? '', labor_minutes: r.labor_minutes, checklist_answers: r.checklist_answers ?? {}, parts_confirmed: r.parts_confirmed })

export function flagOf(i: any, v: any) {
  if (v === null || v === undefined || v === '') return false
  const c = i.flag_if
  if (c) {
    if ('equals' in c && v === c.equals) return true
    if ('gt' in c && Number(v) > c.gt) return true
    if ('lt' in c && Number(v) < c.lt) return true
    if ('in' in c && c.in.includes(v)) return true
  }
  return i.type === 'enum' && i.options.some((o: any) => o.value === v && o.flag)
}

function PhotoSummary({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['photo-sum', id], queryFn: () => get(`/tickets/${id}/attachments`, { kind: 'photo' }) })
  const by = (s: string) => q.data?.filter((a: any) => a.stage === s).length ?? 0
  return <div className="row small"><span className="badge" style={{ background: by('before') ? 'var(--ok-bg)' : '#fee2e2' }}>До: {by('before')}</span><span className="badge" style={{ background: by('after') ? 'var(--ok-bg)' : '#fee2e2' }}>После: {by('after')}</span><span className="badge" style={{ background: '#f1f5f9' }}>Всего: {q.data?.length ?? 0}</span></div>
}

function PartsStep({ id, rep, editable, confirmed, onConfirm, onChanged }: any) {
  const [part, setPart] = useState(''); const [qty, setQty] = useState('1')
  const toast = useToast()
  const cat = useQuery({ queryKey: ['catalog'], queryFn: () => get('/spare-parts', { page_size: 100 }) })
  const add = useMutation({ mutationFn: () => post(`/tickets/${id}/parts`, { spare_part_id: part, quantity: Number(qty) }), onSuccess: () => { setPart(''); setQty('1'); onChanged() }, onError: (x) => toast(errText(x), true) })
  const rm = useMutation({ mutationFn: (uid: string) => del(`/tickets/${id}/parts/${uid}`), onSuccess: onChanged })
  return (
    <>
      <h2>Использованные запчасти</h2>
      <p className="muted" style={{ marginTop: 0 }}>Фиксируется только то, что использовано при ремонте. Остатки и закупки не ведутся.</p>
      {!rep.parts.length ? <Empty icon="🔩" title="Запчасти не добавлены" /> : rep.parts.map((p: any) => <div key={p.id} className="row between"><span>{p.name} · {p.sku} — <strong>{p.quantity} {p.unit}</strong></span>{editable && <Button small onClick={() => rm.mutate(p.id)}>Удалить</Button>}</div>)}
      {editable && <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}><Field label="Позиция справочника"><select value={part} onChange={(e) => setPart(e.target.value)}><option value="">Выберите…</option>{cat.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</select></Field></div>
        <div style={{ width: 110 }}><Field label="Кол-во"><input type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field></div>
        <Button onClick={() => add.mutate()} disabled={!part} loading={add.isPending}>Добавить</Button></div>}
      <label className="row"><input type="checkbox" checked={confirmed} disabled={!editable} onChange={(e) => onConfirm(e.target.checked)} /> <strong>Подтверждаю список запчастей</strong> <span className="muted small">(или запчасти не использовались)</span></label>
    </>
  )
}

function PauseModal({ t, onClose, onDone }: { t: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const key = useRef(uuid())
  const [v, setV] = useState<any>({ reason_code: 'waiting_parts' }); const [errs, setErrs] = useState<Record<string, string>>({})
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value })
  const m = useMutation({ mutationFn: () => post(`/tickets/${t.id}/pause`, { version: t.version, reason_code: v.reason_code, comment: v.comment ?? '', next_action: v.next_action ?? '', expected_resume_at: v.expected_resume_at ? new Date(v.expected_resume_at).toISOString() : undefined }, key.current),
    onSuccess: () => { toast('Работа приостановлена.'); onDone() }, onError: (x) => { if (x instanceof ApiError && x.status === 422) setErrs(x.fieldErrors()); toast(errText(x), true) } })
  return (
    <Modal title="Приостановить работу" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate() }}>
        <Field label="Причина"><select value={v.reason_code} onChange={set('reason_code')}>{Object.entries(PAUSE_REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Что произошло" error={errs.comment}><textarea value={v.comment ?? ''} onChange={set('comment')} /></Field>
        <Field label="Следующее действие" error={errs.next_action}><textarea value={v.next_action ?? ''} onChange={set('next_action')} /></Field>
        <Field label="Ожидаемая дата возобновления" error={errs.expected_resume_at}><input type="datetime-local" required value={v.expected_resume_at ?? ''} onChange={set('expected_resume_at')} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={onClose}>Отмена</Button><Button variant="primary" type="submit" loading={m.isPending}>Приостановить</Button></div>
      </form>
    </Modal>
  )
}

function PexModal({ id, version, onClose, onDone }: { id: string; version: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const key = useRef(uuid()); const [reason, setReason] = useState(''); const [err, setErr] = useState('')
  const m = useMutation({ mutationFn: () => post(`/tickets/${id}/photo-exception`, { version, reason }, key.current), onSuccess: () => { toast('Запрос отправлен диспетчеру.'); onDone() }, onError: (x) => { if (x instanceof ApiError && x.status === 422) setErr(Object.values(x.fieldErrors())[0] ?? x.message); else toast(errText(x), true) } })
  return (
    <Modal title="Исключение по фотографиям" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setErr(''); m.mutate() }}>
        <Field label="Почему нельзя сделать фото" error={err} hint="Не менее 20 символов, например: съёмка запрещена правилами площадки"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" onClick={onClose}>Отмена</Button><Button variant="primary" type="submit" loading={m.isPending}>Отправить диспетчеру</Button></div>
      </form>
    </Modal>
  )
}
