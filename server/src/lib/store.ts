import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getObjectText, putObjectText } from './s3.js';
import { DEFAULT_COLLECTIONS, FALLBACK_COLLECTION } from './files.js';
import { nextVersion, versionTitle, collectionIsVersioned } from './folders.js';
import { nowIso, newId } from './util.js';
import type {
  AssetRecord,
  CollectionRecord,
  FolderRecord,
  PendingUpload,
  StoreShape,
} from '../types.js';

const CURRENT_SCHEMA = 2;

const EMPTY: StoreShape = {
  version: 1,
  schemaVersion: CURRENT_SCHEMA,
  assets: [],
  collections: [],
  folders: [],
  pending: [],
};

/**
 * Tiny JSON metadata store.
 *
 * - Binaries never live here; only metadata about objects in Filebase.
 * - Every mutation is serialized through a promise chain (single writer).
 * - Writes are atomic (temp file + rename) so a crash cannot truncate the file.
 */
export class MetadataStore {
  private file: string;
  private data: StoreShape = structuredClone(EMPTY);
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** Optional mirror of the index inside the bucket (survives ephemeral hosts). */
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string = config.dataDir) {
    this.file = path.join(dataDir, 'assets.json');
  }

  get path(): string {
    return this.file;
  }

  /** Serialize mutations to avoid lost updates. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // Keep the chain alive even if a mutation rejects.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      this.data = {
        version: 1,
        schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1,
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        collections: Array.isArray(parsed.collections) ? parsed.collections : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // Never crash on a corrupt metadata file — park it and start clean.
        const backup = `${this.file}.corrupt-${Date.now()}`;
        await fs.rename(this.file, backup).catch(() => undefined);
        console.warn(
          `[gamevault] metadata file was unreadable (${(err as Error).message}); moved to ${path.basename(backup)} and started a fresh index.`,
        );
      }
      this.data = structuredClone(EMPTY);
    }
    await this.loadRemoteIndex();
    this.migrateCollections();
    this.ensureDefaultCollections();
    await this.persist();
    this.loaded = true;
  }

  /**
   * When GAMEVAULT_INDEX_OBJECT is set, the bucket holds a mirror of the index.
   * Use it if it is at least as complete as the local copy (free hosts wipe disk
   * on every restart, so the remote copy is usually the authoritative one).
   */
  private async loadRemoteIndex(): Promise<void> {
    if (!config.indexObject || !config.storage.configured) return;
    try {
      const raw = await getObjectText(config.indexObject);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      if (!Array.isArray(parsed.assets)) return;
      if (parsed.assets.length < this.data.assets.length) return;
      this.data = {
        version: 1,
        schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1,
        assets: parsed.assets,
        collections: Array.isArray(parsed.collections) ? parsed.collections : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      };
      console.log(
        `[gamevault] restored metadata index from bucket (${parsed.assets.length} asset(s)) via ${config.indexObject}`,
      );
    } catch (err) {
      // Never block startup on the mirror: fall back to whatever is on disk.
      console.warn('[gamevault] could not read index from bucket:', (err as Error).message);
    }
  }

  /** Debounced, single-flight upload of the index mirror. */
  private scheduleRemoteSync(): void {
    if (!config.indexObject || !config.storage.configured) return;
    if (this.remoteTimer) return;
    this.remoteTimer = setTimeout(() => {
      this.remoteTimer = null;
      void this.flushRemoteIndex();
    }, 800);
    this.remoteTimer.unref?.();
  }

  /** Force the mirror to be written now (shutdown, tests). */
  async flushRemoteIndex(): Promise<void> {
    if (!config.indexObject || !config.storage.configured) return;
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    this.remoteChain = this.remoteChain.then(async () => {
      try {
        await putObjectText(config.indexObject, payload);
      } catch (err) {
        console.warn('[gamevault] could not mirror index to bucket:', (err as Error).message);
      }
    });
    await this.remoteChain;
  }

  /**
   * One-time move to the type-based collection list
   * (Game, App, 2D, 3D, Audio, Environment, Other).
   *
   * Assets that sat in an old default (Buildings, Characters, Vehicles,
   * Environments, UI, Textures, Animations) or in a deleted custom collection are
   * filed under Other instead of being lost. Assets are never deleted here.
   */
  private migrateCollections(): void {
    // Runs exactly once per data directory; afterwards custom collections work
    // normally again and survive restarts.
    if ((this.data.schemaVersion ?? 1) >= CURRENT_SCHEMA) return;

    const wanted = new Set<string>(DEFAULT_COLLECTIONS.map((name) => name.toLowerCase()));

    let moved = 0;
    this.data.assets = this.data.assets.map((asset) => {
      if (wanted.has(asset.collection.toLowerCase())) return asset;
      moved += 1;
      return { ...asset, collection: FALLBACK_COLLECTION, updatedAt: nowIso() };
    });
    this.data.collections = DEFAULT_COLLECTIONS.map((name) => ({
      id: newId(),
      name,
      description: '',
      default: true,
      createdAt: nowIso(),
    }));
    this.data.schemaVersion = CURRENT_SCHEMA;
    console.log(
      `[gamevault] collections updated to the type list (${moved} asset(s) moved to ${FALLBACK_COLLECTION})`,
    );
  }

  // ---------------------------------------------------------------- folders

  async listFolders(): Promise<FolderRecord[]> {
    const snap = await this.snapshot();
    return snap.folders;
  }

  async getFolder(id: string): Promise<FolderRecord | null> {
    const snap = await this.snapshot();
    return snap.folders.find((folder) => folder.id === id) ?? null;
  }

  async createFolder(name: string, parentId: string | null): Promise<FolderRecord> {
    return this.exclusive(async () => {
      if (parentId && !this.data.folders.some((folder) => folder.id === parentId)) {
        throw new Error('parent_not_found');
      }
      const duplicate = this.data.folders.some(
        (folder) =>
          (folder.parentId ?? null) === (parentId ?? null) &&
          folder.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) throw new Error('duplicate_folder');
      const record: FolderRecord = {
        id: newId(),
        name,
        parentId: parentId ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.data.folders.push(record);
      await this.persist();
      return record;
    });
  }

  async renameFolder(id: string, name: string): Promise<FolderRecord | null> {
    return this.exclusive(async () => {
      const folder = this.data.folders.find((item) => item.id === id);
      if (!folder) return null;
      const duplicate = this.data.folders.some(
        (item) =>
          item.id !== id &&
          (item.parentId ?? null) === (folder.parentId ?? null) &&
          item.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) throw new Error('duplicate_folder');
      folder.name = name;
      folder.updatedAt = nowIso();
      await this.persist();
      return folder;
    });
  }

  /**
   * Delete a folder.
   *
   * - `move` (default): the folder goes away, its assets are re-filed as un-filed
   *   (they show up in "Assets" and Other), and its sub-folders move up one level.
   *   Nothing is lost.
   * - `delete`: the whole subtree and every asset inside it is removed; the
   *   caller deletes the bucket objects afterwards.
   */
  async deleteFolder(
    id: string,
    mode: 'move' | 'delete',
  ): Promise<{ folder: FolderRecord; removedAssets: AssetRecord[] } | null> {
    return this.exclusive(async () => {
      const folder = this.data.folders.find((item) => item.id === id);
      if (!folder) return null;

      // With `move` only this folder disappears; children are re-parented below.
      const ids = new Set<string>([id]);
      if (mode === 'delete') {
        let changed = true;
        while (changed) {
          changed = false;
          for (const item of this.data.folders) {
            if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
              ids.add(item.id);
              changed = true;
            }
          }
        }
      }

      const touched = new Set<string>(ids);
      const removedAssets =
        mode === 'delete' ? this.data.assets.filter((asset) => touched.has(asset.folderId ?? '')) : [];

      if (mode === 'delete') {
        this.data.assets = this.data.assets.filter((asset) => !touched.has(asset.folderId ?? ''));
      } else {
        this.data.assets = this.data.assets.map((asset) =>
          touched.has(asset.folderId ?? '')
            ? {
                ...asset,
                folderId: null,
                collection: FALLBACK_COLLECTION,
                updatedAt: nowIso(),
              }
            : asset,
        );
      }

      const parentId = folder.parentId ?? null;
      this.data.folders = this.data.folders
        .filter((item) => !ids.has(item.id))
        .map((item) => {
          if (!ids.has(item.parentId ?? '')) return item;
          // Children of a deleted folder move up to the grandparent.
          return mode === 'move' ? { ...item, parentId, updatedAt: nowIso() } : item;
        });

      await this.persist();
      return { folder, removedAssets };
    });
  }

  /**
   * Commit an upload, optionally assigning the next automatic version title.
   *
   * Runs inside the write lock so two uploads finishing together cannot claim
   * the same version number (v3 and v3).
   */
  async commitAsset(
    asset: AssetRecord,
    options: { autoVersion?: boolean } = {},
  ): Promise<AssetRecord> {
    return this.exclusive(async () => {
      let record = asset;
      const folderId = asset.folderId ?? null;

      if (options.autoVersion && folderId && collectionIsVersioned(asset.collection)) {
        const folder = this.data.folders.find((item) => item.id === folderId);
        if (folder) {
          const version = nextVersion(folder, this.data.assets);
          folder.versionSeq = version;
          folder.updatedAt = nowIso();
          record = { ...asset, title: versionTitle(folder.name, version) };
        }
      }

      this.data.assets = this.data.assets.filter((a) => a.id !== record.id);
      this.data.assets.push(record);
      this.data.pending = this.data.pending.filter((p) => p.id !== record.id);
      this.data.collections = ensureCollection(this.data.collections, record.collection);
      await this.persist();
      return record;
    });
  }

  private ensureDefaultCollections(): void {
    const existing = new Set(this.data.collections.map((c) => c.name.toLowerCase()));
    for (const name of DEFAULT_COLLECTIONS) {
      if (existing.has(name.toLowerCase())) continue;
      this.data.collections.push({
        id: newId(),
        name,
        description: '',
        default: true,
        createdAt: nowIso(),
      });
    }
  }

  private async persist(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, this.file);
    this.scheduleRemoteSync();
  }

  async snapshot(): Promise<StoreShape> {
    if (!this.loaded) await this.init();
    return structuredClone(this.data);
  }

  async listAssets(): Promise<AssetRecord[]> {
    const snap = await this.snapshot();
    return snap.assets;
  }

  async getAsset(id: string): Promise<AssetRecord | null> {
    const snap = await this.snapshot();
    return snap.assets.find((a) => a.id === id) ?? null;
  }

  async listCollections(): Promise<CollectionRecord[]> {
    const snap = await this.snapshot();
    return snap.collections;
  }

  async collectionNames(): Promise<string[]> {
    const cols = await this.listCollections();
    return cols.map((c) => c.name);
  }

  async addPending(pending: PendingUpload): Promise<void> {
    await this.exclusive(async () => {
      this.data.pending = this.data.pending.filter((p) => p.id !== pending.id);
      this.data.pending.push(pending);
      await this.persist();
    });
  }

  async getPending(id: string): Promise<PendingUpload | null> {
    const snap = await this.snapshot();
    return snap.pending.find((p) => p.id === id) ?? null;
  }

  async removePending(id: string): Promise<void> {
    await this.exclusive(async () => {
      this.data.pending = this.data.pending.filter((p) => p.id !== id);
      await this.persist();
    });
  }

  async updateAsset(
    id: string,
    patch: Partial<
      Pick<AssetRecord, 'title' | 'tags' | 'collection' | 'description' | 'uploadedAt' | 'folderId'>
    >,
  ): Promise<AssetRecord | null> {
    return this.exclusive(async () => {
      const idx = this.data.assets.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      const current = this.data.assets[idx]!;
      const next: AssetRecord = { ...current, ...patch, updatedAt: nowIso() };
      this.data.assets[idx] = next;
      this.data.collections = ensureCollection(this.data.collections, next.collection);
      await this.persist();
      return next;
    });
  }

  async deleteAsset(id: string): Promise<AssetRecord | null> {
    return this.exclusive(async () => {
      const found = this.data.assets.find((a) => a.id === id) ?? null;
      if (!found) return null;
      this.data.assets = this.data.assets.filter((a) => a.id !== id);
      await this.persist();
      return found;
    });
  }

  async addCollection(name: string, description = ''): Promise<CollectionRecord> {
    return this.exclusive(async () => {
      const existing = this.data.collections.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const record: CollectionRecord = {
        id: newId(),
        name,
        description,
        default: false,
        createdAt: nowIso(),
      };
      this.data.collections.push(record);
      await this.persist();
      return record;
    });
  }

  async deleteCollection(id: string): Promise<CollectionRecord | null> {
    return this.exclusive(async () => {
      const found = this.data.collections.find((c) => c.id === id) ?? null;
      if (!found) return null;
      this.data.collections = this.data.collections.filter((c) => c.id !== id);
      await this.persist();
      return found;
    });
  }

  /** Replace the whole asset index (used by the bucket rescan). */
  async replaceAssets(assets: AssetRecord[]): Promise<void> {
    await this.exclusive(async () => {
      const ids = new Set(assets.map((a) => a.id));
      this.data.assets = assets;
      this.data.pending = this.data.pending.filter((p) => !ids.has(p.id));
      await this.persist();
    });
  }
}

function ensureCollection(collections: CollectionRecord[], name: string): CollectionRecord[] {
  if (collections.some((c) => c.name.toLowerCase() === name.toLowerCase())) return collections;
  return [
    ...collections,
    { id: newId(), name, description: '', default: false, createdAt: nowIso() },
  ];
}

export const store = new MetadataStore();
