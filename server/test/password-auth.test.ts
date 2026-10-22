/**
 * Password login + session tests.
 *
 * The API token path (GAMEVAULT_AUTH_TOKEN) must keep working exactly as before;
 * the new password flow issues a signed HttpOnly cookie instead.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { startApi } from './helpers.js';

const PASSWORD = 'correct horse battery staple';
/**
 * Precomputed with 60,000 iterations (fast for tests, same format as production).
 * Hard-coded because `config` is evaluated on first import — the env must be set
 * before any module import, so the hash cannot be derived inside `before()`.
 */
const PASSWORD_HASH =
  'pbkdf2$sha256$60000$fn5mcqkDJ-H0s8gO0jD1fQ$6j-IMI02cE5nv758vLO4H171oAiLD5-vuYEKtM6fApI';
const TOKEN = 'api-token-for-scripts-0123456789';
const DATA_DIR = path.resolve(process.cwd(), '.tmp', 'password-auth-data');

let api: { baseUrl: string; close: () => Promise<void> };
let passwordLib: typeof import('../src/lib/password.js');

const form = (cookie?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return headers;
};

const login = async (password: string) => {
  const res = await fetch(`${api.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, body: await res.json().catch(() => null), setCookie };
};

/** Extract the `name=value` part of the session cookie. */
const cookiePair = (setCookie: string[]): string => {
  const raw = setCookie.find((c) => c.startsWith('gv_session=')) ?? '';
  return raw.split(';')[0] ?? '';
};

// Environment must be set BEFORE any project module is imported, because config
// is read once at module load.
process.env.NODE_ENV = 'test';
process.env.GAMEVAULT_DATA_DIR = DATA_DIR;
process.env.GAMEVAULT_AUTH_TOKEN = TOKEN;
process.env.GAMEVAULT_PASSWORD_HASH = PASSWORD_HASH;
process.env.GAMEVAULT_COOKIE_SECURE = 'false';
process.env.FILEBASE_ACCESS_KEY_ID = '';
process.env.FILEBASE_SECRET_ACCESS_KEY = '';

before(async () => {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });

  passwordLib = await import('../src/lib/password.js');
  const { createApp } = await import('../src/app.js');
  api = await startApi(createApp);
});

after(async () => {
  await api?.close();
  await fs.rm(path.resolve(process.cwd(), '.tmp'), { recursive: true, force: true });
});

test('session endpoint is public and never leaks the hash or token', async () => {
  const res = await fetch(`${api.baseUrl}/api/auth/session`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.authenticated, false);
  assert.equal(body.passwordLoginEnabled, true);
  assert.equal(body.ttlSeconds, 24 * 3600);

  const text = JSON.stringify(body);
  assert.ok(!text.includes('pbkdf2'), 'hash scheme must not be exposed');
  assert.ok(!text.includes(TOKEN), 'API token must not be exposed');

  const caps = await (await fetch(`${api.baseUrl}/api/capabilities`)).json();
  assert.equal(caps.passwordLoginEnabled, true);
  assert.ok(!JSON.stringify(caps).includes('pbkdf2'), 'capabilities must not expose the hash');
});

test('wrong password is rejected without a session cookie', async () => {
  const res = await login('wrong password entirely');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'invalid_password');
  assert.equal(cookiePair(res.setCookie), '', 'no session cookie on failure');
});

test('too-short password is rejected', async () => {
  const res = await login('short');
  assert.equal(res.status, 401);
});

test('correct password issues a hardened session cookie', async () => {
  const res = await login(PASSWORD);
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, true);
  assert.ok(res.body.expiresAt);

  const raw = res.setCookie.find((c) => c.startsWith('gv_session=')) ?? '';
  assert.ok(raw.length > 0, 'session cookie must be set');
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Strict/i);
  assert.match(raw, /Path=\//);
  assert.match(raw, /Max-Age=86400/, 'cookie lifetime is 24h');
  assert.ok(!raw.includes(PASSWORD), 'cookie must not contain the password');
});

test('session cookie authorises the API; no cookie does not', async () => {
  const res = await login(PASSWORD);
  const cookie = cookiePair(res.setCookie);

  const withoutCookie = await fetch(`${api.baseUrl}/api/assets`);
  assert.equal(withoutCookie.status, 401);

  const withCookie = await fetch(`${api.baseUrl}/api/assets`, { headers: form(cookie) });
  assert.equal(withCookie.status, 200);
  const list = await withCookie.json();
  assert.equal(list.total, 0);

  // Session endpoint now reports authenticated.
  const session = await fetch(`${api.baseUrl}/api/auth/session`, { headers: form(cookie) });
  assert.equal((await session.json()).authenticated, true);
});

test('the long-lived API token still works unchanged', async () => {
  const header = await fetch(`${api.baseUrl}/api/assets`, {
    headers: { 'X-GameVault-Token': TOKEN },
  });
  assert.equal(header.status, 200);

  const bearer = await fetch(`${api.baseUrl}/api/collections`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(bearer.status, 200);

  const wrong = await fetch(`${api.baseUrl}/api/assets`, {
    headers: { 'X-GameVault-Token': 'nope' },
  });
  assert.equal(wrong.status, 401);
});

test('tampered or forged cookies are rejected', async () => {
  const res = await login(PASSWORD);
  const cookie = cookiePair(res.setCookie);
  const [name, value] = cookie.split('=');

  // Flip a character in the signature.
  const tampered = `${name}=${value.slice(0, -3)}AAA`;
  const tamperedRes = await fetch(`${api.baseUrl}/api/assets`, { headers: form(tampered) });
  assert.equal(tamperedRes.status, 401);

  // Correctly-shaped but unsigned payload.
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: Date.now(), exp: Date.now() + 1e6 }))
    .toString('base64url');
  const forged = `${name}=${payload}.${'a'.repeat(43)}`;
  assert.equal((await fetch(`${api.baseUrl}/api/assets`, { headers: form(forged) })).status, 401);
});

test('expired sessions are rejected (24h inactivity)', async () => {
  const now = Date.now();
  const expired = passwordLib.signSession({ v: 1, iat: now - 25 * 3600_000, exp: now - 3600_000 });
  const res = await fetch(`${api.baseUrl}/api/assets`, {
    headers: form(`gv_session=${encodeURIComponent(expired)}`),
  });
  assert.equal(res.status, 401);

  // Still inside the window: accepted.
  const fresh = passwordLib.signSession({ v: 1, iat: now - 3600_000, exp: now + 3600_000 });
  const ok = await fetch(`${api.baseUrl}/api/assets`, {
    headers: form(`gv_session=${encodeURIComponent(fresh)}`),
  });
  assert.equal(ok.status, 200);
});

test('logout clears the cookie', async () => {
  const res = await login(PASSWORD);
  const cookie = cookiePair(res.setCookie);

  const out = await fetch(`${api.baseUrl}/api/auth/logout`, { method: 'POST', headers: form(cookie) });
  assert.equal(out.status, 204);
  const cleared = (out.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('gv_session=')) ?? '';
  assert.match(cleared, /Max-Age=0/);
});

test('login is rate limited', async () => {
  let limited = false;
  for (let i = 0; i < 12; i += 1) {
    const res = await login('definitely wrong password');
    if (res.status === 429) {
      limited = true;
      break;
    }
  }
  assert.ok(limited, 'repeated failed logins must eventually return 429');
});

test('password hash parser rejects garbage and supports round-trip', async () => {
  const hash = await passwordLib.hashPassword('another-secret', 60_000);
  assert.ok(passwordLib.isSupportedPasswordHash(hash));
  assert.equal(await passwordLib.verifyPassword('another-secret', hash), true);
  assert.equal(await passwordLib.verifyPassword('nope', hash), false);
  assert.equal(passwordLib.isSupportedPasswordHash('plain-text-password'), false);
  assert.equal(passwordLib.isSupportedPasswordHash('pbkdf2$sha256$abc$x$y'), false);
  assert.equal(await passwordLib.verifyPassword('x', 'not-a-hash'), false);
});
