import path from 'node:path';
import { AppError, type FileTypeInfo } from '../types.js';

/**
 * The single source of truth for accepted asset formats.
 * `previewable` means "can be rendered in a browser":
 *  - images / audio / video via native HTML elements
 *  - glb / gltf via three.js
 * Everything else is offered as a download.
 */
const REGISTRY: FileTypeInfo[] = [
  // ---- Images / textures ----
  { extension: 'png', contentType: 'image/png', kind: 'image', previewable: true },
  { extension: 'jpg', contentType: 'image/jpeg', kind: 'image', previewable: true },
  { extension: 'jpeg', contentType: 'image/jpeg', kind: 'image', previewable: true },
  { extension: 'webp', contentType: 'image/webp', kind: 'image', previewable: true },
  { extension: 'svg', contentType: 'image/svg+xml', kind: 'image', previewable: true },
  { extension: 'gif', contentType: 'image/gif', kind: 'image', previewable: true },
  { extension: 'avif', contentType: 'image/avif', kind: 'image', previewable: true },
  { extension: 'bmp', contentType: 'image/bmp', kind: 'image', previewable: true },
  { extension: 'ico', contentType: 'image/x-icon', kind: 'image', previewable: false },
  { extension: 'tga', contentType: 'image/x-tga', kind: 'image', previewable: false },
  { extension: 'tif', contentType: 'image/tiff', kind: 'image', previewable: false },
  { extension: 'tiff', contentType: 'image/tiff', kind: 'image', previewable: false },
  { extension: 'psd', contentType: 'image/vnd.adobe.photoshop', kind: 'image', previewable: false },
  { extension: 'hdr', contentType: 'image/vnd.radiance', kind: 'image', previewable: false },
  { extension: 'exr', contentType: 'image/x-exr', kind: 'image', previewable: false },
  { extension: 'ktx2', contentType: 'image/ktx2', kind: 'image', previewable: false },

  // ---- Audio ----
  { extension: 'wav', contentType: 'audio/wav', kind: 'audio', previewable: true },
  { extension: 'mp3', contentType: 'audio/mpeg', kind: 'audio', previewable: true },
  { extension: 'ogg', contentType: 'audio/ogg', kind: 'audio', previewable: true },
  { extension: 'oga', contentType: 'audio/ogg', kind: 'audio', previewable: true },
  { extension: 'flac', contentType: 'audio/flac', kind: 'audio', previewable: true },
  { extension: 'm4a', contentType: 'audio/mp4', kind: 'audio', previewable: true },
  { extension: 'aac', contentType: 'audio/aac', kind: 'audio', previewable: false },

  // ---- Video ----
  { extension: 'mp4', contentType: 'video/mp4', kind: 'video', previewable: true },
  { extension: 'webm', contentType: 'video/webm', kind: 'video', previewable: true },
  { extension: 'mov', contentType: 'video/quicktime', kind: 'video', previewable: true },
  { extension: 'ogv', contentType: 'video/ogg', kind: 'video', previewable: true },
  { extension: 'mkv', contentType: 'video/x-matroska', kind: 'video', previewable: false },

  // ---- 3D ----
  { extension: 'glb', contentType: 'model/gltf-binary', kind: 'model3d', previewable: true },
  { extension: 'gltf', contentType: 'model/gltf+json', kind: 'model3d', previewable: true },
  { extension: 'obj', contentType: 'text/plain', kind: 'model3d', previewable: true },
  { extension: 'fbx', contentType: 'application/octet-stream', kind: 'model3d', previewable: true },
  { extension: 'blend', contentType: 'application/octet-stream', kind: 'model3d', previewable: false },
  { extension: 'dae', contentType: 'model/vnd.collada+xml', kind: 'model3d', previewable: false },
  { extension: 'stl', contentType: 'model/stl', kind: 'model3d', previewable: true },
  { extension: 'mtl', contentType: 'text/plain', kind: 'model3d', previewable: false },
  { extension: 'usdz', contentType: 'model/vnd.usdz+zip', kind: 'model3d', previewable: false },

  // ---- Archives / project files ----
  { extension: 'zip', contentType: 'application/zip', kind: 'archive', previewable: false },
  { extension: 'rar', contentType: 'application/vnd.rar', kind: 'archive', previewable: false },
  { extension: '7z', contentType: 'application/x-7z-compressed', kind: 'archive', previewable: false },
  { extension: 'tar', contentType: 'application/x-tar', kind: 'archive', previewable: false },
  { extension: 'gz', contentType: 'application/gzip', kind: 'archive', previewable: false },

  // ---- Engine / project ----
  { extension: 'uasset', contentType: 'application/octet-stream', kind: 'project', previewable: false },
  { extension: 'umap', contentType: 'application/octet-stream', kind: 'project', previewable: false },
  { extension: 'unitypackage', contentType: 'application/octet-stream', kind: 'project', previewable: false },
  { extension: 'prefab', contentType: 'application/octet-stream', kind: 'project', previewable: false },
  { extension: 'shader', contentType: 'text/plain', kind: 'project', previewable: false },
  { extension: 'json', contentType: 'application/json', kind: 'project', previewable: false },
  { extension: 'atlas', contentType: 'text/plain', kind: 'project', previewable: false },

  // ---- UI / fonts ----
  { extension: 'ttf', contentType: 'font/ttf', kind: 'font', previewable: false },
  { extension: 'otf', contentType: 'font/otf', kind: 'font', previewable: false },
  { extension: 'woff', contentType: 'font/woff', kind: 'font', previewable: false },
  { extension: 'woff2', contentType: 'font/woff2', kind: 'font', previewable: false },
];

const BY_EXTENSION = new Map<string, FileTypeInfo>(REGISTRY.map((r) => [r.extension, r]));

export const SUPPORTED_EXTENSIONS = REGISTRY.map((r) => r.extension);

/**
 * Collections are content *types*. The project/game grouping lives in folders
 * (see FolderRecord), so a City Builder folder can hold 2D, 3D, audio and ZIPs
 * while still being tagged with one of these types.
 */
export const DEFAULT_COLLECTIONS = ['Game', 'App', '2D', '3D', 'Audio', 'Environment', 'Other'] as const;

/** Collections whose ZIP bundles get automatic <folder> v1, v2, v3 names. */
export const VERSIONED_COLLECTIONS = ['Game', 'App'] as const;

export const FALLBACK_COLLECTION = 'Other';

export function getExtension(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return ext;
}

export function lookupFileType(filename: string): FileTypeInfo | null {
  const ext = getExtension(filename);
  if (!ext) return null;
  return BY_EXTENSION.get(ext) ?? null;
}

export function requireFileType(filename: string): FileTypeInfo {
  const info = lookupFileType(filename);
  if (!info) {
    const ext = getExtension(filename);
    throw new AppError(
      415,
      'unsupported_file_type',
      ext
        ? `.${ext} files are not an accepted asset format.`
        : 'Files without an extension are not accepted.',
      { extension: ext || null, supported: SUPPORTED_EXTENSIONS },
    );
  }
  return info;
}

/**
 * Filesystem/object-key safe filename. Strips any directory component,
 * collapses unsafe characters to `_`, removes leading dots and caps the length.
 */
export function sanitizeFilename(input: string): string {
  const base = (input ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .replace(/_{2,}/g, '_');

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new AppError(400, 'invalid_filename', 'The filename is not valid.');
  }
  if (cleaned.length <= 120) return cleaned;

  const ext = path.extname(cleaned);
  const stem = cleaned.slice(0, Math.max(1, 120 - ext.length));
  return `${stem}${ext}`;
}

/** Object key layout owned by GameVault. */
export function buildObjectKey(id: string, safeFilename: string): string {
  return `assets/${id}/${safeFilename}`;
}

/** Rejects keys that are not exactly one we could have generated. */
export function isValidObjectKey(key: string): boolean {
  if (!/^assets\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,160}$/.test(key)) return false;
  if (key.includes('..')) return false;
  return true;
}

export function normalizeTags(tags: unknown, limits: { maxTagsPerAsset: number; maxTagLength: number }): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().replace(/^#/, '').slice(0, limits.maxTagLength);
    if (!tag) continue;
    const dedupeKey = tag.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(tag);
    if (out.length >= limits.maxTagsPerAsset) break;
  }
  return out;
}

export function normalizeCollection(name: unknown, valid: string[]): string {
  if (typeof name !== 'string') return FALLBACK_COLLECTION;
  const trimmed = name.trim();
  if (!trimmed) return FALLBACK_COLLECTION;
  const match = valid.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  return match ?? FALLBACK_COLLECTION;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
