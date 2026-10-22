import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  FALLBACK_COLLECTION,
  buildObjectKey,
  formatBytes,
  lookupFileType,
  normalizeTags,
  requireFileType,
  sanitizeFilename,
} from '../lib/files.js';
import { store } from '../lib/store.js';
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  deleteObject,
  headObjectInfo,
  listAssetObjects,
  presignGet,
  presignPut,
  presignUploadParts,
} from '../lib/s3.js';
import { contentDisposition, newId, nowIso, parseETag } from '../lib/util.js';
import {
  descendantFolderIds,
  folderPath,
  isBundleFile,
  collectionIsVersioned,
  versionTitle,
} from '../lib/folders.js';
import { AppError, type AssetRecord, type PendingUpload } from '../types.js';
import { toAssetDTO } from './serialize.js';

export const assetsRouter = Router();

const PENDING_TTL_MS = 2 * 60 * 60 * 1000; // presigned URLs are much shorter; 2h is a generous cleanup window

const uploadRequestSchema = z.object({
  filename: z.string().min(1, 'A filename is required').max(255),
  size: z.number().int().positive('File size must be greater than zero'),
  collection: z.string().max(60).optional(),
  /** Folder to file the upload into; omit for "not filed". */
  folderId: z.string().uuid().nullish(),
  /** Let the server name ZIP bundles "<folder> v1, v2, v3" (Game/App only). */
  autoVersion: z.boolean().optional(),
  tags: z.array(z.string()).max(50).optional(),
  description: z.string().max(2000).optional(),
});

const idSchema = z.string().uuid('Invalid asset id');

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  collection: z.string().max(60).optional(),
  /** Folder id, or "root" for assets that are not filed in any folder. */
  folder: z.string().max(64).optional(),
  includeDescendants: z.enum(['0', '1']).optional(),
  kind: z.string().max(20).optional(),
  tag: z.string().max(40).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'name-desc', 'size-desc', 'size-asc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const patchSchema = z
  .object({
    title: z.string().max(160).optional(),
    tags: z.array(z.string()).max(50).optional(),
    collection: z.string().max(60).optional(),
    folderId: z.string().uuid().nullish(),
    description: z.string().max(2000).optional(),
  })
  .strict();

const multipartPartsSchema = z.object({
  assetId: idSchema,
  uploadId: z.string().min(1).max(1024),
  partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(200),
});

const multipartCompleteSchema = z.object({
  assetId: idSchema,
  uploadId: z.string().min(1).max(1024),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10000),
});

const multipartAbortSchema = z.object({
  assetId: idSchema,
  uploadId: z.string().min(1).max(1024),
});

/**
 * Name a download uses: the display title plus the original extension, so an
 * auto-versioned bundle saves as "City Builder v3.zip" while the object key in
 * the bucket never changes.
 */
function downloadName(asset: AssetRecord): string {
  const title = asset.title?.trim();
  if (!title) return asset.originalFilename || asset.filename;
  const extension = asset.extension || asset.filename.split('.').pop() || '';
  return extension && !title.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    ? `${title}.${extension}`
    : title;
}

function pendingIsStale(pending: PendingUpload): boolean {
  return Date.now() - new Date(pending.createdAt).getTime() > PENDING_TTL_MS;
}

async function pendingOrThrow(assetId: string): Promise<PendingUpload> {
  const pending = await store.getPending(assetId);
  if (!pending) {
    throw new AppError(
      404,
      'pending_upload_not_found',
      'No pending upload matches that id. Start the upload again.',
    );
  }
  if (pendingIsStale(pending)) {
    await store.removePending(pending.id);
    if (pending.mode === 'multipart' && pending.uploadId) {
      await abortMultipart(pending.key, pending.uploadId);
    }
    throw new AppError(410, 'upload_expired', 'This upload expired. Please upload the file again.');
  }
  return pending;
}

async function createAssetFromObject(
  pending: PendingUpload,
  info: { size: number; etag?: string; autoVersion?: boolean },
): Promise<AssetRecord> {
  const now = nowIso();
  const type = requireFileType(pending.filename);
  const asset: AssetRecord = {
    id: pending.id,
    key: pending.key,
    filename: pending.filename,
    originalFilename: pending.originalFilename,
    title: '',
    size: info.size,
    contentType: pending.contentType || type.contentType,
    kind: type.kind,
    extension: type.extension,
    collection: pending.collection || FALLBACK_COLLECTION,
    folderId: pending.folderId ?? null,
    tags: pending.tags,
    description: pending.description,
    uploadedAt: now,
    updatedAt: now,
    etag: info.etag,
  };
  // Version titles are assigned inside the store's write lock, so two uploads
  // finishing at the same moment cannot both become v3.
  return store.commitAsset(asset, { autoVersion: info.autoVersion === true });
}

/** GET /api/assets — paginated, filtered, sorted listing. */
assetsRouter.get('/', async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const all = await store.listAssets();

    let items = all;
    if (query.collection && query.collection !== 'All') {
      const target = query.collection.toLowerCase();
      items = items.filter((a) => a.collection.toLowerCase() === target);
    }
    if (query.folder) {
      if (query.folder === 'root') {
        items = items.filter((a) => !a.folderId);
      } else {
        const folders = await store.listFolders();
        const ids =
          query.includeDescendants === '1'
            ? [...descendantFolderIds(folders, query.folder)]
            : [query.folder];
        const wanted = new Set(ids);
        items = items.filter((a) => wanted.has(a.folderId ?? ''));
      }
    }
    if (query.kind && query.kind !== 'all') {
      items = items.filter((a) => a.kind === query.kind);
    }
    if (query.tag) {
      const target = query.tag.toLowerCase();
      items = items.filter((a) => a.tags.some((t) => t.toLowerCase() === target));
    }
    if (query.q?.trim()) {
      const needle = query.q.trim().toLowerCase();
      items = items.filter((a) =>
        [a.title, a.originalFilename, a.filename, a.description, a.collection, ...a.tags]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)),
      );
    }

    const sorted = [...items];
    switch (query.sort ?? 'newest') {
      case 'oldest':
        sorted.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
        break;
      case 'name':
        sorted.sort((a, b) => (a.title || a.originalFilename).localeCompare(b.title || b.originalFilename));
        break;
      case 'name-desc':
        sorted.sort((a, b) => (b.title || b.originalFilename).localeCompare(a.title || a.originalFilename));
        break;
      case 'size-desc':
        sorted.sort((a, b) => b.size - a.size);
        break;
      case 'size-asc':
        sorted.sort((a, b) => a.size - b.size);
        break;
      default:
        sorted.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    }

    const pageSize = query.pageSize ?? 24;
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(query.page ?? 1, totalPages);
    const start = (page - 1) * pageSize;

    res.json({
      items: sorted.slice(start, start + pageSize).map(toAssetDTO),
      page,
      pageSize,
      total,
      totalPages,
      filters: {
        q: query.q ?? '',
        collection: query.collection ?? 'All',
        kind: query.kind ?? 'all',
        tag: query.tag ?? '',
        sort: query.sort ?? 'newest',
      },
      summary: summarize(all),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/assets/stats — headline numbers for the dashboard. */
assetsRouter.get('/stats', async (_req, res, next) => {
  try {
    const all = await store.listAssets();
    res.json(summarize(all));
  } catch (err) {
    next(err);
  }
});

function summarize(all: AssetRecord[]) {
  const totalBytes = all.reduce((sum, a) => sum + (Number.isFinite(a.size) ? a.size : 0), 0);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = all.filter((a) => new Date(a.uploadedAt).getTime() >= weekAgo);

  const byCollection: Record<string, { count: number; bytes: number }> = {};
  const byKind: Record<string, { count: number; bytes: number }> = {};
  const tagCounts = new Map<string, number>();

  for (const asset of all) {
    const collectionKey = asset.collection || FALLBACK_COLLECTION;
    byCollection[collectionKey] ??= { count: 0, bytes: 0 };
    byCollection[collectionKey]!.count += 1;
    byCollection[collectionKey]!.bytes += asset.size;

    byKind[asset.kind] ??= { count: 0, bytes: 0 };
    byKind[asset.kind]!.count += 1;
    byKind[asset.kind]!.bytes += asset.size;

    for (const tag of asset.tags) {
      const key = tag.toLowerCase();
      tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    totalAssets: all.length,
    totalBytes,
    totalBytesLabel: formatBytes(totalBytes),
    recentUploads: recent.length,
    latestUploadAt: all.reduce<string | null>(
      (latest, a) => (!latest || a.uploadedAt > latest ? a.uploadedAt : latest),
      null,
    ),
    byCollection,
    byKind,
    topTags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count })),
  };
}

/** POST /api/assets/upload-url — validates the request and signs a direct-to-Filebase upload. */
assetsRouter.post('/upload-url', async (req, res, next) => {
  try {
    const body = uploadRequestSchema.parse(req.body);
    const type = requireFileType(body.filename);

    if (body.size > config.limits.maxUploadBytes) {
      throw new AppError(
        413,
        'file_too_large',
        `${body.filename} is ${formatBytes(body.size)}; the limit is ${formatBytes(config.limits.maxUploadBytes)}.`,
        { maxUploadBytes: config.limits.maxUploadBytes },
      );
    }

    const safeName = sanitizeFilename(body.filename);
    const id = newId();
    const key = buildObjectKey(id, safeName);
    const collections = await store.collectionNames();
    const collection =
      collections.find((c) => c.toLowerCase() === (body.collection ?? '').trim().toLowerCase()) ??
      FALLBACK_COLLECTION;

    // --- folders + automatic versioning ---
    const folderId = body.folderId ?? null;
    let folder = null;
    if (folderId) {
      folder = await store.getFolder(folderId);
      if (!folder) throw new AppError(404, 'folder_not_found', 'That folder no longer exists.');
    }

    // Only bundle files (ZIP and friends) get <folder> v1, v2, v3 in Game/App.
    const autoVersion =
      body.autoVersion !== false &&
      Boolean(folder) &&
      collectionIsVersioned(collection) &&
      isBundleFile(safeName);

    const folderAssets = folderId
      ? (await store.listAssets()).filter((asset) => (asset.folderId ?? null) === folderId)
      : [];
    const versionPreview =
      autoVersion && folder
        ? versionTitle(
            folder.name,
            Math.max(
              0,
              ...folderAssets.map((asset) => {
                const match = /v(\d+)$/i.exec(asset.title?.trim() ?? '');
                return match ? Number(match[1]) : 0;
              }),
              folderAssets.length,
            ) + 1,
          )
        : null;

    const pendingBase: PendingUpload = {
      id,
      key,
      filename: safeName,
      originalFilename: body.filename.slice(0, 255),
      size: body.size,
      contentType: type.contentType,
      collection,
      folderId,
      autoVersion,
      tags: normalizeTags(body.tags, config.limits),
      description: (body.description ?? '').slice(0, 2000),
      mode: 'single',
      createdAt: nowIso(),
    };

    if (body.size >= config.limits.multipartThresholdBytes) {
      // --- Large file: S3 multipart upload ---
      const uploadId = await createMultipart(key, type.contentType);
      const partSize = Math.max(
        config.limits.partSizeBytes,
        Math.ceil(body.size / 9000 / (1024 * 1024)) * 1024 * 1024,
      );
      const totalParts = Math.max(1, Math.ceil(body.size / partSize));
      const firstBatch = Array.from(
        { length: Math.min(totalParts, config.limits.maxPartsPerRequest) },
        (_, i) => i + 1,
      );

      await store.addPending({
        ...pendingBase,
        mode: 'multipart',
        uploadId,
        partSize,
        totalParts,
      });

      const partUrls = await presignUploadParts(
        key,
        uploadId,
        firstBatch,
        config.presign.uploadExpiresSeconds,
      );

      res.status(201).json({
        mode: 'multipart',
        folderId,
        versionPreview,
        assetId: id,
        key,
        uploadId,
        partSize,
        totalParts,
        partUrls,
        contentType: type.contentType,
        expiresIn: config.presign.uploadExpiresSeconds,
      });
      return;
    }

    // --- Small/medium file: single presigned PUT ---
    const uploadUrl = await presignPut(key, type.contentType, config.presign.uploadExpiresSeconds);
    await store.addPending(pendingBase);

    res.status(201).json({
      mode: 'single',
      assetId: id,
      key,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': type.contentType },
      contentType: type.contentType,
      expiresIn: config.presign.uploadExpiresSeconds,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/assets/multipart/parts — re-sign additional part URLs. */
assetsRouter.post('/multipart/parts', async (req, res, next) => {
  try {
    const body = multipartPartsSchema.parse(req.body);
    const pending = await pendingOrThrow(body.assetId);
    if (pending.mode !== 'multipart' || !pending.uploadId) {
      throw new AppError(409, 'not_a_multipart_upload', 'This upload is not a multipart upload.');
    }
    if (pending.uploadId !== body.uploadId) {
      throw new AppError(409, 'upload_id_mismatch', 'The upload id does not match this upload.');
    }
    const totalParts = pending.totalParts ?? 1;
    const invalid = body.partNumbers.filter((n) => n < 1 || n > totalParts);
    if (invalid.length > 0) {
      throw new AppError(400, 'invalid_part_numbers', `Part numbers must be between 1 and ${totalParts}.`);
    }
    const partUrls = await presignUploadParts(
      pending.key,
      pending.uploadId,
      [...new Set(body.partNumbers)].sort((a, b) => a - b),
      config.presign.uploadExpiresSeconds,
    );
    res.json({ partUrls, expiresIn: config.presign.uploadExpiresSeconds });
  } catch (err) {
    next(err);
  }
});

/** POST /api/assets/multipart/complete — finish a multipart upload and verify the object. */
assetsRouter.post('/multipart/complete', async (req, res, next) => {
  try {
    const body = multipartCompleteSchema.parse(req.body);
    const pending = await pendingOrThrow(body.assetId);
    if (pending.mode !== 'multipart' || !pending.uploadId) {
      throw new AppError(409, 'not_a_multipart_upload', 'This upload is not a multipart upload.');
    }
    if (pending.uploadId !== body.uploadId) {
      throw new AppError(409, 'upload_id_mismatch', 'The upload id does not match this upload.');
    }

    const expectedParts = pending.totalParts ?? 1;
    const parts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i]!.partNumber !== i + 1) {
        throw new AppError(400, 'incomplete_parts', 'Uploaded parts must cover every part number in order.');
      }
    }
    if (parts.length !== expectedParts) {
      throw new AppError(
        400,
        'incomplete_parts',
        `Expected ${expectedParts} parts but received ${parts.length}.`,
      );
    }

    const completed = parts.map((p) => {
      const etag = parseETag(p.etag);
      if (!etag) throw new AppError(400, 'invalid_etag', `Part ${p.partNumber} has an invalid ETag.`);
      return { PartNumber: p.partNumber, ETag: `"${etag}"` };
    });

    await completeMultipart(pending.key, pending.uploadId, completed);

    const head = await headObjectInfo(pending.key);
    if (!head) {
      throw new AppError(502, 'upload_not_verified', 'Filebase did not report the completed object. Please retry.');
    }
    if (head.size !== pending.size) {
      await deleteObject(pending.key).catch(() => undefined);
      await store.removePending(pending.id);
      throw new AppError(
        422,
        'size_mismatch',
        `The stored file is ${head.size} bytes but ${pending.size} bytes were announced. The upload was discarded.`,
      );
    }

    const asset = await createAssetFromObject(pending, {
      size: head.size,
      etag: head.etag,
      autoVersion: pending.autoVersion,
    });
    res.status(201).json({ asset: toAssetDTO(asset) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/assets/multipart/abort — cancel an in-flight multipart upload. */
assetsRouter.post('/multipart/abort', async (req, res, next) => {
  try {
    const body = multipartAbortSchema.parse(req.body);
    const pending = await store.getPending(body.assetId);
    if (!pending || pending.mode !== 'multipart' || pending.uploadId !== body.uploadId) {
      res.status(204).end();
      return;
    }
    await abortMultipart(pending.key, pending.uploadId);
    await store.removePending(pending.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** POST /api/assets/confirm-upload — verify the object really exists, then index it. */
assetsRouter.post('/confirm-upload', async (req, res, next) => {
  try {
    const { assetId } = z.object({ assetId: idSchema }).parse(req.body);
    const pending = await pendingOrThrow(assetId);
    if (pending.mode === 'multipart') {
      throw new AppError(
        409,
        'multipart_not_completed',
        'This multipart upload must be completed with /api/assets/multipart/complete.',
      );
    }

    const head = await headObjectInfo(pending.key);
    if (!head) {
      // The browser reported success but the object is not there: never simulate success.
      await store.removePending(pending.id);
      throw new AppError(
        502,
        'upload_not_verified',
        'Filebase did not report the uploaded object. Check bucket permissions and try again.',
      );
    }
    if (head.size !== pending.size) {
      await deleteObject(pending.key).catch(() => undefined);
      await store.removePending(pending.id);
      throw new AppError(
        422,
        'size_mismatch',
        `The stored file is ${head.size} bytes but ${pending.size} bytes were announced. The upload was discarded.`,
      );
    }

    const asset = await createAssetFromObject(pending, {
      size: head.size,
      etag: head.etag,
      autoVersion: pending.autoVersion,
    });
    res.status(201).json({ asset: toAssetDTO(asset) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/assets/:id — full metadata for one asset. */
assetsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const asset = await store.getAsset(id);
    if (!asset) throw new AppError(404, 'asset_not_found', 'That asset is not in the library.');
    res.json({ asset: toAssetDTO(asset) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/assets/:id/file — 302 to a short-lived presigned URL (used for previews). */
assetsRouter.get('/:id/file', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const asset = await store.getAsset(id);
    if (!asset) throw new AppError(404, 'asset_not_found', 'That asset is not in the library.');
    const url = await presignGet(asset.key, config.presign.downloadExpiresSeconds, {
      filename: asset.filename,
      disposition: 'inline',
      contentType: asset.contentType,
    });
    // Thumbnails are immutable per object version; the presigned URL inside the
    // redirect is short-lived, so cache the redirect briefly to avoid re-signing
    // on every grid render.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
});

/** GET /api/assets/:id/download — presigned download URL (or 302 with ?redirect=1). */
assetsRouter.get('/:id/download', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const asset = await store.getAsset(id);
    if (!asset) throw new AppError(404, 'asset_not_found', 'That asset is not in the library.');

    const filename = downloadName(asset);
    const url = await presignGet(asset.key, config.presign.downloadExpiresSeconds, {
      filename,
      disposition: 'attachment',
      contentType: 'application/octet-stream',
    });

    if (req.query.redirect === '1') {
      res.redirect(302, url);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      url,
      filename,
      size: asset.size,
      expiresIn: config.presign.downloadExpiresSeconds,
      contentDisposition: contentDisposition('attachment', filename),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/assets/:id — metadata, tags and collection. */
assetsRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const body = patchSchema.parse(req.body);
    const existing = await store.getAsset(id);
    if (!existing) throw new AppError(404, 'asset_not_found', 'That asset is not in the library.');

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title.trim().slice(0, 160);
    if (body.description !== undefined) patch.description = body.description.slice(0, 2000);
    if (body.tags !== undefined) patch.tags = normalizeTags(body.tags, config.limits);
    if (body.folderId !== undefined) {
      if (body.folderId === null) {
        patch.folderId = null;
      } else {
        const folder = await store.getFolder(body.folderId);
        if (!folder) {
          throw new AppError(404, 'folder_not_found', 'That folder no longer exists.');
        }
        patch.folderId = folder.id;
      }
    }
    if (body.collection !== undefined) {
      const trimmed = body.collection.trim();
      if (!trimmed) throw new AppError(400, 'invalid_collection', 'A collection name is required.');
      const names = await store.collectionNames();
      const match = names.find((n) => n.toLowerCase() === trimmed.toLowerCase());
      if (!match) {
        throw new AppError(400, 'unknown_collection', `"${trimmed}" is not a known collection.`, {
          collections: names,
        });
      }
      patch.collection = match;
    }

    const updated = await store.updateAsset(id, patch);
    if (!updated) throw new AppError(404, 'asset_not_found', 'That asset is not in the library.');
    res.json({ asset: toAssetDTO(updated) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/assets/:id — removes the object from Filebase, then the metadata. */
assetsRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const asset = await store.getAsset(id);
    if (!asset) throw new AppError(404, 'asset_not_found', 'That asset is not in the library.');

    // Only the server-derived key from our own index is ever used.
    await deleteObject(asset.key);
    await store.deleteAsset(id);
    res.json({ deleted: true, id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/assets/rescan — reconcile the index with the actual bucket contents.
 * Recovers from a lost/corrupted metadata file and drops entries whose object is gone.
 */
assetsRouter.post('/rescan', async (_req, res, next) => {
  try {
    const objects = await listAssetObjects(config.keyPrefix);
    const existing = await store.listAssets();
    const byKey = new Map(existing.map((a) => [a.key, a]));
    const objectKeys = new Set(objects.map((o) => o.key));

    const nextAssets: AssetRecord[] = [];
    let added = 0;
    const skipped: string[] = [];

    for (const object of objects) {
      const known = byKey.get(object.key);
      if (known) {
        nextAssets.push({
          ...known,
          size: object.size || known.size,
          etag: object.etag ?? known.etag,
        });
        continue;
      }

      const segments = object.key.split('/');
      const storedName = segments[segments.length - 1] ?? '';
      const type = lookupFileType(storedName);
      if (!type) {
        skipped.push(object.key);
        continue;
      }
      const maybeId = segments[1] ?? '';
      const id = /^[0-9a-f-]{36}$/.test(maybeId) ? maybeId : newId();
      const timestamp = object.lastModified ?? nowIso();
      nextAssets.push({
        id,
        key: object.key,
        filename: storedName,
        originalFilename: storedName,
        title: '',
        size: object.size,
        contentType: type.contentType,
        kind: type.kind,
        extension: type.extension,
        collection: FALLBACK_COLLECTION,
        tags: [],
        description: '',
        uploadedAt: timestamp,
        updatedAt: timestamp,
        etag: object.etag,
      });
      added += 1;
    }

    // Assets indexed locally whose object is no longer in the bucket.
    const removed = existing.filter((a) => !objectKeys.has(a.key)).length;
    const kept = nextAssets.length - added;
    await store.replaceAssets(nextAssets);

    res.json({
      added,
      kept,
      removed,
      totalObjects: objects.length,
      totalAssets: nextAssets.length,
      skippedKeys: skipped.slice(0, 20),
    });
  } catch (err) {
    next(err);
  }
});
