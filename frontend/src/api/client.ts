// Клиент API: CSRF, Idempotency-Key, единый разбор ошибок (раздел 8.1)
export class ApiError extends Error {
  status: number
  code: string
  details: any
  requestId?: string
  constructor(status: number, code: string, message: string, details: any, requestId?: string) {
    super(message)
    this.status = status
    this.code = code
    this.details = details ?? {}
    this.requestId = requestId
  }
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const f of this.details?.fields ?? []) out[f.field] = f.message
    return out
  }
}

let csrf = ''
let serverOffsetMs = 0
/** Текущее время по часам сервера (важно для SLA: в demo часы сервера зафиксированы) */
export const nowMs = () => Date.now() + serverOffsetMs
const syncTime = (h: Headers) => { const t = h.get('x-server-time'); if (t) { const v = Date.parse(t); if (!isNaN(v)) serverOffsetMs = v - Date.now() } }
let onUnauthorized: (() => void) | null = null
export const setCsrf = (t: string) => { csrf = t }
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

/** UUID v4 без зависимости от secure context (crypto.randomUUID недоступен по http://IP) */
export function uuid(): string {
  const c: any = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export interface ReqOpts {
  body?: unknown
  idem?: string
  query?: Record<string, any>
  form?: FormData
  signal?: AbortSignal
  onProgress?: (pct: number) => void
}

function qs(q?: Record<string, any>) {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)))
    else p.append(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function parseError(res: Response): Promise<ApiError> {
  let data: any = null
  try { data = await res.json() } catch { /* not json */ }
  const e = data?.error
  return new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Ошибка ${res.status}`, e?.details, e?.request_id)
}

export async function api<T = any>(method: string, path: string, opts: ReqOpts = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf
  if (opts.idem) headers['Idempotency-Key'] = opts.idem
  let body: BodyInit | undefined
  if (opts.form) {
    return uploadXhr<T>(method, `/api/v1${path}${qs(opts.query)}`, headers, opts.form, opts.onProgress)
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(`/api/v1${path}${qs(opts.query)}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK', 'Нет соединения с сервером.', {})
  }
  syncTime(res.headers)
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized?.()
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return res.json()
}

function uploadXhr<T>(method: string, url: string, headers: Record<string, string>, form: FormData, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open(method, url)
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((100 * e.loaded) / e.total)) }
    x.onerror = () => reject(new ApiError(0, 'NETWORK', 'Нет соединения с сервером.', {}))
    x.onload = () => {
      let data: any = null
      try { data = JSON.parse(x.responseText) } catch { /* empty */ }
      if (x.status >= 200 && x.status < 300) return resolve(data as T)
      if (x.status === 401) onUnauthorized?.()
      const e = data?.error
      reject(new ApiError(x.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Ошибка ${x.status}`, e?.details, e?.request_id))
    }
    x.send(form)
  })
}

export const get = <T = any>(path: string, query?: Record<string, any>) => api<T>('GET', path, { query })
export const post = <T = any>(path: string, body?: unknown, idem?: string) => api<T>('POST', path, { body, idem })
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, { body })
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, { body })
export const del = <T = any>(path: string) => api<T>('DELETE', path)
