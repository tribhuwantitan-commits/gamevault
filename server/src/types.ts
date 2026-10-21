export type AssetKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'model3d'
  | 'archive'
  | 'project'
  | 'font'
  | 'other';

export interface AssetRecord {
  id: string;
  /** Object key inside the bucket: `assets/<id>/<sanitized-name>` */
  key: string;
  /** Sanitized filename stored in the bucket. */
  filename: string;
  /** Name as provided by the browser (display only, sanitized on write). */
  originalFilename: string;
  /** Optional user-facing display name; falls back to originalFilename. */
  title?: string;
  size: number;
  contentType: string;
  kind: AssetKind;
  extension: string;
  collection: string;
  tags: string[];
  description: string;
  uploadedAt: string;
  updatedAt: string;
  etag?: string;
}

export interface CollectionRecord {
  id: string;
  name: string;
  description: string;
  default: boolean;
  createdAt: string;
}

export interface PendingUpload {
  id: string;
  key: string;
  filename: string;
  originalFilename: string;
  size: number;
  contentType: string;
  collection: string;
  tags: string[];
  description: string;
  mode: 'single' | 'multipart';
  uploadId?: string;
  partSize?: number;
  totalParts?: number;
  createdAt: string;
}

export interface StoreShape {
  version: 1;
  assets: AssetRecord[];
  collections: CollectionRecord[];
  pending: PendingUpload[];
}

export interface FileTypeInfo {
  extension: string;
  contentType: string;
  kind: AssetKind;
  /** Whether the browser can render it natively (image/audio/video) or via three.js (glb/gltf). */
  previewable: boolean;
}

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
