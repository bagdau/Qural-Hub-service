import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { Icon } from '../components/Icon'
import { decodeFile, extractCode } from '../lib/qr/decoder'
import { useQrScanner } from '../lib/qr/useQrScanner'
import { ManualSearch } from './Equipment'

type Result = { kind: 'ok' | 'warn' | 'err'; text: string } | null

export function ScanPage() {
  const nav = useNavigate()
  const [result, setResult] = useState<Result>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const handleRaw = (raw: string) => {
    const code = extractCode(raw)
    if (code) { setResult({ kind: 'ok', text: `QR распознан: ${code}. Открываем паспорт…` }); nav(`/e/${code}`); return }
    setResult({ kind: 'warn', text: 'Это QR-код, но не оборудования Alageum Service Hub. Наведите камеру на этикетку оборудования.' })
  }
  const sc = useQrScanner((raw) => handleRaw(raw))

  const onPhoto = async (f?: File | null) => {
    if (!f) return
    setBusy(true); setResult(null)
    try {
      const r = await decodeFile(f)
      if (r) handleRaw(r.text)
      else setResult({ kind: 'warn', text: 'QR-код на фото не найден. Сфотографируйте ближе и ровнее: код целиком в кадре, без бликов; при плохом свете включите вспышку.' })
    } catch {
      setResult({ kind: 'err', text: 'Не удалось обработать фото. Попробуйте другой снимок.' })
    } finally { setBusy(false); if (file.current) file.current.value = '' }
  }
  const scanning = sc.state === 'scanning' || sc.state === 'starting'

  return (
    <div className="stack">
      <div><h1>Сканер QR-кода</h1><div className="muted small">Наведите камеру на этикетку оборудования — откроется его цифровой паспорт.</div></div>
      <div className="card stack scan-card">
        <div className={`viewfinder ${scanning ? 'on' : ''}`}>
          <video ref={sc.videoRef} muted playsInline autoPlay aria-label="Изображение с камеры" />
          {!scanning && <div className="vf-idle"><Icon name="qr" size={56} /><div>Камера выключена</div></div>}
          {scanning && <><i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" /><div className="vf-line" aria-hidden /></>}
          {sc.state === 'starting' && <div className="vf-idle">Запуск камеры…</div>}
          {sc.resolution && scanning && <span className="vf-badge" title="Разрешение видеопотока">{Number(sc.resolution.split('×')[0]) >= 1280 ? 'HD' : 'SD'} {sc.resolution}</span>}
        </div>
        <div className="row">
          {!scanning
            ? <Button variant="primary" onClick={() => { setResult(null); sc.start() }}><Icon name="camera" size={18} /> Включить камеру</Button>
            : <Button onClick={sc.stop}>Выключить камеру</Button>}
          <Button onClick={() => file.current?.click()} loading={busy}><Icon name="image" size={18} /> Снять фото QR</Button>
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          {scanning && sc.caps.torch && <Button onClick={() => sc.setTorch(!sc.torch)} aria-pressed={sc.torch}>{sc.torch ? 'Фонарик: вкл' : 'Фонарик'}</Button>}
          {scanning && <label className="row small" title="Усиливает контраст и яркость кадра: туман, дождь, сумерки, блики"><input type="checkbox" checked={sc.enhanced} onChange={(e) => sc.setEnhanced(e.target.checked)} /> Плохая видимость</label>}
        </div>
        {scanning && sc.caps.zoom && (
          <label className="row small" style={{ flexWrap: 'nowrap' }}>Зум
            <input type="range" min={sc.caps.zoom.min} max={sc.caps.zoom.max} step={sc.caps.zoom.step} value={sc.zoom} onChange={(e) => sc.setZoom(Number(e.target.value))} style={{ flex: 1 }} aria-label="Зум камеры" />
            <span className="mono">×{sc.zoom.toFixed(1)}</span>
          </label>)}
        {sc.error && <div className={`banner ${sc.error.kind === 'insecure' || sc.error.kind === 'unsupported' ? 'warn' : 'err'}`} role="alert">{sc.error.message}</div>}
        {result && <div className={`banner ${result.kind === 'ok' ? 'ok' : result.kind === 'warn' ? 'warn' : 'err'}`} role="status">{result.text}</div>}
        <details className="small">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Советы при плохой погоде и слабом свете</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>Включите «Плохая видимость» и фонарик; подойдите ближе, чтобы код занимал треть кадра.</li>
            <li>Держите телефон ровно, без наклона: блики от плёнки и мокрой наклейки мешают распознаванию.</li>
            <li>Если камера не справляется, сделайте фото кнопкой «Снять фото QR» — снимок обрабатывается усиленными фильтрами.</li>
            <li>Этикетки печатаются с высокой коррекцией ошибок — частично загрязнённый код тоже читается.</li>
          </ul>
        </details>
      </div>
      <ManualSearch />
    </div>
  )
}
