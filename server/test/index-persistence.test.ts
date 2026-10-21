/**
 * Verifies the optional bucket-backed metadata mirror (GAMEVAULT_INDEX_OBJECT),
 * which is what makes a disk-less host (e.g. Render Free) usable: the index is
 * stored inside the bucket, outside the `assets/` prefix, and restored on boot.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { startMockS3, type MockS3 } from './helpers.js';

const MOCK_PORT = 9138;
const TMP = path.resolve(process.cwd(), '.tmp', 'index-persistence');
const S3_DIR = path.join(TMP, 's3');
const DIR_A = path.join(TMP, 'disk-a');
const DIR_B = path.join(TMP, 'disk-b'); // simulates a fresh container with an empty disk
const INDEX_KEY = '_gamevault/index.json';

let mock: MockS3;
let storeModule: typeof import('../src/lib/store.js');

const asset = {
  id: '11111111-1111-4111-8111-111111111111',
  key: `assets/11111111-1111-4111-8111-111111111111/sword.png`,
  filename: 'sword.png',
  originalFilename: 'sword.png',
  title: 'Iron sword',
  size: 68,
  contentType: 'image/png',
  kind: 'image' as const,
  extension: 'png',
  collection: 'Weapons',
  tags: ['iron', 'melee'],
  description: 'kept across restarts',
  uploadedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

before(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(DIR_A, { recursive: true });
  mock = await startMockS3(MOCK_PORT, S3_DIR);

  process.env.NODE_ENV = 'test';
  process.env.FILEBASE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}`;
  process.env.FILEBASE_ACCESS_KEY_ID = 'test-key';
  process.env.FILEBASE_SECRET_ACCESS_KEY = 'test-secret';
  process.env.FILEBASE_BUCKET = 'gaming-asset';
  process.env.GAMEVAULT_DATA_DIR = DIR_A;
  process.env.GAMEVAULT_INDEX_OBJECT = INDEX_KEY;
  process.env.GAMEVAULT_AUTH_TOKEN = '';

  storeModule = await import('../src/lib/store.js');
});

after(async () => {
  await mock?.stop();
  await fs.rm(TMP, { recursive: true, force: true });
});

test('index mirror is written to the bucket and restored on a fresh disk', async () => {
  const { store } = storeModule;
  await store.init();
  await store.commitAsset(asset);

  // Debounced write -> force it now.
  await store.flushRemoteIndex();

  const response = await fetch(`http://127.0.0.1:${MOCK_PORT}/gaming-asset/${INDEX_KEY}`);
  assert.equal(response.status, 200, 'index object must exist in the bucket');
  const mirrored = await response.json();
  assert.equal(mirrored.assets.length, 1);
  assert.equal(mirrored.assets[0].title, 'Iron sword');
  assert.deepEqual(mirrored.assets[0].tags, ['iron', 'melee']);

  // The mirror must live outside `assets/`, otherwise a rescan would index it as an asset.
  assert.ok(!INDEX_KEY.startsWith('assets/'), 'index object must not be under the assets/ prefix');

  // Simulate a redeploy on a host with no persistent disk: brand new empty data dir.
  const { MetadataStore } = storeModule;
  const fresh = new MetadataStore(DIR_B);
  await fresh.init();

  const restored = await fresh.listAssets();
  assert.equal(restored.length, 1, 'index must be restored from the bucket');
  assert.equal(restored[0]!.title, 'Iron sword', 'user metadata survives a restart');
  assert.deepEqual(restored[0]!.tags, ['iron', 'melee'], 'tags survive a restart');
  assert.equal(restored[0]!.collection, 'Weapons', 'collection survives a restart');

  // Collection names must come back too, so the sidebar is populated after a cold start.
  const names = await fresh.collectionNames();
  assert.ok(names.includes('Weapons'));
});

test('mirror is disabled when GAMEVAULT_INDEX_OBJECT is empty', async () => {
  // A store created without the env var never contacts storage for the index.
  const { MetadataStore } = storeModule;
  const offline = new MetadataStore(path.join(TMP, 'disk-c'));
  const before = mock.process.exitCode;
  await offline.init();
  assert.equal(mock.process.exitCode, before, 'mock storage process must stay untouched');
  assert.ok(Array.isArray(await offline.listAssets()));
});
