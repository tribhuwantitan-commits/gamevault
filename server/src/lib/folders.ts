import { VERSIONED_COLLECTIONS } from './files.js';
import type { AssetRecord, FolderRecord } from '../types.js';

/** Extensions that count as a "build bundle" for automatic versioning. */
const BUNDLE_EXTENSIONS = new Set([
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'unitypackage',
  'apk',
  'aab',
  'exe',
  'msi',
]);

export function isBundleFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return BUNDLE_EXTENSIONS.has(ext);
}

export function collectionIsVersioned(collection: string): boolean {
  return VERSIONED_COLLECTIONS.some((name) => name.toLowerCase() === collection.toLowerCase());
}

/** "City Builder" -> "City Builder v3" */
export function versionTitle(folderName: string, version: number): string {
  return `${folderName} v${version}`;
}

/** Pull the version number out of a title like "City Builder v3" (case-insensitive). */
export function parseVersion(title: string, folderName: string): number | null {
  const escaped = folderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}\\s+v(\\d+)$`, 'i').exec(title.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Highest version already used in a folder.
 *
 * Only titles that actually look like "<folder> vN" count, so plain files
 * (textures, sounds) never consume a version number.
 */
export function highestVersion(folder: FolderRecord, siblings: AssetRecord[]): number {
  let highest = folder.versionSeq ?? 0;
  for (const asset of siblings) {
    if ((asset.folderId ?? null) !== folder.id) continue;
    const parsed = parseVersion(asset.title?.trim() || '', folder.name);
    if (parsed && parsed > highest) highest = parsed;
  }
  return highest;
}

/**
 * Next version for a folder. The counter lives on the folder (`versionSeq`) so a
 * deleted v2 is never handed out again.
 */
export function nextVersion(folder: FolderRecord, siblings: AssetRecord[]): number {
  return highestVersion(folder, siblings) + 1;
}

/** Full slash path for a folder: "/City Builder/Commercial Building". */
export function folderPath(folders: FolderRecord[], id: string | null | undefined): string {
  if (!id) return '/';
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  let current = byId.get(id);
  let guard = 0;
  while (current && guard < 64) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    guard += 1;
  }
  return `/${parts.join('/')}`;
}

/** The folder itself plus every folder below it. */
export function descendantFolderIds(folders: FolderRecord[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? '';
    const list = children.get(key) ?? [];
    list.push(folder.id);
    children.set(key, list);
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}
