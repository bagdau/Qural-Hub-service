import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, Empty, ErrorBox, Field, Skeleton, useDebounced } from '../components/ui'
import { Icon } from '../components/Icon'

const LAYOUT_HINT: Record<string, string> = {
  label100x70: 'Одна этикетка 100×70 мм (термопринтер, наклейка на шкаф)',
  sticker50x30: 'Малая наклейка 50×30 мм (на приборы и ячейки)',
  sheet8: 'Лист A4: 8 этикеток для обычного принтера',
}

/** Страница QR одной единицы оборудования: просмотр, печать (диалог браузера), PDF, PNG, SVG. */
export function EquipmentQrPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const [layout, setLayout] = useState('label100x70')
  const [ec, setEc] = useState('q')
  useEffect(() => { document.body.classList.add('qr-bare'); return () => document.body.classList.remove('qr-bare') }, [])
  const eq = useQuery({ queryKey: ['eq', id], queryFn: () => get(`/equipment/${id}`) })
  const layouts = useQuery({ queryKey: ['qr-layouts'], queryFn: () => get('/equipment/qr-layouts') })
  if (eq.isLoading) return <div className="card"><Skeleton lines={5} /></div>
  if (eq.error) return <ErrorBox error={eq.error} retry={() => eq.refetch()} />
  const d = eq.data
  const base = `/api/v1/equipment/${d.id}`
  const qrSrc = `${base}/qr?format=svg&size=20&ec=${ec}`
  return (
    <div className="stack qrpage">
      <div className="row between no-print">
        <div>
          <div className="muted small"><Link to="/equipment">Оборудование</Link> / <Link to={`/equipment/${d.id}`}>{d.name}</Link> / QR-код</div>
          <h1>QR-код оборудования</h1>
        </div>
        <div className="row">
          <Button variant="primary" onClick={() => window.print()}><Icon name="print" size={18} /> Печать</Button>
          <a className="btn" href={`${base}/qr-label.pdf?layout=${layout}&download=1`}><Icon name="download" size={18} /> Сохранить PDF</a>
        </div>
      </div>
      <div className="grid cols-2 qr-grid">
        <div className="card print-sheet" data-testid="print-sheet">
          <div className="ps-head"><Icon name="equipment" size={20} color="#5eead4" /><span>ОБОРУДОВАНИЕ</span><small>Qural Hub</small></div>
          <div className="ps-body">
            <img className="qr-big" src={qrSrc} alt={`QR-код: ${d.name}, инвентарный номер ${d.inventory_number}`} />
            <div className="qr-meta">
              <div className="qr-short">{d.short_name}</div>
              <div className="qr-full">{d.full_name}</div>
              <dl className="qr-fields">
                <dt>Инвентарный номер</dt><dd className="qr-inv">{d.inventory_number}</dd>
                <dt>Местоположение</dt><dd>{d.site.name}, {d.site.address}</dd>
                <dt>Имя завода</dt><dd>{d.organization.name}</dd>
              </dl>
            </div>
          </div>
          <div className="ps-foot">При неисправностях отсканируйте QR-код и создайте заявку</div>
        </div>
        <div className="stack no-print">
          <div className="card stack">
            <h2>Печать и экспорт</h2>
            <Field label="Формат этикетки (PDF)" hint={LAYOUT_HINT[layout]}>
              <select value={layout} onChange={(e) => setLayout(e.target.value)}>
                {(layouts.data ?? [{ id: 'label100x70', title: 'Одна этикетка 100×70 мм' }]).map((l: any) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            </Field>
            <Field label="Коррекция ошибок" hint="H — для уличных, загрязняющихся этикеток: код читается даже с повреждениями до 30%">
              <select value={ec} onChange={(e) => setEc(e.target.value)}>
                <option value="m">M — стандартная (15%)</option><option value="q">Q — повышенная (25%)</option><option value="h">H — максимальная (30%)</option>
              </select>
            </Field>
            <div className="row">
              <a className="btn" href={`${base}/qr-label.pdf?layout=${layout}`} target="_blank" rel="noreferrer"><Icon name="file" size={18} /> Открыть PDF</a>
              <a className="btn" href={`${base}/qr?format=png&size=20&ec=${ec}&download=1`}><Icon name="image" size={18} /> PNG</a>
              <a className="btn" href={`${base}/qr?format=svg&size=20&ec=${ec}&download=1`}><Icon name="image" size={18} /> SVG</a>
              <a className="btn" href={`${base}/passport.pdf?download=1`}><Icon name="audit" size={18} /> Паспорт PDF</a>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Кнопка «Печать» открывает стандартный диалог печати браузера — там же можно выбрать «Сохранить как PDF». На печать выводится только этикетка слева.</p>
          </div>
          {(me?.role === 'admin' || me?.role === 'dispatcher') && <Link className="btn" to={`/generator?ids=${d.id}`}>Открыть в генераторе QR и документов</Link>}
        </div>
      </div>
    </div>
  )
}

/** Генератор QR и документов: пакетная печать этикеток и паспортов с предпросмотром. */
export function GeneratorPage() {
  const initial = useMemo(() => new URLSearchParams(window.location.search).get('ids')?.split(',').filter(Boolean) ?? [], [])
  const [sel, setSel] = useState<string[]>(initial)
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [layout, setLayout] = useState('sheet8')
  const frame = useRef<HTMLIFrameElement>(null)
  const list = useQuery({ queryKey: ['gen-eq', dq], queryFn: () => get('/equipment', { q: dq, page_size: 100 }) })
  const layouts = useQuery({ queryKey: ['qr-layouts'], queryFn: () => get('/equipment/qr-layouts') })
  const items: any[] = list.data?.items ?? []
  const url = sel.length ? `/api/v1/equipment/qr-labels.pdf?ids=${sel.join(',')}&layout=${layout}` : null
  useEffect(() => { if (sel.length > 48) setSel(sel.slice(0, 48)) }, [sel])
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const printFrame = () => { try { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print() } catch { if (url) window.open(url, '_blank') } }
  return (
    <div className="stack">
      <div><h1>Генератор QR и документов</h1><div className="muted small">Выберите оборудование — система сформирует этикетки с QR-кодами и паспорта в PDF.</div></div>
      <div className="grid cols-2 gen-grid">
        <div className="card stack">
          <Field label="Поиск оборудования"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, инвентарный или серийный номер" /></Field>
          <div className="row between small">
            <span>Выбрано: <b data-testid="gen-count">{sel.length}</b> (до 48)</span>
            <span className="row"><button className="btn sm" onClick={() => setSel(Array.from(new Set([...sel, ...items.map((i) => i.id)])).slice(0, 48))}>Выбрать все найденные</button><button className="btn sm" onClick={() => setSel([])}>Сбросить</button></span>
          </div>
          {list.isLoading ? <Skeleton lines={5} /> : !items.length ? <Empty icon="search" title="Ничего не найдено" /> : (
            <div className="gen-list" role="group" aria-label="Оборудование">
              {items.map((e) => (
                <label key={e.id} className="gen-row">
                  <input type="checkbox" checked={sel.includes(e.id)} onChange={() => toggle(e.id)} aria-label={`Выбрать ${e.name}`} />
                  <span style={{ flex: 1, minWidth: 0 }}><b>{e.inventory_number}</b> {e.name}<span className="small muted"> · {e.site?.name}</span></span>
                  {sel.includes(e.id) && <Link className="small" to={`/equipment/${e.id}/qr`} onClick={(ev) => ev.stopPropagation()}>QR</Link>}
                </label>))}
            </div>)}
        </div>
        <div className="card stack">
          <Field label="Формат" hint={LAYOUT_HINT[layout]}>
            <select value={layout} onChange={(e) => setLayout(e.target.value)}>
              {(layouts.data ?? [{ id: 'sheet8', title: 'Лист A4: 8 этикеток' }]).map((l: any) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </Field>
          <div className="row">
            <a className={`btn primary ${url ? '' : 'disabled'}`} aria-disabled={!url} href={url ? url + '&download=1' : undefined}><Icon name="download" size={18} /> Сохранить PDF</a>
            <Button onClick={printFrame} disabled={!url}><Icon name="print" size={18} /> Печать</Button>
            {sel.length === 1 && <a className="btn" href={`/api/v1/equipment/${sel[0]}/passport.pdf?download=1`}><Icon name="audit" size={18} /> Паспорт PDF</a>}
          </div>
          {url ? <iframe ref={frame} key={url} title="Предпросмотр PDF" src={url} className="gen-preview" /> : <Empty icon="qr" title="Предпросмотр" text="Отметьте оборудование слева." />}
        </div>
      </div>
    </div>
  )
}
