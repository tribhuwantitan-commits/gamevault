import { Suspense, lazy, useState } from 'react';
import type { Asset } from '../../lib/types';
import { formatBytes, kindLabel } from '../../lib/format';
import { Icon } from '../Icon';
import { Spinner } from '../ui';

const Model3DViewer = lazy(() => import('./Model3DViewer'));

/** Formats with a real in-browser loader. Everything else stays download-only. */
const MODEL_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'fbx'] as const;

const modelFormat = (asset: Asset): (typeof MODEL_FORMATS)[number] | null => {
  const ext = asset.extension.toLowerCase();
  return asset.kind === 'model3d' && (MODEL_FORMATS as readonly string[]).includes(ext)
    ? (ext as (typeof MODEL_FORMATS)[number])
    : null;
};

export function AssetPreview({
  asset,
  onDownload,
}: {
  asset: Asset;
  onDownload: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const src = asset.fileUrl;

  if (asset.kind === 'image' && !imageFailed) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-[repeating-conic-gradient(rgb(var(--surface-2))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
        <img
          src={src}
          alt={asset.displayName}
          className="max-h-full max-w-full object-contain"
          onError={() => setImageFailed(true)}
          loading="eager"
        />
      </div>
    );
  }

  if (asset.kind === 'audio') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-5 rounded-xl bg-surface2 p-6">
        <div className="flex h-16 items-end gap-1.5" aria-hidden="true">
          {[18, 34, 52, 28, 62, 40, 24, 48, 30, 56, 22, 38].map((height, index) => (
            <span
              key={index}
              className="w-1.5 rounded-full bg-accent/70"
              style={{ height: `${height}px` }}
            />
          ))}
        </div>
        <audio src={src} controls preload="metadata" className="w-full max-w-md">
          Your browser cannot play this audio file.
        </audio>
        <p className="text-xs text-muted">
          {asset.extension.toUpperCase()} · {formatBytes(asset.size)}
        </p>
      </div>
    );
  }

  if (asset.kind === 'video') {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black">
        <video src={src} controls preload="metadata" className="max-h-full max-w-full">
          Your browser cannot play this video file.
        </video>
      </div>
    );
  }

  const format = modelFormat(asset);
  if (format) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center gap-2 rounded-xl bg-surface2 text-sm text-muted">
            <Spinner size={16} /> Preparing 3D viewer…
          </div>
        }
      >
        <Model3DViewer url={src} filename={asset.displayName} format={format} />
      </Suspense>
    );
  }

  // Honestly report what we cannot render in the browser.
  const reason =
    asset.kind === 'model3d'
      ? `${asset.extension.toUpperCase()} has no browser loader in this build. Use your DCC tool, or export to GLB/GLTF/OBJ/STL/FBX for an in-app 3D preview.`
      : asset.kind === 'archive'
        ? 'Archives are stored as-is. Download to extract and inspect the contents.'
        : asset.kind === 'project'
          ? 'Engine and project files are stored as-is; they cannot be rendered in a browser.'
          : asset.kind === 'font'
            ? 'Font files can be downloaded to install or inspect.'
            : 'This format has no in-browser preview. Download the file to open it locally.';

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-surface2/60 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-muted">
        <Icon name="file" size={22} />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">
          {asset.extension.toUpperCase()} · {kindLabel(asset.kind)}
        </p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{reason}</p>
      </div>
      <button type="button" className="gv-btn-primary mt-1" onClick={onDownload}>
        <Icon name="download" size={15} /> Download {formatBytes(asset.size)}
      </button>
    </div>
  );
}

/** Small thumbnail used in cards and rows. */
export function AssetThumb({ asset, className = '' }: { asset: Asset; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (asset.kind === 'image' && !failed) {
    return (
      <img
        src={asset.fileUrl}
        alt={asset.displayName}
        loading="lazy"
        decoding="async"
        className={`h-full w-full object-cover ${className}`}
        onError={() => setFailed(true)}
      />
    );
  }

  const iconName =
    asset.kind === 'audio'
      ? 'audio'
      : asset.kind === 'video'
        ? 'video'
        : asset.kind === 'model3d'
          ? 'cube'
          : asset.kind === 'archive'
            ? 'archive'
            : asset.kind === 'project'
              ? 'code'
              : 'file';

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1.5 bg-surface2 text-muted ${className}`}
    >
      <Icon name={iconName} size={26} />
      <span className="rounded bg-surface/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        {asset.extension}
      </span>
    </div>
  );
}
