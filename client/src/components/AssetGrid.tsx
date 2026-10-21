import { useState, type ReactNode } from 'react';
import type { Asset } from '../lib/types';
import { ApiError } from '../lib/api';
import { downloadAsset } from '../lib/download';
import { useLibrary } from '../store/LibraryContext';
import { useToast } from '../store/ToastContext';
import { AssetCard, AssetRow } from './AssetCard';
import { AssetDetailModal } from './AssetDetailModal';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState, SkeletonCard } from './ui';

interface Props {
  assets: Asset[];
  view: 'grid' | 'list';
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  emptyIcon?: 'library' | 'search' | 'upload' | 'folder';
  onChanged?: () => void;
}

export function AssetGrid({
  assets,
  view,
  loading = false,
  emptyTitle = 'No assets yet',
  emptyDescription = 'Upload your first game asset to see it here.',
  emptyAction,
  emptyIcon = 'library',
  onChanged,
}: Props) {
  const { removeAsset } = useLibrary();
  const { push } = useToast();
  const [selected, setSelected] = useState<Asset | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDownload = async (asset: Asset) => {
    try {
      const filename = await downloadAsset(asset.id);
      push({ tone: 'success', title: 'Download started', description: filename });
    } catch (err) {
      push({
        tone: 'error',
        title: 'Download failed',
        description: err instanceof ApiError ? err.message : 'Unexpected error while creating the download link.',
      });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await removeAsset(pendingDelete.id);
      push({
        tone: 'success',
        title: 'Asset deleted',
        description: `${pendingDelete.displayName} was removed from the bucket.`,
      });
      setPendingDelete(null);
      onChanged?.();
    } catch (err) {
      push({
        tone: 'error',
        title: 'Delete failed',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading && assets.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <>
      {view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onOpen={setSelected}
              onDownload={handleDownload}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="hidden items-center gap-3 border-b border-line bg-surface2/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted md:flex">
            <span className="flex-1">Asset</span>
            <span className="hidden w-28 shrink-0 md:block">Collection</span>
            <span className="hidden w-32 shrink-0 lg:block">Tags</span>
            <span className="w-[72px] shrink-0 text-right">Actions</span>
          </div>
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              onOpen={setSelected}
              onDownload={handleDownload}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      {selected ? (
        <AssetDetailModal
          asset={selected}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null);
            onChanged?.();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this asset?"
        description={
          <>
            <strong className="text-ink">{pendingDelete?.displayName}</strong> will be permanently deleted from
            the Filebase bucket. This cannot be undone.
          </>
        }
        confirmLabel="Delete asset"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
