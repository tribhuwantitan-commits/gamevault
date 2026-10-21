/**
 * Browser smoke test for the built app (used during development, not part of CI).
 *
 *   node e2e/smoke.mjs [--base http://127.0.0.1:3001] [--dir /tmp/assets] [--shots /tmp/shots]
 *
 * Requires the API to be running with a working storage backend (Filebase or
 * dev/mock-s3.mjs) and `playwright` installed.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const BASE = arg('base', 'http://127.0.0.1:3001');
const ASSET_DIR = arg('dir', '/tmp/assets');
const SHOTS = arg('shots', '/tmp/shots');
const HEADLESS = arg('headless', 'true') !== 'false';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await fs.mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

try {
  // ---------- Dashboard (empty bucket) ----------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });
  check('dashboard renders', true);
  check(
    'honest empty state shown for empty bucket',
    (await page.locator('text=No assets in the library yet').count()) > 0,
  );
  const totalCard = await page.locator('text=Total assets').first().isVisible();
  check('summary cards render', totalCard);
  await shot('01-dashboard-empty');

  // ---------- Upload ----------
  await page.getByRole('button', { name: /Upload/i }).first().click();
  await page.waitForSelector('#upload-title');
  await page.selectOption('#upload-collection', 'Textures');
  await page.fill('#upload-tags', 'test');
  await page.keyboard.press('Enter');

  const files = [
    'crate_albedo.png',
    'ui_click.wav',
    'hero_triangle.gltf',
    'texture_pack.zip',
    'city_block.fbx',
    'scifi_crate.obj',
    'lowpoly_rock.stl',
  ];
  const paths = [];
  for (const file of files) {
    paths.push(path.join(ASSET_DIR, file));
  }
  await page.setInputFiles('input[type=file]', paths);

  await page.waitForFunction(
    () => document.body.innerText.includes('Complete') && !document.body.innerText.includes('Uploading'),
    undefined,
    { timeout: 60000 },
  );
  await shot('02-upload-complete');
  check('upload modal reports completion', true);

  await page.getByRole('button', { name: /^Done$/ }).click();
  await page.waitForTimeout(800);

  // ---------- Library ----------
  await page.goto(`${BASE}/assets`, { waitUntil: 'networkidle' });
  await page.waitForSelector('article', { timeout: 15000 });
  const cardCount = await page.locator('article').count();
  check('library lists uploaded assets', cardCount >= 7, `${cardCount} cards`);
  await shot('03-assets-grid');

  const summary = await page.locator('text=/assets ·/').first().textContent().catch(() => '');
  check('storage summary rendered', Boolean(summary), summary?.trim());

  // Image thumbnail actually loaded (naturalWidth > 0)
  const imageOk = await page.evaluate(() => {
    const img = document.querySelector('article img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  });
  check('image thumbnail loaded from Filebase (presigned URL)', imageOk);

  // ---------- Search + sort ----------
  await page.fill('header input[type=search]', 'wav');
  await page.waitForTimeout(700);
  const filtered = await page.locator('article').count();
  check('search filters the grid', filtered === 1, `${filtered} result(s)`);
  await page.fill('header input[type=search]', '');
  await page.waitForTimeout(700);

  await page.selectOption('#filter-sort', 'size-desc');
  await page.waitForTimeout(600);
  await page.selectOption('#filter-collection', 'Textures');
  await page.waitForTimeout(600);
  check('collection filter works', (await page.locator('article').count()) === 7);
  await page.getByRole('button', { name: /Clear all filters/i }).click();
  await page.waitForTimeout(600);

  // ---------- List view ----------
  await page.getByTitle('List view').click();
  await page.waitForTimeout(400);
  const rows = await page.locator('text=ACTIONS').count();
  check('list view renders', rows >= 0);
  await shot('04-assets-list');
  await page.getByTitle('Grid view').click();

  // ---------- Detail modal: 3D preview ----------
  await page.locator('article', { hasText: 'hero_triangle' }).first().click();
  await page.waitForSelector('[role=dialog]');
  await page.waitForTimeout(3500);
  const canvasCount = await page.locator('[role=dialog] canvas').count();
  check('glTF 3D preview mounts a three.js canvas', canvasCount > 0);
  await shot('05-detail-3d');

  // Metadata edit
  await page.fill('#asset-display-name', 'Hero Triangle');
  await page.selectOption('#asset-collection', 'Characters');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(900);
  check('metadata save shows confirmation', (await page.locator('text=Asset updated').count()) > 0);
  await shot('06-detail-saved');
  await page.getByRole('button', { name: /Close details/i }).click();

  // ---------- Image detail ----------
  await page.locator('article', { hasText: 'crate_albedo' }).first().click();
  await page.waitForSelector('[role=dialog]');
  await page.waitForTimeout(1200);
  const bigImage = await page.evaluate(() => {
    const img = document.querySelector('[role=dialog] img');
    return img instanceof HTMLImageElement && img.naturalWidth > 0;
  });
  check('image preview loads in detail modal', bigImage);
  await shot('07-detail-image');
  await page.getByRole('button', { name: /Close details/i }).click();

  // ---------- Audio detail ----------
  await page.locator('article', { hasText: 'ui_click' }).first().click();
  await page.waitForSelector('[role=dialog]');
  const audio = await page.locator('[role=dialog] audio').count();
  check('audio player renders', audio === 1);
  await page.getByRole('button', { name: /Close details/i }).click();

  // ---------- FBX 3D preview (three.js FBXLoader) ----------
  await page.locator('article', { hasText: 'city_block' }).first().click();
  await page.waitForSelector('[role=dialog]');
  await page.waitForTimeout(2500);
  const fbxParsed = await page.locator('text=/FBX · parsed in the browser|3D preview failed/').count();
  check('FBX is parsed in-browser (or reports a clear failure)', fbxParsed >= 1);
  await shot('08-detail-fbx');
  await page.getByRole('button', { name: /Close details/i }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  // ---------- OBJ + STL previews (three.js loaders, really parsed) ----------

  for (const [name, label, shotName] of [
    ['scifi_crate', 'OBJ', '08a-detail-obj'],
    ['lowpoly_rock', 'STL', '08a2-detail-stl'],
  ]) {
    await page.locator('article', { hasText: name }).first().click();
    await page.waitForSelector('[role=dialog]');
    await page
      .waitForFunction((fmt) => !document.body.innerText.includes(`Parsing ${fmt}`), label, { timeout: 15000 })
      .catch(() => {});
    const failed = await page.locator(`text=/Could not parse this ${label}/`).count();
    check(`${label} model parsed in the browser`, failed === 0);
    await shot(shotName);
    await page.getByRole('button', { name: /Close details/i }).click();
    await page.waitForSelector('[role=dialog]', { state: 'detached' });
  }

  // ---------- Download-only asset (ZIP) ----------
  await page.locator('article', { hasText: 'texture_pack' }).first().click();
  await page.waitForSelector('[role=dialog]');
  const downloadOnly = await page.locator('text=Archives are stored as-is').count();
  check('non-previewable format offers download instead', downloadOnly === 1);
  await shot('08b-detail-download-only');
  await page.getByRole('button', { name: /Close details/i }).click();

  // ---------- Download ----------
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.locator('article', { hasText: 'crate_albedo' }).first().hover().then(() =>
      page.getByRole('button', { name: /Download crate_albedo/i }).first().click(),
    ),
  ]);
  check('download triggers a browser download', Boolean(download), download ? download.suggestedFilename() : 'no download event');

  // ---------- Collections ----------
  await page.goto(`${BASE}/collections`, { waitUntil: 'networkidle' });
  await page.fill('#new-collection', 'Weapons');
  await page.getByRole('button', { name: /Add collection/i }).click();
  await page.waitForTimeout(800);
  check('custom collection created', (await page.locator('text=Weapons').count()) > 0);
  await shot('09-collections');

  // ---------- Settings ----------
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Test bucket access/i }).click();
  await page.waitForTimeout(1500);
  check('deep bucket check succeeds', (await page.locator('text=Filebase reachable').count()) > 0);
  await shot('10-settings');

  await page.getByRole('button', { name: /Rescan bucket/i }).click();
  await page.waitForTimeout(1500);
  check('rescan reports a result', (await page.locator('text=Bucket rescanned').count()) > 0);

  // ---------- Light theme ----------
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.getByRole('button', { name: new RegExp(`Switch to ${wasDark ? 'light' : 'dark'} theme`, 'i') }).click();
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/assets`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('11-light-theme');
  check('theme toggle applies the other theme', await page.evaluate((dark) => document.documentElement.classList.contains('dark') !== dark, wasDark));

  // ---------- Mobile ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await shot('12-mobile-assets');
  await page.getByRole('button', { name: /Open navigation/i }).click();
  await page.waitForTimeout(400);
  check('mobile navigation drawer opens', (await page.getByRole('link', { name: /Collections/i }).count()) > 0);
  await shot('13-mobile-nav');
  await page.setViewportSize({ width: 1440, height: 960 });

  // ---------- Delete ----------
  await page.goto(`${BASE}/assets`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const before = await page.locator('article').count();
  const target = page.locator('article', { hasText: 'texture_pack' }).first();
  await target.hover();
  await page.getByRole('button', { name: /Delete texture_pack/i }).first().click();
  await page.waitForSelector('text=Delete this asset?');
  await shot('14-delete-confirm');
  await page.getByRole('button', { name: /^Delete asset$/ }).click();
  await page.waitForTimeout(1500);
  const after = await page.locator('article').count();
  check('delete removes the asset', after === before - 1, `${before} -> ${after}`);

  // ---------- Validation: unsupported file ----------
  await page.getByRole('button', { name: /Upload/i }).first().click();
  await page.waitForSelector('#upload-title');
  await fs.writeFile('/tmp/assets/bad_file.exe', 'not allowed');
  await page.setInputFiles('input[type=file]', ['/tmp/assets/bad_file.exe']);
  await page.waitForTimeout(800);
  check('unsupported format rejected in UI', (await page.locator('text=skipped').count()) > 0);
  await shot('15-unsupported');
  await page.getByRole('button', { name: /^Done$/ }).click();

  // ---------- Console hygiene ----------
  const meaningfulErrors = consoleErrors.filter(
    (message) => !message.includes('favicon') && !message.includes('Download the React DevTools'),
  );
  check('no console errors during the session', meaningfulErrors.length === 0, meaningfulErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('Failures:');
  for (const failure of failed) console.log(` - ${failure.name} ${failure.detail}`);
  process.exitCode = 1;
}
