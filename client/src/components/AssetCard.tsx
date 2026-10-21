import type { Asset } from '../lib/types';
import { formatBytes, kindLabel, relativeTime } from '../lib/format';
import { AssetThumb } from './preview/AssetPreview';
import { Icon } from './Icon';
import { Badge } from './ui';

interface AssetCardProps {
  asset: Asset;
  onOpen: (asset: Asset) => void;
  onDownload: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
}

export function AssetCard({ asset, onOpen, onDownload, onDelete }: AssetCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:border-accent/40 hover:shadow-pop">
      <button
        type="button"
        onClick={() => onOpen(asset)}
        className="block w-full text-left"
        aria-label={`Open details for ${asset.displayName}`}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface2">
          <AssetThumb asset={asset} className="transition duration-300 group-hover:scale-[1.03]" />

          <div className="absolute left-2 top-2 flex gap-1.5">
            <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
              {asset.extension}
            </span>
            {asset.kind === 'model3d' && ['glb', 'gltf', 'obj', 'stl', 'fbx'].includes(asset.extension) ? (
              <span className="rounded-md bg-accent/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
                3D
              </span>
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/55 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
            <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white/85">
              {kindLabel(asset.kind)}
            </span>
          </div>
        </div>

        <div className="p-3.5">
          <h3 className="truncate text-sm font-semibold text-ink" title={asset.displayName}>
            {asset.displayName}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted">
            {formatBytes(asset.size)} · {relativeTime(asset.uploadedAt)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{asset.collection}</Badge>
            {asset.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="gv-chip max-w-[7rem] truncate">
                #{tag}
              </span>
            ))}
            {asset.tags.length > 2 ? <span className="gv-chip">+{asset.tags.length - 2}</span> : null}
          </div>
        </div>
      </button>

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDownload(asset);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition hover:bg-accent"
          title="Download"
          aria-label={`Download ${asset.displayName}`}
        >
          <Icon name="download" size={14} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(asset);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition hover:bg-danger"
          title="Delete"
          aria-label={`Delete ${asset.displayName}`}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </article>
  );
}

export function AssetRow({
  asset,
  onOpen,
  onDownload,
  onDelete,
}: AssetCardProps) {
  return (
    <div className="group flex items-center gap-3 border-b border-line px-3 py-2.5 transition last:border-0 hover:bg-surface2/60">
      <button
        type="button"
        onClick={() => onOpen(asset)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface2">
          <AssetThumb asset={asset} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{asset.displayName}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span className="uppercase">{asset.extension}</span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(asset.size)}</span>
            <span className="hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline">{relativeTime(asset.uploadedAt)}</span>
          </span>
        </span>
        <span className="hidden shrink-0 md:block">
          <Badge tone="accent">{asset.collection}</Badge>
        </span>
        <span className="hidden w-32 shrink-0 flex-wrap gap-1 lg:flex">
          {asset.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="gv-chip max-w-[6rem] truncate">
              #{tag}
            </span>
          ))}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onDownload(asset)}
          className="gv-icon-btn h-8 w-8"
          title="Download"
          aria-label={`Download ${asset.displayName}`}
        >
          <Icon name="download" size={15} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(asset)}
          className="gv-icon-btn h-8 w-8 hover:bg-danger/10 hover:text-danger"
          title="Delete"
          aria-label={`Delete ${asset.displayName}`}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}
