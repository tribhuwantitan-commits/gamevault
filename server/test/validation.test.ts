import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildObjectKey,
  formatBytes,
  isValidObjectKey,
  lookupFileType,
  normalizeTags,
  requireFileType,
  sanitizeFilename,
} from '../src/lib/files.js';
import { AppError } from '../src/types.js';

test('sanitizeFilename strips directories and unsafe characters', () => {
  assert.equal(sanitizeFilename('../../etc/passwd.png'), 'passwd.png');
  assert.equal(sanitizeFilename('C:\\Users\\dev\\grass_albedo.PNG'), 'grass_albedo.PNG');
  assert.equal(sanitizeFilename('my texture (1).jpg'), 'my_texture_1_.jpg');
  assert.equal(sanitizeFilename('.hidden.glb'), 'hidden.glb');
  assert.equal(sanitizeFilename('spaces   and\ttabs.webp'), 'spaces_and_tabs.webp');
});

test('sanitizeFilename rejects empty / dot-only names', () => {
  assert.throws(() => sanitizeFilename(''), AppError);
  assert.throws(() => sanitizeFilename('..'), AppError);
  assert.throws(() => sanitizeFilename('///'), AppError);
});

test('sanitizeFilename caps length but keeps the extension', () => {
  const long = `${'a'.repeat(300)}.png`;
  const result = sanitizeFilename(long);
  assert.ok(result.length <= 120);
  assert.ok(result.endsWith('.png'));
});

test('object keys must match the generated layout', () => {
  const id = '3f0c8f4e-4a3f-4f0d-9f3b-2b1a1c1d1e1f';
  const key = buildObjectKey(id, 'sword.glb');
  assert.equal(key, `assets/${id}/sword.glb`);
  assert.ok(isValidObjectKey(key));
  assert.ok(!isValidObjectKey('assets/../secret.txt'));
  assert.ok(!isValidObjectKey('other-bucket-file.png'));
  assert.ok(!isValidObjectKey(`${key}/nested.png`));
  assert.ok(!isValidObjectKey('assets/not-a-uuid/file.png'));
});

test('file type registry covers requested formats and flags previewability', () => {
  for (const ext of ['png', 'jpg', 'webp', 'svg', 'zip', 'glb', 'gltf', 'fbx', 'obj', 'mtl', 'blend', 'wav', 'mp3', 'ogg', 'mp4']) {
    const info = lookupFileType(`file.${ext}`);
    assert.ok(info, `${ext} should be supported`);
    assert.equal(info!.extension, ext);
  }

  assert.equal(lookupFileType('model.GLB')?.contentType, 'model/gltf-binary');
  assert.equal(lookupFileType('model.glb')?.previewable, true);
  assert.equal(lookupFileType('model.gltf')?.previewable, true);
  // Formats we really render get previewable=true (three.js loaders)…
  assert.equal(lookupFileType('model.obj')?.previewable, true);
  assert.equal(lookupFileType('model.stl')?.previewable, true);
  assert.equal(lookupFileType('model.fbx')?.previewable, true);
  // …and formats we cannot render must say so instead of pretending.
  assert.equal(lookupFileType('scene.blend')?.previewable, false);
  assert.equal(lookupFileType('scene.dae')?.previewable, false);
  assert.equal(lookupFileType('pack.zip')?.previewable, false);
  assert.equal(lookupFileType('pack.zip')?.kind, 'archive');
  assert.equal(lookupFileType('sound.ogg')?.kind, 'audio');
});

test('unsupported extensions are rejected with a 415', () => {
  try {
    requireFileType('malware.exe');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.status, 415);
    assert.equal(err.code, 'unsupported_file_type');
  }
  assert.throws(() => requireFileType('no-extension'), AppError);
});

test('tags are normalised, de-duplicated and capped', () => {
  const limits = { maxTagsPerAsset: 3, maxTagLength: 8 };
  assert.deepEqual(normalizeTags(['rock', ' #rock ', 'MOSS', 'sand', 'iron'], limits), [
    'rock',
    'MOSS',
    'sand',
  ]);
  assert.deepEqual(normalizeTags('not-an-array', limits), []);
  assert.deepEqual(normalizeTags([1, null, 'okay-tag-that-is-long'], limits), ['okay-tag']);
});

test('formatBytes renders readable sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536 * 1024), '1.5 MB');
  assert.equal(formatBytes(5 * 1024 * 1024 * 1024), '5.0 GB');
});
