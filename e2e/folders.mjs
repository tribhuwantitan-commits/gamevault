/**
 * Browser check for folders + auto-versioning, driven through the real UI.
 *   node e2e/folders.mjs --base http://127.0.0.1:9450
 */
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const BASE = arg('base', 'http://127.0.0.1:9450');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

// Login (password login is enabled on this test server).
await page.goto(BASE, { waitUntil: 'networkidle' });
if (await page.locator('#login-password').count()) {
  await page.fill('#login-password', arg('password', 'correct horse battery staple'));
  await page.click('button[type=submit]');
}
await page.waitForSelector('nav[aria-label="Main navigation"]', { state: 'attached', timeout: 20_000 });

// 1. Folders tab exists and opens.
await page.goto(`${BASE}/folders`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=New folder');
check('Folders page opens', true);

// 2. Create Game Asset → City Builder → Commercial Building.
const main = page.locator('main');
const mk = async (name) => {
  await main.getByRole('button', { name: 'New folder' }).first().click();
  await page.fill('#new-folder', name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await main.locator('button', { hasText: name }).first().waitFor({ timeout: 10_000 });
  return main.locator('button', { hasText: name }).first();
};
const open = async (name) => {
  await main.locator('button', { hasText: name }).first().click();
  await page.waitForLoadState('networkidle');
};

await mk('Game Asset');
check('top-level folder created', true);

await open('Game Asset');
await mk('City Builder');
check('nested folder created inside Game Asset', true);

await open('City Builder');
await mk('Commercial Building');
check('third level folder created', true);
await open('Commercial Building');
check('entered the third level', (await main.locator('h1').innerText()).includes('Commercial Building'));

// 3. Breadcrumb shows the full path.
const breadcrumbs = await page.locator('nav[aria-label="Breadcrumb"]').innerText();
check('breadcrumb shows the nesting', breadcrumbs.replace(/\s+/g, ' ').includes('Game Asset') && breadcrumbs.includes('City Builder'), breadcrumbs.replace(/\s+/g, ' '));

// 4. Big yellow folder icon is rendered as an SVG with a yellow gradient.
const svgYellow = await page.evaluate(() => {
  const svg = document.querySelector('svg linearGradient stop');
  return svg ? svg.getAttribute('stop-color') : null;
});
check('folder icon uses the yellow gradient', Boolean(svgYellow && svgYellow.toLowerCase().includes('ffd75e')), String(svgYellow));

// 5. Versioning: upload two ZIPs into City Builder via the API (same path the UI uses).
await page.goto(`${BASE}/folders`, { waitUntil: 'networkidle' });
await open('Game Asset');
await open('City Builder');

const folderId = await page.evaluate(async () => {
  const res = await fetch('/api/folders');
  const data = await res.json();
  return data.folders.find((f) => f.path === '/Game Asset/City Builder')?.id ?? null;
});
check('folder id resolved from the API', Boolean(folderId));

const titles = await page.evaluate(async (id) => {
  const makeZip = (name) => new File([new Uint8Array(512)], name, { type: 'application/zip' });
  const uploaded = [];
  for (const name of ['first-build.zip', 'second-build.zip']) {
    const file = makeZip(name);
    const ticket = await fetch('/api/assets/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: name, size: file.size, collection: 'Game', folderId: id }),
    }).then((r) => r.json());
    await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body: file });
    const done = await fetch('/api/assets/confirm-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: ticket.assetId }),
    }).then((r) => r.json());
    uploaded.push({ title: done.asset.title, displayName: done.asset.displayName, preview: ticket.versionPreview });
  }
  return uploaded;
}, folderId);

check('first ZIP became "City Builder v1"', titles[0]?.title === 'City Builder v1', JSON.stringify(titles[0]));
check('second ZIP became "City Builder v2"', titles[1]?.title === 'City Builder v2', JSON.stringify(titles[1]));

// 6. The UI shows the versioned names inside the folder.
await page.goto(`${BASE}/folders`, { waitUntil: 'networkidle' });
await open('Game Asset');
await open('City Builder');
await page.reload({ waitUntil: 'networkidle' });
await page.locator('text=City Builder v1').first().waitFor({ timeout: 15_000 });
const gridText = await page.locator('main').innerText();
check('versioned names visible in the folder', gridText.includes('City Builder v1') && gridText.includes('City Builder v2'));

// 7. Collection list is the new one.
const caps = await page.evaluate(async () => (await fetch('/api/capabilities')).json());
check(
  'collections are Game, App, 2D, 3D, Audio, Environment, Other',
  JSON.stringify([...caps.defaultCollections].sort()) === JSON.stringify(['2D', '3D', 'App', 'Audio', 'Environment', 'Game', 'Other']),
  caps.defaultCollections.join(', '),
);

check('no uncaught page errors', errors.length === 0, errors.join('; '));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
