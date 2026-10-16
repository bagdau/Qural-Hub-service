import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { decodeFile, extractCode } from '../lib/qr/decoder'
import { useQrScanner } from '../lib/qr/useQrScanner'
import { ManualSearch } from './Equipment'

const CONSENT_KEY = 'alageum.camera-consent'
const readConsent = () => { try { return sessionStorage.getItem(CONSENT_KEY) === '1' } catch { return false } }
const saveConsent = () => { try { sessionStorage.setItem(CONSENT_KEY, '1') } catch { /* режим без хранилища */ } }
/** Тот же сайт по HTTPS (порт 8443 стенда; при уже защищённом адресе не нужен) */
const httpsUrl = () => `https://${window.location.hostname}:8443/scan`

type Result = { kind: 'ok' | 'warn' | 'err'; text: string } | null

/** true, пока ширина экрана не больше max (телефон/планшет) */
function useMedia(query: string) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const h = () => setOn(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [query])
  return on
}

export function ScanPage() {
  const nav = useNavigate()
  const [result, setResult] = useState<Result>(null)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const touch = useMedia('(max-width: 1024px)')

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
  const immersive = scanning && touch   // на телефоне и планшете камера занимает весь экран, как в банковских приложениях

  const secure = window.isSecureContext
  const requestCamera = () => {
    setResult(null)
    if (secure && readConsent()) sc.start()
    else setAsk(true)
  }
  const allow = () => { saveConsent(); setAsk(false); sc.start() }

  // пока камера открыта на весь экран, страница под ней не прокручивается
  useEffect(() => {
    if (!immersive) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [immersive])

  return (
    <div className="stack">
      <PageHeader title="Сканер QR-кода" subtitle="Наведите камеру на этикетку оборудования — откроется его цифровой паспорт." />
      <div className="card stack scan-card">
        <div className={`scanner ${immersive ? 'immersive' : ''}`}>
          <div className={`viewfinder ${scanning ? 'on' : ''}`}>
            <video ref={sc.videoRef} muted playsInline autoPlay aria-label="Изображение с камеры" />
            {!scanning && (
              <div className="vf-idle">
                <Icon name="qr" size={64} />
                <div>Камера выключена</div>
                <Button variant="primary" className="vf-start" onClick={requestCamera}><Icon name="camera" size={20} /> Включить камеру</Button>
              </div>)}
            {scanning && (
              <>
                <div className="vf-frame" aria-hidden><i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" /><div className="vf-line" /></div>
                <div className="vf-hint">{sc.state === 'starting' ? 'Запуск камеры…' : 'Наведите камеру на QR-код'}</div>
              </>)}
            {sc.resolution && scanning && <span className="vf-badge" title="Разрешение видеопотока">{Number(sc.resolution.split('×')[0]) >= 1280 ? 'HD' : 'SD'} {sc.resolution}</span>}
          </div>

          {immersive && (
            <>
              <div className="scan-top">
                <button className="round" onClick={sc.stop} aria-label="Выключить камеру"><Icon name="close" size={22} /></button>
                <span>Сканер QR</span>
                <span className="round-spacer" />
              </div>
              <div className="scan-bottom">
                {sc.caps.zoom && (
                  <label className="scan-zoom">
                    <span className="sr-only">Зум камеры</span>
                    <input type="range" min={sc.caps.zoom.min} max={sc.caps.zoom.max} step={sc.caps.zoom.step} value={sc.zoom} onChange={(e) => sc.setZoom(Number(e.target.value))} aria-label="Зум камеры" />
                    <span className="mono">×{sc.zoom.toFixed(1)}</span>
                  </label>)}
                <div className="scan-actions">
                  {sc.caps.torch && (
                    <button className={`round-lg ${sc.torch ? 'on' : ''}`} onClick={() => sc.setTorch(!sc.torch)} aria-pressed={sc.torch}><Icon name="bolt" size={24} /><span>{sc.torch ? 'Фонарик: вкл' : 'Фонарик'}</span></button>)}
                  <button className="round-lg" onClick={() => file.current?.click()} disabled={busy}><Icon name="image" size={24} /><span>Фото</span></button>
                  <button className={`round-lg ${sc.enhanced ? 'on' : ''}`} onClick={() => sc.setEnhanced(!sc.enhanced)} aria-pressed={sc.enhanced} title="Усиливает контраст и яркость кадра: туман, дождь, сумерки, блики"><Icon name="sun" size={24} /><span>Плохая видимость</span></button>
                </div>
              </div>
            </>)}
        </div>

        {!immersive && (
          <div className="row">
            {scanning && <Button onClick={sc.stop}>Выключить камеру</Button>}
            <Button onClick={() => file.current?.click()} loading={busy}><Icon name="image" size={18} /> Снять фото QR</Button>
            {scanning && sc.caps.torch && <Button onClick={() => sc.setTorch(!sc.torch)} aria-pressed={sc.torch}>{sc.torch ? 'Фонарик: вкл' : 'Фонарик'}</Button>}
            {scanning && <label className="row small" title="Усиливает контраст и яркость кадра: туман, дождь, сумерки, блики"><input type="checkbox" checked={sc.enhanced} onChange={(e) => sc.setEnhanced(e.target.checked)} /> Плохая видимость</label>}
          </div>)}
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        {!immersive && scanning && sc.caps.zoom && (
          <label className="row small" style={{ flexWrap: 'nowrap' }}>Зум
            <input type="range" min={sc.caps.zoom.min} max={sc.caps.zoom.max} step={sc.caps.zoom.step} value={sc.zoom} onChange={(e) => sc.setZoom(Number(e.target.value))} style={{ flex: 1 }} aria-label="Зум камеры" />
            <span className="mono">×{sc.zoom.toFixed(1)}</span>
          </label>)}
        {sc.error?.kind === 'denied' && <div className="row"><Button onClick={() => setAsk(true)}>Повторить запрос камеры</Button></div>}
        {sc.error && <div className={`banner ${sc.error.kind === 'insecure' || sc.error.kind === 'unsupported' ? 'warn' : 'err'}`} role="alert">{sc.error.message}</div>}
        {result && <div className={`banner ${result.kind === 'ok' ? 'ok' : result.kind === 'warn' ? 'warn' : 'err'}`} role="status">{result.text}</div>}
        {immersive && result && <div className={`scan-toast ${result.kind}`} role="status">{result.text}</div>}
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
      {ask && (secure ? (
        <Modal title="Разрешить доступ к камере?" onClose={() => setAsk(false)}>
          <p>Для сканирования QR-кода приложению нужна камера устройства (задняя). Видео не записывается и не отправляется на сервер — изображение обрабатывается только на вашем устройстве.</p>
          <p className="small muted">Сейчас браузер покажет собственный запрос — нажмите в нём «Разрешить» (на iPhone — «Allow»). Если вы случайно отказали, разрешите камеру для этого сайта в настройках браузера и повторите.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setAsk(false)}>Отмена</Button>
            <Button variant="primary" onClick={allow} autoFocus><Icon name="camera" size={18} /> Разрешить камеру</Button>
          </div>
        </Modal>
      ) : (
        <Modal title="Камера недоступна без HTTPS" onClose={() => setAsk(false)}>
          <p>Браузер разрешает камеру только на защищённых страницах (HTTPS). Эта страница открыта по обычному HTTP, поэтому запрос доступа к камере не появится.</p>
          <p className="small muted">Откройте тот же сайт по HTTPS. При первом входе браузер предупредит о самоподписанном сертификате — нажмите «Дополнительно» → «Продолжить»: это наш тестовый стенд. Либо снимите QR на фото — это работает и без HTTPS.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setAsk(false)}>Закрыть</Button>
            <Button onClick={() => { setAsk(false); file.current?.click() }}><Icon name="image" size={18} /> Снять фото QR</Button>
            <a className="btn primary" href={httpsUrl()}>Открыть по HTTPS</a>
          </div>
        </Modal>
      ))}
    </div>
  )
}
