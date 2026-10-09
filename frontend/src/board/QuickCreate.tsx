import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, post, uuid } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, Field, Modal, errText, useToast } from '../components/ui'
import { PRIORITY, URGENCY } from '../lib/format'
import type { ColumnId } from './boardLib'

/** Быстрое создание заявки без ухода с доски. Колонка «Принята / Назначена» сразу принимает и назначает (диспетчер). */
export function QuickCreate({ column, onClose, onCreated }: { column: ColumnId; onClose: () => void; onCreated: (id: string) => void }) {
  const { me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const key = useRef(uuid())
  const assign = column === 'assigned'
  const [f, setF] = useState({ equipment_id: '', title: '', description: '', urgency: 'planned', engineer_id: '', priority: 'normal' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const eqs = useQuery({ queryKey: ['eq-select'], queryFn: () => get('/equipment', { page_size: 100 }) })
  const eng = useQuery({ queryKey: ['engineers'], enabled: assign, queryFn: () => get('/engineers') })
  const m = useMutation({
    mutationFn: async () => {
      const t = await post('/tickets', { equipment_id: f.equipment_id, title: f.title, description: f.description, urgency: f.urgency }, key.current)
      if (!assign) return t
      return post(`/tickets/${t.id}/assign`, { version: t.version, engineer_id: f.engineer_id, priority: f.priority }, uuid())
    },
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ['board'] }); key.current = uuid(); toast(`Заявка ${t.number} создана.`); onCreated(t.id) },
    onError: (x) => { if (x instanceof ApiError && x.status === 422) { setErrs(x.fieldErrors()); toast('Проверьте заполнение полей.', true) } else toast(errText(x), true) },
  })
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title={assign ? 'Новая заявка — сразу назначить инженера' : 'Новая заявка'} onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate() }}>
        <Field label="Оборудование" error={errs.equipment_id}>
          <select value={f.equipment_id} onChange={set('equipment_id')} required>
            <option value="">Выберите оборудование…</option>
            {eqs.data?.items.map((e: any) => <option key={e.id} value={e.id}>{e.name} · {e.inventory_number}{me?.role !== 'client' ? ` · ${e.site?.name}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Тема" error={errs.title}><input value={f.title} onChange={set('title')} maxLength={120} /></Field>
        <Field label="Описание" error={errs.description} hint="Не менее 10 символов"><textarea value={f.description} onChange={set('description')} maxLength={4000} /></Field>
        <Field label="Срочность"><select value={f.urgency} onChange={set('urgency')}>{Object.entries(URGENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {assign && <div className="grid cols-2">
          <Field label="Инженер" error={errs.engineer_id}><select value={f.engineer_id} onChange={set('engineer_id')} required><option value="">Выберите…</option>{eng.data?.map((e: any) => <option key={e.id} value={e.id}>{e.full_name} — {e.load} из {e.capacity}</option>)}</select></Field>
          <Field label="Приоритет"><select value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" onClick={onClose}>Отмена</Button>
          <Button variant="primary" type="submit" loading={m.isPending}>{assign ? 'Создать и назначить' : 'Создать заявку'}</Button>
        </div>
      </form>
    </Modal>
  )
}
