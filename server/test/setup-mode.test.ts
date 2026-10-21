/**
 * The app must start and stay usable when Filebase credentials are absent —
 * a clear setup state, not a crash, and never a simulated upload.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { startApi } from './helpers.js';

const DATA_DIR = path.resolve(process.cwd(), '.tmp', 'setup-data');
let api: { baseUrl: string; close: () => Promise<void> };

before(async () => {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.GAMEVAULT_DATA_DIR = DATA_DIR;
  process.env.GAMEVAULT_AUTH_TOKEN = '';
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

test('health reports setup_required without credentials', async () => {
  const response = await fetch(`${api.baseUrl}/api/health`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'setup_required');
  assert.equal(body.storage.configured, false);
  assert.equal(body.authRequired, false);
  assert.ok(!JSON.stringify(body).includes('SECRET'), 'health must not echo secrets');
});

test('capabilities explains how to finish setup', async () => {
  const response = await fetch(`${api.baseUrl}/api/capabilities`);
  const body = await response.json();
  assert.equal(body.storageConfigured, false);
  assert.ok(body.setupInstructions.length >= 2);
  assert.ok(body.supportedExtensions.includes('glb'));
});

test('reading an empty library works, uploading fails loudly', async () => {
  const list = await fetch(`${api.baseUrl}/api/assets`);
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.total, 0);
  assert.equal(body.items.length, 0);

  const upload = await fetch(`${api.baseUrl}/api/assets/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'sword.png', size: 1024 }),
  });
  assert.equal(upload.status, 503);
  const error = await upload.json();
  assert.equal(error.error.code, 'storage_not_configured');

  const rescan = await fetch(`${api.baseUrl}/api/assets/rescan`, { method: 'POST' });
  assert.equal(rescan.status, 503);

  // Validation still runs before storage is touched.
  const badType = await fetch(`${api.baseUrl}/api/assets/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'x.exe', size: 10 }),
  });
  assert.equal(badType.status, 415);
});
