export type AssetKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'model3d'
  | 'archive'
  | 'project'
  | 'font'
  | 'other';

export interface Asset {
  id: string;
  key: string;
  filename: string;
  originalFilename: string;
  title: string;
  displayName: string;
  size: number;
  contentType: string;
  kind: AssetKind;
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

export interface AssetListResponse {
  items: Asset[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filters: {
    q: string;
    collection: string;
    folder: string;
    kind: string;
    tag: string;
    sort: SortKey;
  };
  summary: Stats;
}

export type SortKey = 'newest' | 'oldest' | 'name' | 'name-desc' | 'size-desc' | 'size-asc';

export interface Stats {
  totalAssets: number;
  totalBytes: number;
  totalBytesLabel: string;
  recentUploads: number;
  latestUploadAt: string | null;
  byCollection: Record<string, { count: number; bytes: number }>;
  byKind: Record<string, { count: number; bytes: number }>;
  topTags: Array<{ tag: string; count: number }>;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  /** Assets directly in this folder. */
  assetCount: number;
  /** Assets in this folder and everything below it. */
  totalAssetCount: number;
  folderCount: number;
  bytes: number;
  createdAt: string;
}

export interface FolderListResponse {
  folders: Folder[];
  rootAssetCount: number;
  rootBytes: number;
  totalFolders: number;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  default: boolean;
  count: number;
  bytes: number;
}

export interface Capabilities {
  appName: string;
  version: string;
  storageConfigured: boolean;
  authRequired: boolean;
  passwordLoginEnabled: boolean;
  sessionTtlSeconds: number;
  setupInstructions: string[] | null;
  limits: {
    maxUploadBytes: number;
    multipartThresholdBytes: number;
    maxTagsPerAsset: number;
    maxTagLength: number;
  };
  presign: { uploadExpiresSeconds: number; downloadExpiresSeconds: number };
  supportedExtensions: string[];
  defaultCollections: string[];
  collections: Array<{ id: string; name: string; default: boolean }>;
  previewSupport: { native: string[]; threeD: string[]; downloadOnly: string[] };
}

export interface HealthResponse {
  status: 'ok' | 'setup_required' | 'degraded';
  version: string;
  uptimeSeconds: number;
  time: string;
  authRequired: boolean;
  storage: {
    configured: boolean;
    endpoint: string;
    bucket: string;
    region: string;
    checked: boolean;
    reachable: boolean | null;
    error: string | null;
  };
  limits: { maxUploadBytes: number; multipartThresholdBytes: number };
}

export interface RescanResult {
  added: number;
  kept: number;
  removed: number;
  totalObjects: number;
  totalAssets: number;
  skippedKeys: string[];
}

export interface SingleUploadTicket {
  mode: 'single';
  assetId: string;
  folderId?: string | null;
  /** Preview of the automatic version title, e.g. "City Builder v3". */
  versionPreview?: string | null;
  key: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  contentType: string;
  expiresIn: number;
}

export interface MultipartUploadTicket {
  mode: 'multipart';
  assetId: string;
  folderId?: string | null;
  versionPreview?: string | null;
  key: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
  partUrls: Array<{ partNumber: number; url: string }>;
  contentType: string;
  expiresIn: number;
}

export type UploadTicket = SingleUploadTicket | MultipartUploadTicket;

export interface UploadOptions {
  collection: string;
  /** Folder the asset is filed in (null = not filed). */
  folderId: string | null;
  /** Name ZIP bundles "<folder> v1, v2, v3" (Game/App collections only). */
  autoVersion: boolean;
  tags: string[];
  description: string;
}
