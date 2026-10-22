/**
 * Browser check for password login and the 24-hour inactivity auto-lock.
 *
 *   node e2e/login.mjs --base http://127.0.0.1:9420 --password 'your password'
 *   node e2e/login.mjs --base ... --password ... --lock   # also waits out a short TTL (~70 s)
 *
 * Requires a running GameVault with GAMEVAULT_PASSWORD_HASH set, plus playwright
 * (`npx playwright install chromium`). Not part of CI.
 */
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const BASE = arg('base', 'http://127.0.0.1:9420');
const PASSWORD = arg('password', '');
const RUN_LOCK_TEST = process.argv.includes('--lock');

if (!PASSWORD) {
  console.error('Pass --password <login password> (never commit it).');
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#login-password', { timeout: 15_000 });
check('login screen is shown when password login is enabled', true);
check('API token is not stored in the browser', (await page.evaluate(() => sessionStorage.getItem('gamevault.token'))) === null);

await page.fill('#login-password', 'definitely-not-the-password');
await page.click('button[type=submit]');
await page.waitForSelector('text=not correct', { timeout: 10_000 }).catch(() => {});
check('wrong password is rejected', (await page.locator('text=not correct').count()) > 0);
check('still locked after a wrong password', (await page.locator('#login-password').count()) === 1);

await page.fill('#login-password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('nav[aria-label="Main navigation"]', { state: 'attached', timeout: 20_000 });
check('correct password unlocks the app', true);

const session = (await page.context().cookies()).find((cookie) => cookie.name === 'gv_session');
check('session cookie is HttpOnly', Boolean(session?.httpOnly));
check('session cookie is SameSite=Strict', session?.sameSite === 'Strict');
check('session cookie is invisible to JavaScript', (await page.evaluate(() => document.cookie)) === '');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('nav[aria-label="Main navigation"]', { state: 'attached', timeout: 15_000 });
check('reload stays unlocked', true);

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.click('text=Lock now');
await page.waitForSelector('#login-password', { timeout: 15_000 });
check('Lock now returns to the login screen', true);
check('locked browser gets 401 from the API', (await page.evaluate(async () => (await fetch('/api/assets')).status)) === 401);

check('no uncaught page errors', errors.length === 0, errors.join('; '));

if (RUN_LOCK_TEST) {
  // Mock only the TTL the UI reads, so the real timer runs in ~70 s instead of 24 h.
  const lockPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await lockPage.route('**/api/capabilities', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.sessionTtlSeconds = 60;
    await route.fulfill({ response, json: body });
  });
  await lockPage.goto(BASE, { waitUntil: 'networkidle' });
  await lockPage.fill('#login-password', PASSWORD);
  await lockPage.click('button[type=submit]');
  await lockPage.waitForSelector('nav[aria-label="Main navigation"]', { state: 'attached', timeout: 20_000 });
  const started = Date.now();
  await lockPage.waitForSelector('#login-password', { timeout: 150_000 });
  check(`idle session auto-locks (~${Math.round((Date.now() - started) / 1000)}s)`, true);
  const left = (await lockPage.context().cookies()).some((cookie) => cookie.name === 'gv_session');
  check('cookie is cleared on auto-lock', !left);
}

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
