import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE ?? 'http://169.254.0.21:9100';
const SHOT = process.env.SHOT ?? '/tmp/preview-9100.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('text=Dashboard', { timeout: 20000 });

const checks = {
  'dashboard heading': await page.locator('h1:has-text("Dashboard")').count(),
  'sidebar nav items': await page.locator('nav[aria-label="Main navigation"] a').count(),
  'summary cards': await page.locator('text=Total assets').count(),
  'honest empty state': await page.locator('text=No assets in the library yet').count(),
  'storage connected indicator': await page.locator('text=Filebase connected').count(),
};
for (const [name, count] of Object.entries(checks)) {
  console.log(`${count > 0 ? 'PASS' : 'FAIL'}  ${name} (${count})`);
}

// client-side routing must not full-reload or 404
for (const route of ['assets', 'collections', 'uploads', 'settings']) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
  const h1 = (await page.locator('h1').first().textContent())?.trim() ?? '';
  console.log(`${h1 ? 'PASS' : 'FAIL'}  /${route} renders "${h1}"`);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.screenshot({ path: SHOT });
const meaningful = errors.filter((e) => !e.includes('favicon') && !e.includes('React DevTools'));
console.log(`console errors: ${meaningful.length === 0 ? 'none' : meaningful.slice(0, 3).join(' | ')}`);
await browser.close();
process.exitCode = Object.values(checks).every((c) => c > 0) && meaningful.length === 0 ? 0 : 1;
