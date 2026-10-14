import { defineConfig, devices } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:8080'
const FIXTURES = process.env.FIXTURES_DIR ?? '/work/e2e/fixtures'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  outputDir: './artifacts/out',
  use: { baseURL: BASE, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'ru-RU' },
  projects: [
    // компьютер: администраторы и диспетчеры
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile|scanner-camera/ },
    // планшет: инженеры и клиенты
    { name: 'tablet', use: { ...devices['iPad Pro 11'], browserName: 'chromium' }, testMatch: /responsive/ },
    // телефон: все роли
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile|responsive/ },
    // сканер: подменная камера (видеофайл с QR) и доверие к http-адресу стенда (иначе getUserMedia недоступен)
    {
      name: 'scanner',
      testMatch: /scanner-camera/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${FIXTURES}/qr.y4m`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
        },
      },
    },
  ],
})
