import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Asset } from '../lib/types';
import { formatBytes } from '../lib/format';
import { useLibrary } from '../store/LibraryContext';
import { Icon } from '../components/Icon';
import { AssetGrid } from '../components/AssetGrid';
import { Spinner } from '../components/ui';

export function CollectionDetailPage() {
  const { name = '' } = useParams();
  const { view, setView } = useLibrary();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listAssets({ collection: name, pageSize: 100, sort: 'newest' });
      setAssets(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this collection.');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const bytes = assets.reduce((sum, asset) => sum + asset.size, 0);

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
        <Link to="/collections" className="hover:text-ink">
          Collections
        </Link>
        <Icon name="chevronRight" size={12} />
        <span className="font-medium text-ink">{name}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{name}</h1>
          <p className="mt-1 text-sm text-muted">
            {loading ? 'Loading…' : `${assets.length} asset${assets.length === 1 ? '' : 's'} · ${formatBytes(bytes)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                view === 'grid' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
              }`}
              aria-pressed={view === 'grid'}
              title="Grid view"
            >
              <Icon name="grid" size={15} />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                view === 'list' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
              }`}
              aria-pressed={view === 'list'}
              title="List view"
            >
              <Icon name="list" size={15} />
            </button>
          </div>
          <button type="button" className="gv-btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner size={15} /> : <Icon name="refresh" size={15} />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
          <Icon name="alert" size={16} className="text-danger" />
          <span className="flex-1">{error}</span>
          <button type="button" className="gv-btn-secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <AssetGrid
        assets={assets}
        view={view}
        loading={loading}
        emptyIcon="folder"
        emptyTitle={`Nothing in ${name} yet`}
        emptyDescription="Upload a file and pick this collection, or move an existing asset here from its detail panel."
        emptyAction={
          <Link to="/assets" className="gv-btn-secondary">
            Browse all assets
          </Link>
        }
        onChanged={() => void load()}
      />
    </div>
  );
}
