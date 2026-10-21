import { Router } from 'express';
import { z } from 'zod';
import { store } from '../lib/store.js';
import { AppError } from '../types.js';

export const collectionsRouter = Router();

const createSchema = z.object({
  name: z
    .string()
    .min(1, 'A collection name is required')
    .max(48, 'Collection names are limited to 48 characters'),
  description: z.string().max(300).optional(),
});

const idSchema = z.string().uuid();

/** GET /api/collections — every collection with live asset counts. */
collectionsRouter.get('/', async (_req, res, next) => {
  try {
    const [collections, assets] = await Promise.all([store.listCollections(), store.listAssets()]);
    const counts = new Map<string, { count: number; bytes: number }>();
    for (const asset of assets) {
      const key = asset.collection.toLowerCase();
      const entry = counts.get(key) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += asset.size;
      counts.set(key, entry);
    }
    res.json({
      collections: collections
        .map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          default: c.default,
          count: counts.get(c.name.toLowerCase())?.count ?? 0,
          bytes: counts.get(c.name.toLowerCase())?.bytes ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/collections — add a custom collection. */
collectionsRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const cleaned = body.name.trim().replace(/\s+/g, ' ');
    if (!/^[A-Za-z0-9][A-Za-z0-9 &_+./-]*$/.test(cleaned)) {
      throw new AppError(
        400,
        'invalid_collection_name',
        'Use letters, numbers, spaces and simple punctuation (& _ + . / -).',
      );
    }
    const existing = await store.collectionNames();
    if (existing.some((n) => n.toLowerCase() === cleaned.toLowerCase())) {
      throw new AppError(409, 'collection_exists', 'A collection with that name already exists.');
    }
    if (existing.length >= 60) {
      throw new AppError(400, 'too_many_collections', 'You have reached the 60 collection limit.');
    }
    const record = await store.addCollection(cleaned, body.description?.slice(0, 300) ?? '');
    res.status(201).json({
      collection: {
        id: record.id,
        name: record.name,
        description: record.description,
        default: record.default,
        count: 0,
        bytes: 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/collections/:id — only empty, non-default collections can go. */
collectionsRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const collections = await store.listCollections();
    const target = collections.find((c) => c.id === id);
    if (!target) throw new AppError(404, 'collection_not_found', 'That collection does not exist.');
    if (target.default) {
      throw new AppError(400, 'protected_collection', 'Built-in collections cannot be deleted.');
    }
    const assets = await store.listAssets();
    const used = assets.filter((a) => a.collection.toLowerCase() === target.name.toLowerCase()).length;
    if (used > 0) {
      throw new AppError(
        409,
        'collection_not_empty',
        `"${target.name}" still holds ${used} asset${used === 1 ? '' : 's'}. Move them first.`,
      );
    }
    await store.deleteCollection(id);
    res.json({ deleted: true, id });
  } catch (err) {
    next(err);
  }
});
