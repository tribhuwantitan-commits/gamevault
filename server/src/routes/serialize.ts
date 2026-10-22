import { lookupFileType } from '../lib/files.js';
import type { AssetRecord } from '../types.js';

export interface AssetDTO {
  id: string;
  key: string;
  filename: string;
  originalFilename: string;
  title: string;
  displayName: string;
  size: number;
  contentType: string;
  kind: string;
  extension: string;
  collection: string;
  /** Folder the asset is filed in (null = not filed). */
  folderId: string | null;
  tags: string[];
  description: string;
  uploadedAt: string;
  updatedAt: string;
  previewable: boolean;
  fileUrl: string;
  downloadUrl: string;
}

export function toAssetDTO(asset: AssetRecord): AssetDTO {
  const type = lookupFileType(asset.filename);
  return {
    id: asset.id,
    key: asset.key,
    filename: asset.filename,
    originalFilename: asset.originalFilename,
    title: asset.title ?? '',
    displayName: asset.title?.trim() || asset.originalFilename || asset.filename,
    size: asset.size,
    contentType: asset.contentType,
    kind: asset.kind,
    extension: asset.extension,
    collection: asset.collection,
    folderId: asset.folderId ?? null,
    tags: asset.tags,
    description: asset.description,
    uploadedAt: asset.uploadedAt,
    updatedAt: asset.updatedAt,
    previewable: type?.previewable ?? false,
    fileUrl: `/api/assets/${asset.id}/file`,
    downloadUrl: `/api/assets/${asset.id}/download`,
  };
}
