import type { Folder } from '../lib/types';

/**
 * Big yellow folder icon.
 *
 * Solid-filled on purpose: at 56–96 px a stroke icon reads as a grey blob, while
 * a filled folder keeps the familiar "📁" silhouette the user asked for.
 */
export function FolderIcon({
  size = 64,
  open = false,
  className = '',
}: {
  size?: number;
  open?: boolean;
  className?: string;
}) {
  const id = `folder-grad-${size}-${open ? 'open' : 'closed'}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="8" y1="6" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffd75e" />
          <stop offset="55%" stopColor="#f7b733" />
          <stop offset="100%" stopColor="#e09b16" />
        </linearGradient>
      </defs>

      {/* back tab */}
      <path
        d="M6 16a5 5 0 015-5h12.2c1.5 0 2.9.7 3.8 1.8l2.6 3.2H52a5 5 0 015 5v3H6z"
        fill="#e7a91d"
      />

      {/* body */}
      <path
        d="M4 22a5 5 0 015-5h46a5 5 0 015 5v28a5 5 0 01-5 5H9a5 5 0 01-5-5z"
        fill={`url(#${id})`}
      />

      {/* front flap */}
      {open ? (
        <path
          d="M4 26h56l-6.4 24.5a5 5 0 01-4.8 3.5H9.9a5 5 0 01-4.8-3.7L1 30a4 4 0 013.9-4z"
          fill="#ffcf4a"
          opacity="0.96"
        />
      ) : (
        <path
          d="M4 26a4 4 0 014-4h48a4 4 0 014 4v.6H4z"
          fill="#ffe08a"
          opacity="0.85"
        />
      )}
    </svg>
  );
}

export function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: Folder;
  onOpen: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="gv-panel flex w-full flex-col items-center gap-2 p-4 text-center transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card"
      >
        <FolderIcon size={64} open={folder.assetCount + folder.folderCount > 0} />
        <span className="line-clamp-2 w-full break-words text-sm font-semibold leading-snug text-ink">
          {folder.name}
        </span>
        <span className="text-[11px] text-muted">
          {folder.folderCount > 0 ? `${folder.folderCount} folder${folder.folderCount === 1 ? '' : 's'} · ` : ''}
          {folder.totalAssetCount} asset{folder.totalAssetCount === 1 ? '' : 's'}
        </span>
      </button>

      {(onRename || onDelete) && (
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {onRename ? (
            <button
              type="button"
              onClick={onRename}
              className="gv-icon-btn h-7 w-7 bg-surface/90 backdrop-blur"
              aria-label={`Rename ${folder.name}`}
              title="Rename"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="gv-icon-btn h-7 w-7 bg-surface/90 text-danger backdrop-blur"
              aria-label={`Delete ${folder.name}`}
              title="Delete folder"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
