import { Router } from 'express';
import { config } from '../config.js';
import { DEFAULT_COLLECTIONS, SUPPORTED_EXTENSIONS } from '../lib/files.js';
import { listAssetObjects } from '../lib/s3.js';
import { store } from '../lib/store.js';

export const metaRouter = Router();

const startedAt = Date.now();

/**
 * GET /api/health
 * Fast by default. `?storage=1` performs a real (read-only) round-trip to Filebase
 * so you can verify credentials without uploading anything.
 */
metaRouter.get('/health', async (req, res) => {
  const base = {
    status: config.storage.configured ? 'ok' : 'setup_required',
    version: '1.0.0',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
    // True when the API is closed to anonymous callers — either secret counts.
    authRequired: Boolean(config.authToken) || Boolean(config.passwordHash),
    passwordLoginEnabled: Boolean(config.passwordHash),
    storage: {
      configured: config.storage.configured,
      endpoint: config.storage.endpoint,
      bucket: config.storage.bucket,
      region: config.storage.region,
      checked: false,
      reachable: false as boolean | null,
      error: null as string | null,
    },
    limits: {
      maxUploadBytes: config.limits.maxUploadBytes,
      multipartThresholdBytes: config.limits.multipartThresholdBytes,
    },
  };

  if (req.query.storage === '1' && config.storage.configured) {
    base.storage.checked = true;
    try {
      // Only the GameVault prefix is ever touched.
      await listAssetObjects(config.keyPrefix);
      base.storage.reachable = true;
    } catch (err) {
      base.status = 'degraded';
      base.storage.reachable = false;
      // Only the error code/message, never credentials.
      base.storage.error = (err as { message?: string }).message ?? 'Storage check failed';
      res.status(503).json(base);
      return;
    }
  }

  res.status(config.storage.configured ? 200 : 503).json(base);
});

/**
 * GET /api/capabilities
 * Everything the UI needs to render before touching user data: whether the app is
 * configured, whether a token is required, and which formats are supported.
 */
metaRouter.get('/capabilities', async (_req, res, next) => {
  try {
    const collections = await store.listCollections();
    res.json({
      appName: 'GameVault',
      version: '1.0.0',
      storageConfigured: config.storage.configured,
      // True when the API is closed to anonymous callers — either secret counts.
    authRequired: Boolean(config.authToken) || Boolean(config.passwordHash),
      /** Password login available? Only a boolean — the hash never leaves the server. */
      passwordLoginEnabled: Boolean(config.passwordHash),
      sessionTtlSeconds: config.session.ttlSeconds,
      setupInstructions: config.storage.configured
        ? null
        : [
            'Copy server/.env.example to server/.env',
            'Add FILEBASE_ACCESS_KEY_ID and FILEBASE_SECRET_ACCESS_KEY from your Filebase console',
            'Restart the server (npm run dev)',
          ],
      limits: {
        maxUploadBytes: config.limits.maxUploadBytes,
        multipartThresholdBytes: config.limits.multipartThresholdBytes,
        maxTagsPerAsset: config.limits.maxTagsPerAsset,
        maxTagLength: config.limits.maxTagLength,
      },
      presign: {
        uploadExpiresSeconds: config.presign.uploadExpiresSeconds,
        downloadExpiresSeconds: config.presign.downloadExpiresSeconds,
      },
      supportedExtensions: SUPPORTED_EXTENSIONS,
      defaultCollections: DEFAULT_COLLECTIONS,
      collections: collections.map((c) => ({ id: c.id, name: c.name, default: c.default })),
      previewSupport: {
        native: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif', 'bmp', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'mp4', 'webm', 'mov', 'ogv'],
        threeD: ['glb', 'gltf', 'obj', 'stl', 'fbx'],
        downloadOnly: [
          'blend', 'mtl', 'dae', 'usdz',
          'zip', 'rar', '7z', 'tar', 'gz',
          'psd', 'tga', 'tif', 'tiff', 'hdr', 'exr', 'ktx2', 'ico',
          'uasset', 'umap', 'unitypackage', 'prefab', 'shader', 'json', 'atlas',
          'ttf', 'otf', 'woff', 'woff2', 'aac', 'mkv',
        ],
      },
    });
  } catch (err) {
    next(err);
  }
});
