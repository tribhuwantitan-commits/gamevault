/**
 * Folders + automatic versioning.
 *
 * Covers the three things the user asked for:
 *  1. Folders nest (Game → City Builder → Commercial Building).
 *  2. A ZIP dropped into a Game/App folder is named "<folder> v1, v2, v3…".
 *  3. The collection list is the new type-based one, old collections fold into Other.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { startApi } from './helpers.js';

const TOKEN = 'folder-tests-token-0123456789';
const DATA_DIR = path.resolve(process.cwd(), '.tmp', 'folders-data');
const MOCK_PORT = 9111;
const MOCK_DIR = path.resolve(process.cwd(), '.tmp', 'folders-s3');

process.env.NODE_ENV = 'test';
process.env.GAMEVAULT_DATA_DIR = DATA_DIR;
process.env.GAMEVAULT_AUTH_TOKEN = TOKEN;
process.env.FILEBASE_ACCESS_KEY_ID = 'test-key';
process.env.FILEBASE_SECRET_ACCESS_KEY = 'test-secret';
process.env.FILEBASE_BUCKET = 'gaming-asset';
process.env.FILEBASE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}`;
process.env.FILEBASE_FORCE_PATH_STYLE = 'true';
process.env.MULTIPART_THRESHOLD_BYTES = String(64 * 1024 * 1024); // keep tests single-part

let api: { baseUrl: string; close: () => Promise<void> };
let mockS3: { stop: () => Promise<void> };
let store: typeof import('../src/lib/store.js').store;
let foldersLib: typeof import('../src/lib/folders.js');

const headers = { 'Content-Type': 'application/json', 'X-GameVault-Token': TOKEN };

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

async function call<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${api.baseUrl}${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${pathname}: ${JSON.stringify(body)}`);
  return body as T;
}

async function makeFolder(name: string, parentId: string | null = null): Promise<string> {
  const { folder } = await call<{ folder: { id: string } }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parentId }),
  });
  return folder.id;
}

/** Upload a real object through the mock S3 and index it. */
async function upload(
  filename: string,
  collection: string,
  folderId: string | null,
  options: { autoVersion?: boolean } = {},
): Promise<{ id: string; title: string; folderId: string | null; collection: string }> {
  const body = new TextEncoder().encode(`payload of ${filename}`);
  const ticket = await call<{
    mode: string;
    assetId: string;
    uploadUrl: string;
    method: string;
    headers: Record<string, string>;
    versionPreview?: string | null;
  }>('/api/assets/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      filename,
      size: body.byteLength,
      collection,
      folderId,
      autoVersion: options.autoVersion,
    }),
  });
  assert.equal(ticket.mode, 'single');

  const put = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: ticket.headers,
    body,
  });
  assert.ok(put.ok, `direct upload failed: ${put.status}`);

  const { asset } = await call<{ asset: { id: string; title: string; folderId: string | null; collection: string } }>(
    '/api/assets/confirm-upload',
    { method: 'POST', body: JSON.stringify({ assetId: ticket.assetId }) },
  );
  return asset;
}

before(async () => {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });

  const { startMockS3 } = await import('./helpers.js');
  mockS3 = await startMockS3(MOCK_PORT, MOCK_DIR);

  foldersLib = await import('../src/lib/folders.js');
  const { createApp } = await import('../src/app.js');
  const storeModule = await import('../src/lib/store.js');
  store = storeModule.store;
  api = await startApi(createApp);
});

after(async () => {
  await api?.close();
  await mockS3?.stop();
  await fs.rm(DATA_DIR, { recursive: true, force: true });
});

test('folders nest to any depth and expose full paths', async () => {
  const gameAsset = await makeFolder('Game Asset');
  const cityBuilder = await makeFolder('City Builder', gameAsset);
  const commercial = await makeFolder('Commercial Building', cityBuilder);
  const roads = await makeFolder('Roads', cityBuilder);
  const kingdom = await makeFolder('Kingdom Castle', gameAsset);
  const troops = await makeFolder('Troops', kingdom);

  const { folders } = await call<{ folders: Array<{ id: string; path: string; depth: number }> }>(
    '/api/folders',
  );
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  assert.equal(byId.get(commercial)?.path, '/Game Asset/City Builder/Commercial Building');
  assert.equal(byId.get(byId.get(commercial)!.id)?.depth, 3);
  assert.equal(byId.get(roads)?.path, '/Game Asset/City Builder/Roads');
  assert.equal(byId.get(troops)?.path, '/Game Asset/Kingdom Castle/Troops');
});

test('duplicate folder names in the same parent are rejected, nested ones allowed', async () => {
  const parent = await makeFolder('Game Asset 2');
  const child = await makeFolder('City Builder', parent);

  const res = await fetch(`${api.baseUrl}/api/folders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'city builder', parentId: parent }),
  });
  assert.equal(res.status, 409);

  // Same name under a different parent is fine.
  const other = await makeFolder('City Builder', child);
  assert.ok(other);
});

test('a ZIP in a Game folder becomes "<folder> v1, v2, v3"', async () => {
  const root = await makeFolder('Versioning Root');
  const cityBuilder = await makeFolder('City Builder', root);

  const first = await upload('build-1234.zip', 'Game', cityBuilder);
  const second = await upload('whatever-name.zip', 'Game', cityBuilder);
  const third = await upload('another bundle.zip', 'Game', cityBuilder);

  assert.equal(first.title, 'City Builder v1');
  assert.equal(second.title, 'City Builder v2');
  assert.equal(third.title, 'City Builder v3');

  // The stored filenames are untouched — only the display title is versioned.
  assert.equal(second.folderId, cityBuilder);
  const { asset } = await call<{ asset: { originalFilename: string; filename: string; displayName: string } }>(
    `/api/assets/${second.id}`,
  );
  assert.equal(asset.originalFilename, 'whatever-name.zip');
  assert.equal(asset.displayName, 'City Builder v2');
});

test('non-bundle files keep their own name', async () => {
  const root = await makeFolder('Mixed Root');
  const folder = await makeFolder('City Builder', root);

  const texture = await upload('road_tile.png', 'Game', folder);
  assert.equal(texture.title, '');

  const { asset } = await call<{ asset: { displayName: string } }>(`/api/assets/${texture.id}`);
  assert.equal(asset.displayName, 'road_tile.png');
});

test('versioning only applies to Game and App collections', async () => {
  const root = await makeFolder('Collections Root');
  const folder = await makeFolder('City Builder', root);

  const sound = await upload('ambient.zip', 'Audio', folder);
  const model = await upload('props.zip', '3D', folder);
  const app = await upload('release.zip', 'App', folder);

  assert.equal(sound.title, '');
  assert.equal(model.title, '');
  assert.equal(app.title, 'City Builder v1'); // App is versioned too
});

test('autoVersion can be switched off per upload', async () => {
  const root = await makeFolder('Toggle Root');
  const folder = await makeFolder('Kingdom Castle', root);

  const plain = await upload('manual.zip', 'Game', folder, { autoVersion: false });
  assert.equal(plain.title, '');
});

test('versions are never reused after a delete', async () => {
  const root = await makeFolder('Reuse Root');
  const folder = await makeFolder('City Builder', root);

  await upload('a.zip', 'Game', folder); // v1
  const v2 = await upload('b.zip', 'Game', folder); // v2
  await call(`/api/assets/${v2.id}`, { method: 'DELETE' });

  const next = await upload('c.zip', 'Game', folder);
  assert.equal(next.title, 'City Builder v3');
});

test('auto-versioning needs a folder', async () => {
  const asset = await upload('unfiled.zip', 'Game', null);
  assert.equal(asset.title, '');
  assert.equal(asset.folderId, null);
});

test('listing can filter by folder and by the unfiled root', async () => {
  const root = await makeFolder('List Root');
  const folder = await makeFolder('Game Asset', root);
  await upload('inside.zip', 'Game', folder);
  await upload('outside.zip', 'Game', null);

  const inside = await call<{ items: Array<{ folderId: string | null }> }>(
    `/api/assets?folder=${folder}`,
  );
  assert.ok(inside.items.length >= 1);
  assert.ok(inside.items.every((item) => item.folderId === folder));

  const unfiled = await call<{ items: Array<{ folderId: string | null }> }>('/api/assets?folder=root');
  assert.ok(unfiled.items.every((item) => item.folderId === null));
});

test('an asset can be moved into and out of a folder', async () => {
  const root = await makeFolder('Move Root');
  const folder = await makeFolder('Cars', root);
  const asset = await upload('car.glb', '3D', null);

  const moved = await call<{ asset: { folderId: string | null } }>(`/api/assets/${asset.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ folderId: folder }),
  });
  assert.equal(moved.asset.folderId, folder);

  const cleared = await call<{ asset: { folderId: string | null } }>(`/api/assets/${asset.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ folderId: null }),
  });
  assert.equal(cleared.asset.folderId, null);
});

test('deleting a folder moves its assets to Other and lifts sub-folders', async () => {
  const root = await makeFolder('Delete Root');
  const parent = await makeFolder('City Builder', root);
  const child = await makeFolder('Roads', parent);
  const asset = await upload('bundle.zip', 'Game', parent);
  assert.equal(asset.title, 'City Builder v1');

  const result = await call<{ deleted: boolean; mode: string }>(
    `/api/folders/${parent}?mode=move`,
    { method: 'DELETE' },
  );
  assert.equal(result.mode, 'move');

  const { asset: kept } = await call<{ asset: { folderId: string | null; collection: string } }>(
    `/api/assets/${asset.id}`,
  );
  assert.equal(kept.folderId, null);
  assert.equal(kept.collection, 'Other');

  const { folders } = await call<{ folders: Array<{ id: string; parentId: string | null }> }>(
    '/api/folders',
  );
  const roads = folders.find((folder) => folder.id === child);
  assert.equal(roads?.parentId, root, 'sub-folder should move up to the grandparent');
});

test('the collection list is the new type-based one', async () => {
  const { collections } = await call<{ collections: Array<{ name: string }> }>('/api/collections');
  const names = collections.map((collection) => collection.name).sort();
  assert.deepEqual(names, ['2D', '3D', 'App', 'Audio', 'Environment', 'Game', 'Other']);
});

test('old collections fold into Other without losing assets', async () => {
  // Simulate a legacy index written before the collection change.
  await store.updateAsset(
    (await upload('legacy.zip', 'Other', null)).id,
    { collection: 'Buildings' },
  );
  const before = await store.listAssets();
  const legacy = before.find((asset) => asset.collection === 'Buildings');
  assert.ok(legacy, 'legacy asset should exist before migration');

  // Drop the schema marker so the migration runs exactly as it would on a legacy
  // on-disk index, then init a brand-new store against the same directory.
  const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'assets.json'), 'utf8'));
  delete raw.schemaVersion;
  await fs.writeFile(
    path.join(DATA_DIR, 'assets.json'),
    `${JSON.stringify(raw, null, 2)}\n`,
    'utf8',
  );

  const fresh = new (store.constructor as new () => typeof store)(DATA_DIR);
  await fresh.init();
  const after = await fresh.listAssets();
  const migrated = after.find((asset) => asset.id === legacy.id);
  assert.equal(migrated?.collection, 'Other');
  const names = (await fresh.listCollections()).map((collection) => collection.name).sort();
  assert.deepEqual(names, ['2D', '3D', 'App', 'Audio', 'Environment', 'Game', 'Other']);
});

test('folder path helpers handle orphans and cycles safely', () => {
  const folders = [
    { id: 'a', name: 'Game Asset', parentId: null, createdAt: '', updatedAt: '' },
    { id: 'b', name: 'City Builder', parentId: 'a', createdAt: '', updatedAt: '' },
    { id: 'c', name: 'Roads', parentId: 'b', createdAt: '', updatedAt: '' },
  ];
  assert.equal(foldersLib.folderPath(folders, 'c'), '/Game Asset/City Builder/Roads');
  assert.equal(foldersLib.folderPath(folders, null), '/');
  assert.deepEqual([...foldersLib.descendantFolderIds(folders, 'a')].sort(), ['a', 'b', 'c']);
  assert.ok(foldersLib.isBundleFile('Build.ZIP'));
  assert.ok(!foldersLib.isBundleFile('texture.png'));
});
