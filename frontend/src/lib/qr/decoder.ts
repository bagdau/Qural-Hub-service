import jsQR from 'jsqr'

/** Изображение в формате RGBA (как ImageData) — не зависит от DOM, поэтому тестируется отдельно. */
export interface Raster { data: Uint8ClampedArray; width: number; height: number }

const CODE_RE = /\/e\/([A-Za-z0-9]{12})(?![A-Za-z0-9])/
/** Из содержимого QR (ссылка вида https://хост/e/КОД либо сам код) достаёт 12-символьный код оборудования */
export function extractCode(raw: string): string | null {
  const s = raw.trim()
  const m = CODE_RE.exec(s)
  if (m) return m[1].toUpperCase()
  return /^[A-Za-z0-9]{12}$/.test(s) ? s.toUpperCase() : null
}

function gray(r: Raster): Uint8ClampedArray {
  const g = new Uint8ClampedArray(r.width * r.height)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (r.data[j] * 77 + r.data[j + 1] * 150 + r.data[j + 2] * 29) >> 8
  return g
}
function fromGray(g: Uint8ClampedArray, w: number, h: number): Raster {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = g[i]; d[j + 3] = 255 }
  return { data: d, width: w, height: h }
}

/** Растяжение контраста по перцентилям (2–98%) + гамма: помогает при тусклом свете, дожде, тумане */
export function enhance(r: Raster, gamma = 1): Raster {
  const g = gray(r)
  const hist = new Uint32Array(256)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  const lo = percentile(hist, g.length, 0.02), hi = percentile(hist, g.length, 0.98)
  const span = Math.max(1, hi - lo)
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / span)), gamma)
  for (let i = 0; i < g.length; i++) g[i] = lut[g[i]]
  return fromGray(g, r.width, r.height)
}
function percentile(hist: Uint32Array, total: number, p: number): number {
  let acc = 0
  const t = total * p
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v }
  return 255
}

/** Локальная бинаризация (адаптивный порог по среднему в окне) — против бликов и неравномерной засветки */
export function adaptiveThreshold(r: Raster, win = 24, bias = 8): Raster {
  const { width: w, height: h } = r
  const g = gray(r)
  const integral = new Float64Array((w + 1) * (h + 1))
  for (let y = 1; y <= h; y++) {
    let row = 0
    for (let x = 1; x <= w; x++) {
      row += g[(y - 1) * w + (x - 1)]
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row
    }
  }
  const out = new Uint8ClampedArray(g.length)
  const half = win >> 1
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1)
      const area = (x1 - x0) * (y1 - y0)
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]
      out[y * w + x] = g[y * w + x] < sum / area - bias ? 0 : 255
    }
  }
  return fromGray(out, w, h)
}

/** Размытие рамкой (шумоподавление): гасит зернистость и «соль-перец» на тёмных и дождливых кадрах */
export function boxBlur(r: Raster, radius = 1): Raster {
  const { width: w, height: h } = r
  const g = gray(r)
  const tmp = new Float32Array(g.length)
  const out = new Uint8ClampedArray(g.length)
  const k = radius * 2 + 1
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -radius; x <= radius; x++) acc += g[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / k
      acc += g[y * w + Math.min(w - 1, x + radius + 1)] - g[y * w + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k
      acc += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x]
    }
  }
  return fromGray(out, w, h)
}

/** Уменьшение/увеличение (билинейно через Canvas-независимый nearest — для скорости достаточно) */
export function resize(r: Raster, scale: number): Raster {
  const w = Math.max(32, Math.round(r.width * scale)), h = Math.max(32, Math.round(r.height * scale))
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(r.height - 1, Math.floor(y / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(r.width - 1, Math.floor(x / scale))
      const si = (sy * r.width + sx) * 4, di = (y * w + x) * 4
      d[di] = r.data[si]; d[di + 1] = r.data[si + 1]; d[di + 2] = r.data[si + 2]; d[di + 3] = 255
    }
  }
  return { data: d, width: w, height: h }
}

const run = (r: Raster): string | null => jsQR(r.data, r.width, r.height, { inversionAttempts: 'attemptBoth' })?.data ?? null

/** Ступени обработки: от быстрой к «тяжёлой». Каждая пробует распознать QR заново на улучшенном кадре. */
export const STAGES: { name: string; apply: (r: Raster) => Raster | null }[] = [
  { name: 'raw', apply: (r) => r },
  { name: 'contrast', apply: (r) => enhance(r) },
  { name: 'lowlight', apply: (r) => enhance(r, 0.55) },
  { name: 'glare', apply: (r) => enhance(r, 1.6) },
  { name: 'adaptive', apply: (r) => adaptiveThreshold(enhance(r)) },
  { name: 'adaptive-big', apply: (r) => adaptiveThreshold(enhance(r), 48, 6) },
  { name: 'half', apply: (r) => (r.width > 640 ? enhance(resize(r, 0.5)) : null) },
  { name: 'upscale', apply: (r) => (r.width < 700 ? enhance(resize(r, 2)) : null) },
  // шумоподавление — для тёмных, зернистых кадров (сумерки, дождь, дешёвая матрица)
  { name: 'denoise', apply: (r) => enhance(boxBlur(r, 1)) },
  { name: 'denoise-adaptive', apply: (r) => adaptiveThreshold(boxBlur(enhance(r), 1), 24, 6) },
  { name: 'denoise-strong', apply: (r) => adaptiveThreshold(boxBlur(enhance(r), 2), 32, 4) },
  { name: 'denoise-heavy', apply: (r) => enhance(boxBlur(r, 3)) },
  { name: 'denoise-heavy-adaptive', apply: (r) => adaptiveThreshold(enhance(boxBlur(r, 2)), 72, 18) },
  { name: 'denoise-half', apply: (r) => (r.width > 640 ? adaptiveThreshold(boxBlur(enhance(resize(r, 0.5)), 1), 24, 4) : null) },
]

/** Пробует распознать QR на одном кадре. `from`/`to` ограничивают набор ступеней (для живого видео — по очереди). */
export function decodeRaster(r: Raster, from = 0, to = STAGES.length): { text: string; stage: string } | null {
  for (let i = from; i < Math.min(to, STAGES.length); i++) {
    const img = STAGES[i].apply(r)
    if (!img) continue
    const t = run(img)
    if (t) return { text: t, stage: STAGES[i].name }
  }
  return null
}

/** Полный анализ изображения (фото из галереи/камеры): все ступени, затем те же ступени с поворотами 90° */
export function analyzeRaster(r: Raster): { text: string; stage: string } | null {
  const direct = decodeRaster(r)
  if (direct) return direct
  return null
}

/** Файл-изображение → Raster (с уменьшением очень больших фото, чтобы не упереться в память телефона) */
export async function fileToRaster(file: Blob, maxSide = 1600): Promise<Raster> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const id = ctx.getImageData(0, 0, w, h)
  return { data: id.data, width: w, height: h }
}

export async function decodeFile(file: Blob): Promise<{ text: string; stage: string } | null> {
  const r = await fileToRaster(file)
  return analyzeRaster(r) ?? analyzeRaster(await fileToRaster(file, 900))
}
