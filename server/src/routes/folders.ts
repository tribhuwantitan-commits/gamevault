import { Router } from 'express';
import { z } from 'zod';
import { store } from '../lib/store.js';
import { descendantFolderIds, folderPath } from '../lib/folders.js';
import { AppError } from '../types.js';

export const foldersRouter = Router();

const nameSchema = z
  .string()
  .trim()
  .min(1, 'A folder name is required')
  .max(64, 'Folder names are limited to 64 characters');

const createSchema = z.object({
  name: nameSchema,
  parentId: z.string().uuid().nullish(),
});

const renameSchema = z.object({ name: nameSchema }).strict();

const idSchema = z.string().uuid('Invalid folder id');

/** Keep names filesystem-safe-ish: no slashes, no control characters. */
function cleanName(raw: string): string {
  const cleaned = raw.replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new AppError(400, 'invalid_folder_name', 'That folder name cannot be used.');
  }
  return cleaned;
}

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  assetCount: number;
  totalAssetCount: number;
  folderCount: number;
  bytes: number;
  createdAt: string;
}

/**
 * GET /api/folders — every folder as a flat list with paths and counts.
 * The client builds the tree; a flat list keeps renames/moves cheap.
 */
foldersRouter.get('/', async (_req, res, next) => {
  try {
    const [folders, assets] = await Promise.all([store.listFolders(), store.listAssets()]);

    const direct = new Map<string, { count: number; bytes: number }>();
    for (const asset of assets) {
      const key = asset.folderId ?? '';
      if (!key) continue;
      const entry = direct.get(key) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += asset.size;
      direct.set(key, entry);
    }

    const children = new Map<string, number>();
    for (const folder of folders) {
      const key = folder.parentId ?? '';
      children.set(key, (children.get(key) ?? 0) + 1);
    }

    const items: FolderDTO[] = folders.map((folder) => {
      const ids = descendantFolderIds(folders, folder.id);
      let total = 0;
      let totalBytes = 0;
      for (const id of ids) {
        const entry = direct.get(id);
        if (!entry) continue;
        total += entry.count;
        totalBytes += entry.bytes;
      }
      const path = folderPath(folders, folder.id);
      return {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId ?? null,
        path,
        depth: path.split('/').filter(Boolean).length,
        assetCount: direct.get(folder.id)?.count ?? 0,
        totalAssetCount: total,
        folderCount: children.get(folder.id) ?? 0,
        bytes: totalBytes,
        createdAt: folder.createdAt,
      };
    });

    const rootAssets = assets.filter((asset) => !asset.folderId);

    res.json({
      folders: items.sort((a, b) => a.path.localeCompare(b.path)),
      rootAssetCount: rootAssets.length,
      rootBytes: rootAssets.reduce((sum, asset) => sum + asset.size, 0),
      totalFolders: items.length,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/folders — create a folder at the root or inside another folder. */
foldersRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const name = cleanName(body.name);
    const folder = await store.createFolder(name, body.parentId ?? null).catch((err: Error) => {
      if (err.message === 'duplicate_folder') {
        throw new AppError(409, 'duplicate_folder', `A folder called “${name}” already exists here.`);
      }
      if (err.message === 'parent_not_found') {
        throw new AppError(404, 'folder_not_found', 'The parent folder no longer exists.');
      }
      throw err;
    });

    const folders = await store.listFolders();
    res.status(201).json({
      folder: {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        path: folderPath(folders, folder.id),
        depth: folderPath(folders, folder.id).split('/').filter(Boolean).length,
        assetCount: 0,
        totalAssetCount: 0,
        folderCount: 0,
        bytes: 0,
        createdAt: folder.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/folders/:id — rename. Version titles already given out are kept. */
foldersRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const body = renameSchema.parse(req.body);
    const name = cleanName(body.name);
    const folder = await store.renameFolder(id, name).catch((err: Error) => {
      if (err.message === 'duplicate_folder') {
        throw new AppError(409, 'duplicate_folder', `A folder called “${name}” already exists here.`);
      }
      throw err;
    });
    if (!folder) throw new AppError(404, 'folder_not_found', 'That folder no longer exists.');
    const folders = await store.listFolders();
    res.json({ folder: { ...folder, path: folderPath(folders, folder.id) } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/folders/:id?mode=move|delete
 * `move` (default) keeps every asset, filing them under Other.
 */
foldersRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const mode = req.query.mode === 'delete' ? 'delete' : 'move';
    const result = await store.deleteFolder(id, mode);
    if (!result) throw new AppError(404, 'folder_not_found', 'That folder no longer exists.');

    // Bucket cleanup happens in the caller-supplied order: objects first, then index.
    if (mode === 'delete' && result.removedAssets.length > 0) {
      const { deleteObject } = await import('../lib/s3.js');
      await Promise.all(
        result.removedAssets.map((asset) => deleteObject(asset.key).catch(() => undefined)),
      );
    }

    res.json({ deleted: true, mode, removedAssets: result.removedAssets.length });
  } catch (err) {
    next(err);
  }
});
