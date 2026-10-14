import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STAGES, decodeRaster, extractCode, type Raster } from './decoder'

const FX = 'e2e/fixtures'
const load = (name: string): Raster => {
  const b = readFileSync(`${FX}/${name}.rgba`)
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4)
  return { width: w, height: h, data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8, w * h * 4) }
}
const have = existsSync(`${FX}/qr-clean.rgba`)

describe('извлечение кода оборудования', () => {
  it('из ссылки и из «голого» кода', () => {
    expect(extractCode('http://web:8080/e/DEMOEQUIP009')).toBe('DEMOEQUIP009')
    expect(extractCode('https://hub.example.test/e/abcdefgh2345?x=1')).toBe('ABCDEFGH2345')
    expect(extractCode('DEMOEQUIP001')).toBe('DEMOEQUIP001')
    expect(extractCode('https://example.com/other')).toBeNull()
    expect(extractCode('SR-2026-0001')).toBeNull()
  })
})

describe.runIf(have)('распознавание QR в плохих условиях (ступени обработки)', () => {
  for (const name of ['qr-clean', 'qr-fog-rain', 'qr-glare', 'qr-lowlight', 'qr-noise']) {
    it(name, { timeout: 120000 }, () => {
      const r = decodeRaster(load(name))
      const stages = STAGES.map((s, i) => { const x = decodeRaster(load(name), i, i + 1); return `${s.name}:${x ? 'ok' : '-'}` }).join(' ')
      console.log(name, '→', r?.stage ?? 'НЕ РАСПОЗНАН', '|', stages)
      expect(r?.text ?? '').toContain('/e/DEMOEQUIP009')
    })
  }
  it('пустое изображение не даёт ложных срабатываний', () => {
    expect(decodeRaster(load('not-a-qr'))).toBeNull()
  })
})
