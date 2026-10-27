const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/BAGDAULET-KOPTILEU/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const root = path.resolve(__dirname, '../../..');
  const out = path.join(__dirname, 'assets');
  fs.mkdirSync(out, { recursive: true });
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const password = env.match(/^DEMO_USER_PASSWORD=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', reducedMotion: 'reduce' });
  const login = await context.request.post('http://localhost:8100/api/v1/auth/login', { data: { email: 'dispatcher@demo.alageum.test', password } });
  if (!login.ok()) throw new Error(`Demo login failed: ${login.status()}`);
  const page = await context.newPage();
  for (const [name, route] of [['dashboard', '/'], ['equipment', '/equipment'], ['board', '/board']]) {
    await page.goto(`http://localhost:8100${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${name}-2026-10-27.png`), fullPage: false });
    console.log(`${name}: ${page.url()}`);
  }
  await context.close();
  await browser.close();
})().catch(err => { console.error(err.message); process.exit(1); });
