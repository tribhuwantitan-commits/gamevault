import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Asset, Folder } from '../lib/types';
import { useLibrary } from '../store/LibraryContext';
import { useToast } from '../store/ToastContext';
import { useUploads } from '../store/UploadContext';
import { FolderCard, FolderIcon } from '../components/FolderIcon';
import { AssetGrid } from '../components/AssetGrid';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/ui';

/**
 * Folder browser.
 *
 * Folders nest to any depth (City Builder → Commercial Building → Windows).
 * One component serves every level: /folders is the root, /folders/:id is a
 * folder. Sub-folders and the folder's own assets are shown together.
 */
export function FoldersPage() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const { folders, foldersLoading, refreshFolders, childFolders, folderById, createFolder, renameFolder, deleteFolder, view, setView } =
    useLibrary();
  const { configure, configuration } = useUploads();

  const currentId = folderId ?? null;
  const current = folderById(currentId);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Folder | null>(null);

  const children = useMemo(() => childFolders(currentId), [childFolders, currentId]);

  // Breadcrumb: /City Builder/Commercial Building
  const crumbs = useMemo(() => {
    const chain: Folder[] = [];
    let node = current;
    let guard = 0;
    while (node && guard < 32) {
      chain.unshift(node);
      node = folderById(node.parentId);
      guard += 1;
    }
    return chain;
  }, [current, folderById]);

  const loadAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const data = await api.listAssets({
        folder: currentId ?? 'root',
        pageSize: 100,
        sort: 'newest',
      });
      setAssets(data.items);
    } catch {
      setAssets([]);
    } finally {
      setLoadingAssets(false);
    }
  }, [currentId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    void refreshFolders();
  }, [refreshFolders]);

  // Uploads made from inside a folder land in that folder by default.
  useEffect(() => {
    if (!current) return;
    configure({ ...configuration, folderId: current.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (folderId && !foldersLoading && !current) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">That folder no longer exists.</p>
        <Link to="/folders" className="gv-btn-secondary">
          Back to folders
        </Link>
      </div>
    );
  }

  const submitFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const folder = await createFolder(name, currentId);
      setNewName('');
      setCreating(false);
      push({ tone: 'success', title: 'Folder created', description: folder.path });
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not create folder',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    setBusy(true);
    try {
      await renameFolder(renaming.id, renaming.name.trim());
      setRenaming(null);
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not rename',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (mode: 'move' | 'delete') => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteFolder(pendingDelete.id, mode);
      push({
        tone: 'success',
        title: 'Folder deleted',
        description:
          mode === 'move'
            ? 'Its assets were moved to Other instead of being deleted.'
            : 'The folder and its assets were deleted.',
      });
      setPendingDelete(null);
      if (pendingDelete.id === currentId) navigate('/folders');
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not delete folder',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
        <Link to="/folders" className="hover:text-ink">
          Folders
        </Link>
        {crumbs.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <Icon name="chevronRight" size={12} />
            <Link to={`/folders/${crumb.id}`} className="hover:text-ink">
              {crumb.name}
            </Link>
          </span>
        ))}
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <FolderIcon size={56} open={children.length + assets.length > 0} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {current?.name ?? 'Folders'}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {current
                ? `${children.length} folder${children.length === 1 ? '' : 's'} · ${assets.length} asset${assets.length === 1 ? '' : 's'} here`
                : 'One folder per game or app — put its 2D, 3D, audio and ZIP files inside.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${view === 'grid' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`}
              aria-pressed={view === 'grid'}
              title="Grid view"
            >
              <Icon name="grid" size={15} />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${view === 'list' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`}
              aria-pressed={view === 'list'}
              title="List view"
            >
              <Icon name="list" size={15} />
            </button>
          </div>
          <button type="button" className="gv-btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New folder
          </button>
        </div>
      </header>

      {creating ? (
        <form onSubmit={submitFolder} className="gv-panel flex flex-wrap items-end gap-2 p-3">
          <div className="min-w-[12rem] flex-1">
            <label className="gv-label" htmlFor="new-folder">
              Folder name{current ? ` inside “${current.name}”` : ''}
            </label>
            <input
              id="new-folder"
              className="gv-input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={current ? 'e.g. Commercial Building, Roads, Cars' : 'e.g. City Builder, Kingdom Castle'}
              maxLength={64}
              autoFocus
            />
          </div>
          <button type="submit" className="gv-btn-primary" disabled={busy || !newName.trim()}>
            {busy ? <Spinner size={15} /> : <Icon name="check" size={15} />}
            Create
          </button>
          <button type="button" className="gv-btn-secondary" onClick={() => setCreating(false)} disabled={busy}>
            Cancel
          </button>
        </form>
      ) : null}

      {foldersLoading && folders.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size={15} /> Loading folders…
        </div>
      ) : null}

      {children.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Folders</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {children.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onOpen={() => navigate(`/folders/${folder.id}`)}
                onRename={() => setRenaming({ id: folder.id, name: folder.name })}
                onDelete={() => setPendingDelete(folder)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        {children.length > 0 || assets.length > 0 ? (
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Assets{current ? ` in ${current.name}` : ' not filed in a folder'}
          </h2>
        ) : null}
        <AssetGrid
          assets={assets}
          view={view}
          loading={loadingAssets}
          emptyIcon="folder"
          emptyTitle={current ? `${current.name} is empty` : 'No folders yet'}
          emptyDescription={
            current
              ? 'Create a sub-folder (Commercial Building, Roads, Cars…) or upload files straight into this folder.'
              : 'Start with a folder per game or app — City Builder, Kingdom Castle — then nest sub-folders inside.'
          }
          emptyAction={
            <button type="button" className="gv-btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> New folder
            </button>
          }
          onChanged={() => {
            void loadAssets();
            void refreshFolders();
          }}
        />
      </section>

      {renaming ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <form onSubmit={submitRename} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-pop">
            <h2 className="text-sm font-semibold text-ink">Rename folder</h2>
            <p className="mt-1 text-xs text-muted">
              Versioned files keep the name they were uploaded with (City Builder v1, v2…).
            </p>
            <input
              className="gv-input mt-3"
              value={renaming.name}
              onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
              maxLength={64}
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="gv-btn-secondary" onClick={() => setRenaming(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="gv-btn-primary" disabled={busy || !renaming.name.trim()}>
                {busy ? <Spinner size={15} /> : <Icon name="check" size={15} />} Save
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        description={
          <>
            Its sub-folders move up one level. Choose what happens to the assets inside:{' '}
            <strong>Move to Other</strong> keeps everything, <strong>Delete all</strong> removes the files from
            the bucket too.
          </>
        }
        confirmLabel="Move assets to Other"
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete('move')}
      />

      {pendingDelete ? (
        <div className="flex justify-center">
          <button
            type="button"
            className="text-[11px] font-medium text-danger hover:underline"
            onClick={() => void confirmDelete('delete')}
            disabled={busy}
          >
            Delete folder and its files permanently
          </button>
        </div>
      ) : null}
    </div>
  );
}
