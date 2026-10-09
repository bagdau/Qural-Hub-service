import { useRef, useState } from 'react'
import { ApiError, api, uuid } from '../api/client'
import { Button, errText, useOnline } from './ui'
import { STAGE } from '../lib/format'

interface Item { id: string; file: File; key: string; pct: number; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string; preview?: string }

/** Уменьшает большие фото на клиенте (экономия трафика в поле): длинная сторона ≤ 2560 px, JPEG 0.85 */
export async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file)
    const max = 2560
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 2_500_000) return file
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

export function Uploader({ ticketId, stages = ['before', 'during', 'after', 'other'], defaultStage = 'before', allowDocs = true, onUploaded, visibilityChoice }: {
  ticketId: string; stages?: string[]; defaultStage?: string; allowDocs?: boolean; onUploaded?: () => void; visibilityChoice?: boolean
}) {
  const [items, setItems] = useState<Item[]>([])
  const [stage, setStage] = useState(defaultStage)
  const [internal, setInternal] = useState(false)
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)
  const doc = useRef<HTMLInputElement>(null)
  const online = useOnline()

  const upd = (id: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const send = async (it: Item, kind: 'photo' | 'document', st: string) => {
    upd(it.id, { status: 'uploading', pct: 0, error: undefined })
    const form = new FormData()
    form.append('file', it.file); form.append('kind', kind)
    if (kind === 'photo') form.append('stage', st)
    form.append('visibility', internal ? 'internal' : 'public')
    try {
      await api('POST', `/tickets/${ticketId}/attachments`, { form, idem: it.key, onProgress: (p) => upd(it.id, { pct: p }) })
      upd(it.id, { status: 'done', pct: 100 })
      onUploaded?.()
    } catch (e) {
      upd(it.id, { status: 'error', error: e instanceof ApiError && e.status === 0 ? 'Нет сети — повторите позже' : errText(e) })
    }
  }

  const add = async (files: FileList | null, kind: 'photo' | 'document') => {
    if (!files) return
    for (const f0 of Array.from(files)) {
      const f = kind === 'photo' ? await shrink(f0) : f0
      const it: Item = { id: uuid(), file: f, key: uuid(), pct: 0, status: 'queued', preview: kind === 'photo' ? URL.createObjectURL(f) : undefined }
      setItems((xs) => [...xs, it])
      send(it, kind, stage)
    }
  }
  const retry = (it: Item) => send(it, it.file.type === 'application/pdf' ? 'document' : 'photo', stage)

  return (
    <div className="stack">
      <div className="row">
        <div style={{ minWidth: 160 }}>
          <label className="small muted" htmlFor="stage">Стадия фото</label>
          <select id="stage" className="input" value={stage} onChange={(e) => setStage(e.target.value)}>{stages.map((s) => <option key={s} value={s}>{STAGE[s]}</option>)}</select>
        </div>
        {visibilityChoice && <label className="row small"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Скрыть от клиента</label>}
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files, 'photo'); e.target.value = '' }} />
      <input ref={gal} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { add(e.target.files, 'photo'); e.target.value = '' }} />
      <input ref={doc} type="file" accept="application/pdf" hidden onChange={(e) => { add(e.target.files, 'document'); e.target.value = '' }} />
      <div className="row">
        <Button onClick={() => cam.current?.click()} disabled={!online}>📷 Сделать фото</Button>
        <Button onClick={() => gal.current?.click()} disabled={!online}>🖼 Из галереи</Button>
        {allowDocs && <Button onClick={() => doc.current?.click()} disabled={!online}>📄 PDF-документ</Button>}
      </div>
      {items.length > 0 && (
        <div className="stack" aria-live="polite">
          <div className="small muted">Загружено {items.filter((i) => i.status === 'done').length} из {items.length}</div>
          {items.map((it) => (
            <div key={it.id} className="row" style={{ flexWrap: 'nowrap' }}>
              {it.preview ? <img src={it.preview} alt="" width={48} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <span aria-hidden>📄</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.file.name}</div>
                {it.status === 'uploading' && <div className="progress" role="progressbar" aria-valuenow={it.pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${it.pct}%` }} /></div>}
                {it.status === 'done' && <div className="small" style={{ color: 'var(--ok)' }}>✔ Загружено</div>}
                {it.status === 'error' && <div className="err" role="alert">{it.error}</div>}
              </div>
              {it.status === 'error' && <Button small onClick={() => retry(it)}>Повторить</Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
