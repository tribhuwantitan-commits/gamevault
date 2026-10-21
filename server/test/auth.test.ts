/**
 * Token-gate tests. `config` is read at import time, so this file runs in its own
 * process (node --test spawns one per file) with GAMEVAULT_AUTH_TOKEN set.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { startApi } from './helpers.js';

const TOKEN = 'test-token-0123456789abcdef';
const DATA_DIR = path.resolve(process.cwd(), '.tmp', 'auth-data');
let api: { baseUrl: string; close: () => Promise<void> };

before(async () => {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.GAMEVAULT_DATA_DIR = DATA_DIR;
  process.env.GAMEVAULT_AUTH_TOKEN = TOKEN;
  process.env.FILEBASE_ACCESS_KEY_ID = '';
  process.env.FILEBASE_SECRET_ACCESS_KEY = '';
  process.env.FILEBASE_BUCKET = 'gaming-asset';
  process.env.FILEBASE_ENDPOINT = 'https://s3.filebase.io';

  const { createApp } = await import('../src/app.js');
  api = await startApi(createApp);
});

after(async () => {
  await api?.close();
  await fs.rm(path.resolve(process.cwd(), '.tmp'), { recursive: true, force: true });
});

test('health and capabilities stay public so the UI can boot', async () => {
  const health = await fetch(`${api.baseUrl}/api/health`);
  assert.equal(health.status, 503); // setup mode: no credentials
  const body = await health.json();
  assert.equal(body.status, 'setup_required');
  assert.equal(body.authRequired, true);

  const caps = await fetch(`${api.baseUrl}/api/capabilities`);
  assert.equal(caps.status, 200);
  const capsBody = await caps.json();
  assert.equal(capsBody.authRequired, true);
  assert.equal(capsBody.storageConfigured, false);
  assert.ok(Array.isArray(capsBody.setupInstructions));
});

test('asset endpoints require the token', async () => {
  const anonymous = await fetch(`${api.baseUrl}/api/assets`);
  assert.equal(anonymous.status, 401);
  const body = await anonymous.json();
  assert.equal(body.error.code, 'unauthorized');

  const wrong = await fetch(`${api.baseUrl}/api/assets`, {
    headers: { 'X-GameVault-Token': 'nope' },
  });
  assert.equal(wrong.status, 401);

  const wrongBearer = await fetch(`${api.baseUrl}/api/assets`, {
    headers: { Authorization: 'Bearer nope' },
  });
  assert.equal(wrongBearer.status, 401);

  const good = await fetch(`${api.baseUrl}/api/assets`, {
    headers: { 'X-GameVault-Token': TOKEN },
  });
  assert.equal(good.status, 200);
  const list = await good.json();
  assert.equal(list.total, 0);

  const bearer = await fetch(`${api.baseUrl}/api/collections`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(bearer.status, 200);

  // Mutating endpoints are gated too.
  const deleteAttempt = await fetch(
    `${api.baseUrl}/api/assets/3f0c8f4e-4a3f-4f0d-9f3b-2b1a1c1d1e1f`,
    { method: 'DELETE' },
  );
  assert.equal(deleteAttempt.status, 401);
});
