import { useCallback, useEffect, useRef, useState } from 'react'
import { STAGES, decodeRaster, type Raster } from './decoder'

export type ScanState = 'idle' | 'starting' | 'scanning' | 'error'
export type ScanErrorKind = 'insecure' | 'unsupported' | 'denied' | 'nocamera' | 'busy' | 'unknown'
export interface ScanError { kind: ScanErrorKind; message: string }

const MAX_SIDE = 1280
// план ступеней распознавания по кадрам: каждый кадр стоит ограниченное время, но за цикл проходят все ступени
const PLAN_NORMAL = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 14]]
const PLAN_ENHANCED = [[1, 3], [8, 10], [12, 14], [3, 5], [10, 12], [4, 6], [0, 2], [6, 8]]

const HD_STEPS: MediaStreamConstraints[] = [
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false },
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
  { video: true, audio: false },
]

function errorOf(e: any): ScanError {
  const n = e?.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return { kind: 'denied', message: 'Доступ к камере запрещён. Разрешите камеру для этого сайта в настройках браузера и нажмите «Включить камеру» снова.' }
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return { kind: 'nocamera', message: 'Камера не найдена. Сфотографируйте QR-код кнопкой «Снять фото QR» или найдите оборудование вручную.' }
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return { kind: 'busy', message: 'Камера занята другим приложением. Закройте его и повторите.' }
  return { kind: 'unknown', message: 'Не удалось запустить камеру. Воспользуйтесь кнопкой «Снять фото QR» или ручным поиском.' }
}

export function useQrScanner(onCode: (raw: string, stage: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timer = useRef<any>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const frame = useRef(0)
  const alive = useRef(false)
  const detRef = useRef<any>(null)
  const cb = useRef(onCode)
  cb.current = onCode
  const [state, setState] = useState<ScanState>('idle')
  const [error, setError] = useState<ScanError | null>(null)
  const [caps, setCaps] = useState<{ torch: boolean; zoom: { min: number; max: number; step: number } | null }>({ torch: false, zoom: null })
  const [torch, setTorchState] = useState(false)
  const [zoom, setZoomState] = useState(1)
  const [resolution, setResolution] = useState('')
  const [enhanced, setEnhanced] = useState(false)
  const enhancedRef = useRef(false)
  enhancedRef.current = enhanced

  const stop = useCallback(() => {
    alive.current = false
    clearTimeout(timer.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const v = videoRef.current
    if (v) { try { v.pause() } catch { /* ignore */ } v.srcObject = null }
    setTorchState(false)
    setState('idle')
  }, [])

  const grab = (): Raster | null => {
    const v = videoRef.current
    if (!v || v.readyState < 2 || !v.videoWidth) return null
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight))
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale)
    const c = (canvas.current ??= document.createElement('canvas'))
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, w, h)
    const id = ctx.getImageData(0, 0, w, h)
    return { data: id.data, width: w, height: h }
  }

  const tick = useCallback(async () => {
    if (!alive.current) return
    try {
      const w: any = window
      const r = grab()
      if (r) {
        let found: { text: string; stage: string } | null = null
        if (w.BarcodeDetector && videoRef.current) {
          try {
            const det = (detRef.current ??= new w.BarcodeDetector({ formats: ['qr_code'] }))
            const codes = await det.detect(videoRef.current)
            if (codes?.[0]?.rawValue) found = { text: codes[0].rawValue, stage: 'native' }
          } catch { /* детектор недоступен — работает программный */ }
        }
        if (!found) {
          const plan = enhancedRef.current ? PLAN_ENHANCED : PLAN_NORMAL
          const [a, b] = plan[frame.current++ % plan.length]
          found = decodeRaster(r, a, Math.min(b, STAGES.length))
        }
        if (found && alive.current) { stop(); cb.current(found.text, found.stage); return }
      }
    } catch { /* единичный сбой кадра не должен ронять сканирование */ }
    if (alive.current) timer.current = setTimeout(tick, 90)
  }, [stop])

  const start = useCallback(async () => {
    setError(null)
    if (!window.isSecureContext) { setError({ kind: 'insecure', message: 'Камера в браузере работает только по HTTPS. Нажмите «Снять фото QR» — это работает и без HTTPS — или откройте QR штатной камерой телефона.' }); setState('error'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setError({ kind: 'unsupported', message: 'Браузер не даёт доступ к камере. Используйте «Снять фото QR» или ручной поиск.' }); setState('error'); return }
    setState('starting')
    let stream: MediaStream | null = null
    let lastErr: any = null
    for (const c of HD_STEPS) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break } catch (e: any) {
        lastErr = e
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError' || e?.name === 'NotFoundError' || e?.name === 'NotReadableError') break
      }
    }
    if (!stream) { setError(errorOf(lastErr)); setState('error'); return }
    streamRef.current = stream
    const v = videoRef.current
    if (!v) { stream.getTracks().forEach((t) => t.stop()); setState('idle'); return }
    v.srcObject = stream
    v.muted = true
    try { await v.play() } catch (e: any) { if (e?.name !== 'AbortError') { /* автозапуск заблокирован — пользователь уже нажал кнопку, поэтому повтор не нужен */ } }
    const track = stream.getVideoTracks()[0]
    try {
      const capsRaw: any = track.getCapabilities?.() ?? {}
      setCaps({ torch: !!capsRaw.torch, zoom: capsRaw.zoom ? { min: capsRaw.zoom.min, max: capsRaw.zoom.max, step: capsRaw.zoom.step || 0.1 } : null })
      const adv: any[] = []
      if (capsRaw.focusMode?.includes?.('continuous')) adv.push({ focusMode: 'continuous' })
      if (capsRaw.exposureMode?.includes?.('continuous')) adv.push({ exposureMode: 'continuous' })
      if (adv.length) await track.applyConstraints({ advanced: adv } as any).catch(() => {})
      const s = track.getSettings?.()
      if (s?.width && s?.height) setResolution(`${s.width}×${s.height}`)
    } catch { /* характеристики недоступны — не критично */ }
    track.addEventListener('ended', () => { if (alive.current) stop() })
    alive.current = true
    frame.current = 0
    setZoomState(1)
    setState('scanning')
    tick()
  }, [stop, tick])

  const setTorch = useCallback(async (on: boolean) => {
    const t = streamRef.current?.getVideoTracks()[0]
    if (!t) return
    try { await t.applyConstraints({ advanced: [{ torch: on } as any] }); setTorchState(on) } catch { setTorchState(false) }
  }, [])
  const setZoom = useCallback(async (z: number) => {
    const t = streamRef.current?.getVideoTracks()[0]
    if (!t) return
    try { await t.applyConstraints({ advanced: [{ zoom: z } as any] }); setZoomState(z) } catch { /* зум недоступен */ }
  }, [])

  useEffect(() => {
    const vis = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); stop() }
  }, [stop])

  return { videoRef, state, error, caps, torch, setTorch, zoom, setZoom, resolution, enhanced, setEnhanced, start, stop }
}
