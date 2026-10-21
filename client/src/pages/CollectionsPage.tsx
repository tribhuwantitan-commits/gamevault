import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useLibrary } from '../store/LibraryContext';
import { useToast } from '../store/ToastContext';
import { Icon } from '../components/Icon';
import { Badge, Spinner } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function CollectionsPage() {
  const { collections, stats, createCollection, deleteCollection } = useLibrary();
  const { push } = useToast();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await createCollection(trimmed);
      setName('');
      push({ tone: 'success', title: 'Collection created', description: `“${trimmed}” is ready to use.` });
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not create collection',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteCollection(pendingDelete.id);
      push({ tone: 'success', title: 'Collection deleted', description: pendingDelete.name });
      setPendingDelete(null);
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not delete collection',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setDeleting(false);
    }
  };

  const totalAssets = stats?.totalAssets ?? 0;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Collections</h1>
        <p className="mt-1 text-sm text-muted">
          Organise assets into buckets of your own — buildings, characters, vehicles, environments, UI,
          textures, audio, animations, and anything else you need.
        </p>
      </header>

      <form onSubmit={submit} className="gv-panel flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[12rem] flex-1">
          <label className="gv-label" htmlFor="new-collection">
            New collection
          </label>
          <input
            id="new-collection"
            className="gv-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Weapons, Shaders, VFX"
            maxLength={48}
          />
        </div>
        <button type="submit" className="gv-btn-primary" disabled={creating || !name.trim()}>
          {creating ? <Spinner size={15} /> : <Icon name="plus" size={15} />}
          Add collection
        </button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {collections.map((collection) => {
          const isEmpty = collection.count === 0;
          return (
            <div
              key={collection.id}
              className="gv-panel flex flex-col gap-3 p-4 shadow-card transition hover:border-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to={`/collections/${encodeURIComponent(collection.name)}`}
                    className="truncate text-sm font-semibold text-ink hover:text-accent"
                  >
                    {collection.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {collection.count} asset{collection.count === 1 ? '' : 's'} · {formatBytes(collection.bytes)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {collection.default ? <Badge tone="neutral">Built-in</Badge> : <Badge tone="accent">Custom</Badge>}
                  {!collection.default ? (
                    <button
                      type="button"
                      className="gv-icon-btn h-7 w-7 hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                      onClick={() => setPendingDelete({ id: collection.id, name: collection.name })}
                      disabled={!isEmpty}
                      title={isEmpty ? 'Delete collection' : 'Move its assets out first'}
                      aria-label={`Delete collection ${collection.name}`}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
                <div
                  className="h-full rounded-full bg-accent/70"
                  style={{
                    width: totalAssets > 0 ? `${Math.max(2, (collection.count / totalAssets) * 100)}%` : '0%',
                  }}
                />
              </div>

              <Link
                to={`/collections/${encodeURIComponent(collection.name)}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                Browse <Icon name="chevronRight" size={12} />
              </Link>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete collection?"
        description={
          <>
            “{pendingDelete?.name}” will be removed from your collection list. Assets are not touched — only empty
            custom collections can be deleted.
          </>
        }
        confirmLabel="Delete collection"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
