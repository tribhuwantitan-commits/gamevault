/**
 * End-to-end API tests.
 *
 * These run against a local S3-compatible server (dev/mock-s3.mjs) so the real
 * upload -> verify -> download -> delete path is exercised over HTTP. The
 * Filebase endpoint itself is NOT contacted here — it needs real credentials.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { makeBytes, startApi, startMockS3, type MockS3 } from './helpers.js';

const MOCK_PORT = 9137;
const TMP = path.resolve(process.cwd(), '.tmp');
const DATA_DIR = path.join(TMP, 'data');
const S3_DIR = path.join(TMP, 's3');

let mock: MockS3;
let api: { baseUrl: string; close: () => Promise<void> };

const json = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
};

const post = (url: string, body?: unknown) =>
  json(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** upload-url -> direct PUT -> confirm-upload */
async function uploadAsset(
  baseUrl: string,
  filename: string,
  bytes: Buffer,
  options: { collection?: string; tags?: string[] } = {},
): Promise<{ assetId: string; asset: any }> {
  const ticket = await post(`${baseUrl}/api/assets/upload-url`, {
    filename,
    size: bytes.length,
    collection: options.collection,
    tags: options.tags,
  });
  assert.equal(ticket.status, 201, JSON.stringify(ticket.body));
  assert.equal(ticket.body.mode, 'single');

  const put = await fetch(ticket.body.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': ticket.body.contentType },
    body: bytes,
  });
  assert.ok([200, 201, 204].includes(put.status), `PUT failed: ${put.status}`);

  const confirm = await post(`${baseUrl}/api/assets/confirm-upload`, { assetId: ticket.body.assetId });
  assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
  return { assetId: ticket.body.assetId, asset: confirm.body.asset };
}

before(async () => {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  mock = await startMockS3(MOCK_PORT, S3_DIR);

  process.env.NODE_ENV = 'test';
  process.env.FILEBASE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}`;
  process.env.FILEBASE_ACCESS_KEY_ID = 'test-access-key';
  process.env.FILEBASE_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.FILEBASE_BUCKET = 'gaming-asset';
  process.env.GAMEVAULT_DATA_DIR = DATA_DIR;
  process.env.GAMEVAULT_AUTH_TOKEN = '';
  process.env.MAX_UPLOAD_BYTES = String(12 * 1024 * 1024);
  process.env.MULTIPART_THRESHOLD_BYTES = String(1 * 1024 * 1024);
  process.env.MULTIPART_PART_SIZE_BYTES = String(5 * 1024 * 1024);
  process.env.PRESIGN_DOWNLOAD_EXPIRES_SECONDS = '120';

  const { createApp } = await import('../src/app.js');
  api = await startApi(createApp);
});

after(async () => {
  await api?.close();
  await mock?.stop();
  await fs.rm(TMP, { recursive: true, force: true });
});

test('health reports a configured, reachable store', async () => {
  const health = await json(`${api.baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.storage.configured, true);
  assert.equal(health.body.storage.bucket, 'gaming-asset');

  const deep = await json(`${api.baseUrl}/api/health?storage=1`);
  assert.equal(deep.status, 200);
  assert.equal(deep.body.storage.checked, true);
  assert.equal(deep.body.storage.reachable, true);
});

test('unknown routes and malformed payloads produce structured errors', async () => {
  const missing = await json(`${api.baseUrl}/api/nope`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'not_found');

  const badJson = await fetch(`${api.baseUrl}/api/assets/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, 'invalid_json');

  const invalid = await post(`${api.baseUrl}/api/assets/upload-url`, { filename: '', size: -1 });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'validation_failed');

  const badId = await json(`${api.baseUrl}/api/assets/not-a-uuid/download`);
  assert.equal(badId.status, 400);

  const unknownAsset = await json(`${api.baseUrl}/api/assets/3f0c8f4e-4a3f-4f0d-9f3b-2b1a1c1d1e1f`);
  assert.equal(unknownAsset.status, 404);
  assert.equal(unknownAsset.body.error.code, 'asset_not_found');
});

test('capabilities advertises formats, limits and preview support', async () => {
  const caps = await json(`${api.baseUrl}/api/capabilities`);
  assert.equal(caps.status, 200);
  assert.equal(caps.body.storageConfigured, true);
  assert.equal(caps.body.authRequired, false);
  for (const ext of ['png', 'glb', 'fbx', 'blend', 'wav', 'mp4', 'zip']) {
    assert.ok(caps.body.supportedExtensions.includes(ext), `${ext} missing`);
  }
  assert.ok(caps.body.previewSupport.native.includes('png'));
  assert.ok(caps.body.previewSupport.threeD.includes('fbx'));
  assert.ok(caps.body.previewSupport.downloadOnly.includes('blend'));
  assert.ok(caps.body.defaultCollections.includes('Game'));
  assert.deepEqual(
    [...caps.body.defaultCollections].sort(),
    ['2D', '3D', 'App', 'Audio', 'Environment', 'Game', 'Other'],
  );
});

test('upload-url rejects unsupported formats, oversized files and sanitises names', async () => {
  const unsupported = await post(`${api.baseUrl}/api/assets/upload-url`, {
    filename: 'virus.exe',
    size: 1024,
  });
  assert.equal(unsupported.status, 415);
  assert.equal(unsupported.body.error.code, 'unsupported_file_type');

  const tooLarge = await post(`${api.baseUrl}/api/assets/upload-url`, {
    filename: 'huge.zip',
    size: 50 * 1024 * 1024,
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error.code, 'file_too_large');

  const traversal = await post(`${api.baseUrl}/api/assets/upload-url`, {
    filename: '../../../../etc/passwd.png',
    size: 64,
  });
  assert.equal(traversal.status, 201);
  assert.match(traversal.body.key, /^assets\/[0-9a-f-]{36}\/passwd\.png$/);
  assert.ok(!traversal.body.key.includes('..'));

  // An upload URL for an object that was never PUT must never be confirmed.
  const unconfirmed = await post(`${api.baseUrl}/api/assets/confirm-upload`, {
    assetId: traversal.body.assetId,
  });
  assert.equal(unconfirmed.status, 502);
  assert.equal(unconfirmed.body.error.code, 'upload_not_verified');
});

test('single-file upload round-trip: verify, list, download, patch, delete', async () => {
  const bytes = makeBytes(4096, 7);
  const { assetId, asset } = await uploadAsset(api.baseUrl, 'crate_albedo.png', bytes, {
    collection: '2D',
    tags: ['wood', 'crate'],
  });

  assert.equal(asset.id, assetId);
  assert.equal(asset.size, bytes.length);
  assert.equal(asset.collection, '2D');
  assert.deepEqual(asset.tags, ['wood', 'crate']);
  assert.equal(asset.extension, 'png');
  assert.equal(asset.kind, 'image');
  assert.equal(asset.previewable, true);

  const list = await json(`${api.baseUrl}/api/assets`);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].id, assetId);
  assert.equal(list.body.summary.totalAssets, 1);
  assert.equal(list.body.summary.totalBytes, bytes.length);

  // Presigned download URL really serves the bytes.
  const download = await json(`${api.baseUrl}/api/assets/${assetId}/download`);
  assert.equal(download.status, 200);
  assert.ok(download.body.url.includes(`/gaming-asset/assets/${assetId}/crate_albedo.png`));
  const fetched = await fetch(download.body.url);
  assert.equal(fetched.status, 200);
  const downloaded = Buffer.from(await fetched.arrayBuffer());
  assert.equal(downloaded.length, bytes.length);
  assert.ok(downloaded.equals(bytes), 'downloaded bytes must match what was uploaded');

  // Preview redirect is a 302 to a short-lived signed URL.
  const file = await fetch(`${api.baseUrl}/api/assets/${assetId}/file`, { redirect: 'manual' });
  assert.equal(file.status, 302);
  assert.ok(file.headers.get('location')?.includes('X-Amz-Signature') || file.headers.get('location')?.includes('Signature'));

  // Metadata edits
  const patched = await json(`${api.baseUrl}/api/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Wooden crate', tags: ['wood', 'crate', 'lowpoly'], collection: '3D' }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.asset.title, 'Wooden crate');
  assert.equal(patched.body.asset.displayName, 'Wooden crate');
  assert.equal(patched.body.asset.collection, '3D');
  assert.deepEqual(patched.body.asset.tags, ['wood', 'crate', 'lowpoly']);

  const badCollection = await json(`${api.baseUrl}/api/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection: 'Nope' }),
  });
  assert.equal(badCollection.status, 400);
  assert.equal(badCollection.body.error.code, 'unknown_collection');

  // Delete removes the object and the index entry.
  const deleted = await json(`${api.baseUrl}/api/assets/${assetId}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);

  const afterDelete = await json(`${api.baseUrl}/api/assets`);
  assert.equal(afterDelete.body.total, 0);

  const gone = await json(`${api.baseUrl}/api/assets/${assetId}/download`);
  assert.equal(gone.status, 404);
});

test('size mismatch is detected and the object is discarded', async () => {
  const ticket = await post(`${api.baseUrl}/api/assets/upload-url`, {
    filename: 'trap.png',
    size: 1024,
  });
  assert.equal(ticket.status, 201);

  const put = await fetch(ticket.body.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: makeBytes(2048, 3), // half the announced size
  });
  assert.ok([200, 201, 204].includes(put.status));

  const confirm = await post(`${api.baseUrl}/api/assets/confirm-upload`, { assetId: ticket.body.assetId });
  assert.equal(confirm.status, 422);
  assert.equal(confirm.body.error.code, 'size_mismatch');

  const list = await json(`${api.baseUrl}/api/assets`);
  assert.equal(list.body.total, 0, 'a mismatched upload must not be indexed');
});

test('multipart upload works for files above the threshold', async () => {
  const bytes = makeBytes(11 * 1024 * 1024, 11);
  const ticket = await post(`${api.baseUrl}/api/assets/upload-url`, {
    filename: 'city_block.fbx',
    size: bytes.length,
    collection: 'Environment',
    tags: ['modular'],
  });
  assert.equal(ticket.status, 201, JSON.stringify(ticket.body));
  assert.equal(ticket.body.mode, 'multipart');
  assert.equal(ticket.body.partSize, 5 * 1024 * 1024);
  assert.equal(ticket.body.totalParts, 3);
  assert.equal(ticket.body.partUrls.length, 3);

  const parts: Array<{ partNumber: number; etag: string }> = [];
  for (const { partNumber, url } of ticket.body.partUrls) {
    const start = (partNumber - 1) * ticket.body.partSize;
    const chunk = bytes.subarray(start, Math.min(start + ticket.body.partSize, bytes.length));
    const response = await fetch(url, { method: 'PUT', body: chunk });
    assert.equal(response.status, 200, `part ${partNumber} failed`);
    const etag = response.headers.get('etag');
    assert.ok(etag, 'part response must expose an ETag');
    parts.push({ partNumber, etag });
  }

  const complete = await post(`${api.baseUrl}/api/assets/multipart/complete`, {
    assetId: ticket.body.assetId,
    uploadId: ticket.body.uploadId,
    parts,
  });
  assert.equal(complete.status, 201, JSON.stringify(complete.body));
  assert.equal(complete.body.asset.size, bytes.length);
  assert.equal(complete.body.asset.extension, 'fbx');
  assert.equal(complete.body.asset.previewable, true, 'FBX has a real three.js loader');

  // Prefix of the stored object must match the first bytes we sent.
  const info = await json(`${api.baseUrl}/api/assets/${ticket.body.assetId}/download`);
  const fetched = await fetch(info.body.url);
  const downloaded = Buffer.from(await fetched.arrayBuffer());
  assert.equal(downloaded.length, bytes.length);
  assert.ok(downloaded.subarray(0, 4096).equals(bytes.subarray(0, 4096)));
  assert.ok(downloaded.subarray(-4096).equals(bytes.subarray(-4096)));

  // Incomplete part lists are rejected.
  const bad = await post(`${api.baseUrl}/api/assets/multipart/complete`, {
    assetId: ticket.body.assetId,
    uploadId: ticket.body.uploadId,
    parts: parts.slice(0, 1),
  });
  assert.equal(bad.status, 404, 'pending upload is consumed after success');

  await json(`${api.baseUrl}/api/assets/${ticket.body.assetId}`, { method: 'DELETE' });
});

test('search, filters, sorting and pagination', async () => {
  const created: string[] = [];
  for (const [name, collection, tags] of [
    ['brick_wall.png', '2D', ['wall']],
    ['hero_knight.glb', '3D', ['rigged']],
    ['engine_loop.wav', 'Audio', ['loop']],
  ] as const) {
    const { assetId } = await uploadAsset(api.baseUrl, name, makeBytes(2048, name.length), {
      collection,
      tags: [...tags],
    });
    created.push(assetId);
  }

  const byCollection = await json(`${api.baseUrl}/api/assets?collection=Audio`);
  assert.equal(byCollection.body.total, 1);
  assert.equal(byCollection.body.items[0].extension, 'wav');

  const bySearch = await json(`${api.baseUrl}/api/assets?q=knight`);
  assert.equal(bySearch.body.total, 1);
  assert.equal(bySearch.body.items[0].filename, 'hero_knight.glb');

  const byTag = await json(`${api.baseUrl}/api/assets?tag=wall`);
  assert.equal(byTag.body.total, 1);

  const byKind = await json(`${api.baseUrl}/api/assets?kind=audio`);
  assert.equal(byKind.body.total, 1);

  const byName = await json(`${api.baseUrl}/api/assets?sort=name`);
  assert.equal(byName.body.items[0].filename, 'brick_wall.png');

  const paged = await json(`${api.baseUrl}/api/assets?page=1&pageSize=2`);
  assert.equal(paged.body.items.length, 2);
  assert.equal(paged.body.total, 3);
  assert.equal(paged.body.totalPages, 2);

  const page2 = await json(`${api.baseUrl}/api/assets?page=2&pageSize=2`);
  assert.equal(page2.body.items.length, 1);

  // Stats are computed from the whole library, not the filtered page.
  const stats = await json(`${api.baseUrl}/api/assets/stats`);
  assert.equal(stats.body.totalAssets, 3);
  assert.equal(stats.body.byCollection['3D'].count, 1);

  for (const id of created) {
    await json(`${api.baseUrl}/api/assets/${id}`, { method: 'DELETE' });
  }
});

test('rescan reconciles the index with the bucket', async () => {
  const { assetId, asset } = await uploadAsset(api.baseUrl, 'rescan_me.jpg', makeBytes(1024, 5));

  const rescanned = await post(`${api.baseUrl}/api/assets/rescan`);
  assert.equal(rescanned.status, 200);
  assert.equal(rescanned.body.kept, 1);
  assert.equal(rescanned.body.added, 0);
  assert.equal(rescanned.body.removed, 0);

  // Delete the object behind the app's back, then rescan.
  const deleteResponse = await fetch(
    `http://127.0.0.1:${MOCK_PORT}/gaming-asset/${asset.key}`,
    { method: 'DELETE' },
  );
  assert.equal(deleteResponse.status, 204);

  const second = await post(`${api.baseUrl}/api/assets/rescan`);
  assert.equal(second.status, 200);
  assert.equal(second.body.removed, 1);
  assert.equal(second.body.totalAssets, 0);

  const list = await json(`${api.baseUrl}/api/assets`);
  assert.equal(list.body.total, 0);

  const gone = await json(`${api.baseUrl}/api/assets/${assetId}/download`);
  assert.equal(gone.status, 404);
});

test('collections can be created, listed and deleted only when empty', async () => {
  const created = await post(`${api.baseUrl}/api/collections`, { name: 'Weapons' });
  assert.equal(created.status, 201);
  assert.equal(created.body.collection.name, 'Weapons');

  const duplicate = await post(`${api.baseUrl}/api/collections`, { name: 'weapons' });
  assert.equal(duplicate.status, 409);

  const invalid = await post(`${api.baseUrl}/api/collections`, { name: '<script>' });
  assert.equal(invalid.status, 400);

  const { assetId } = await uploadAsset(api.baseUrl, 'sword.png', makeBytes(512, 9), {
    collection: 'Weapons',
  });

  const list = await json(`${api.baseUrl}/api/collections`);
  const weapons = list.body.collections.find((c: any) => c.name === 'Weapons');
  assert.equal(weapons.count, 1);

  const blocked = await json(`${api.baseUrl}/api/collections/${created.body.collection.id}`, {
    method: 'DELETE',
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'collection_not_empty');

  await json(`${api.baseUrl}/api/assets/${assetId}`, { method: 'DELETE' });
  const ok = await json(`${api.baseUrl}/api/collections/${created.body.collection.id}`, { method: 'DELETE' });
  assert.equal(ok.status, 200);

  const defaults = await json(`${api.baseUrl}/api/collections`);
  const textures = defaults.body.collections.find((c: any) => c.name === '2D');
  const protectedDelete = await json(`${api.baseUrl}/api/collections/${textures.id}`, { method: 'DELETE' });
  assert.equal(protectedDelete.status, 400);
  assert.equal(protectedDelete.body.error.code, 'protected_collection');
});
