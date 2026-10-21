import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLibrary } from '../store/LibraryContext';
import { Icon } from '../components/Icon';
import { AssetGrid } from '../components/AssetGrid';
import { Pagination, Spinner } from '../components/ui';
import type { SortKey } from '../lib/types';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A → Z' },
  { value: 'name-desc', label: 'Name Z → A' },
  { value: 'size-desc', label: 'Largest first' },
  { value: 'size-asc', label: 'Smallest first' },
];

const KINDS = [
  { value: 'all', label: 'All types' },
  { value: 'image', label: 'Images & textures' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'model3d', label: '3D models' },
  { value: 'archive', label: 'Archives' },
  { value: 'project', label: 'Project files' },
  { value: 'font', label: 'Fonts' },
];

export function AssetsPage() {
  const {
    assets,
    total,
    page,
    totalPages,
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
    loading,
    fetching,
    error,
    refresh,
    view,
    setView,
    collections,
    stats,
  } = useLibrary();

  const [searchParams, setSearchParams] = useSearchParams();

  // Deep links: /assets?tag=wood&q=castle&collection=Buildings
  useEffect(() => {
    const tag = searchParams.get('tag') ?? '';
    const q = searchParams.get('q') ?? '';
    const collection = searchParams.get('collection') ?? 'All';
    if (!tag && !q && collection === 'All') return;
    setFilters({ tag, q, collection });
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = total === 0 ? 0 : (page - 1) * filters.pageSize + 1;
  const end = Math.min(total, page * filters.pageSize);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">All assets</h1>
          <p className="mt-1 text-sm text-muted">
            {loading ? 'Loading library…' : `${total} asset${total === 1 ? '' : 's'}${total > 0 ? ` · showing ${start}–${end}` : ''}`}
            {stats ? ` · ${stats.totalBytesLabel} stored` : ''}
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
          <button type="button" className="gv-btn-secondary" onClick={() => void refresh()} disabled={fetching}>
            {fetching ? <Spinner size={15} /> : <Icon name="refresh" size={15} />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <section className="gv-panel flex flex-wrap items-center gap-2 p-2.5">
        <label className="sr-only" htmlFor="filter-collection">
          Collection
        </label>
        <select
          id="filter-collection"
          className="gv-input h-9 w-auto min-w-[9rem] py-1.5 text-xs"
          value={filters.collection}
          onChange={(event) => setFilters({ collection: event.target.value })}
        >
          <option value="All">All collections</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.name}>
              {collection.name} ({collection.count})
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-kind">
          File type
        </label>
        <select
          id="filter-kind"
          className="gv-input h-9 w-auto min-w-[8rem] py-1.5 text-xs"
          value={filters.kind}
          onChange={(event) => setFilters({ kind: event.target.value })}
        >
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-sort">
          Sort
        </label>
        <select
          id="filter-sort"
          className="gv-input h-9 w-auto min-w-[9rem] py-1.5 text-xs"
          value={filters.sort}
          onChange={(event) => setFilters({ sort: event.target.value as SortKey })}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {filters.q ? (
          <span className="gv-chip">
            “{filters.q}”
            <button type="button" onClick={() => setFilters({ q: '' })} aria-label="Clear search">
              <Icon name="close" size={11} />
            </button>
          </span>
        ) : null}

        {filters.tag ? (
          <span className="gv-chip border-accent/30 text-accent">
            #{filters.tag}
            <button type="button" onClick={() => setFilters({ tag: '' })} aria-label="Clear tag filter">
              <Icon name="close" size={11} />
            </button>
          </span>
        ) : null}

        {hasActiveFilters ? (
          <button type="button" className="ml-auto text-xs font-medium text-muted hover:text-ink" onClick={clearFilters}>
            Clear all filters
          </button>
        ) : null}
      </section>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">Could not load the library</p>
            <p className="mt-0.5 text-xs text-muted">{error}</p>
          </div>
          <button type="button" className="gv-btn-secondary shrink-0" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      <AssetGrid
        assets={assets}
        view={view}
        loading={loading}
        emptyIcon={hasActiveFilters ? 'search' : 'upload'}
        emptyTitle={hasActiveFilters ? 'No assets match these filters' : 'Your library is empty'}
        emptyDescription={
          hasActiveFilters
            ? 'Try a different search term, clear the filters, or upload something new.'
            : 'Upload PNG, JPG, WebP, SVG, GLB, GLTF, FBX, OBJ, BLEND, WAV, MP3, OGG, MP4, ZIP, and more. Everything is stored privately in your Filebase bucket.'
        }
        emptyAction={
          hasActiveFilters ? (
            <button type="button" className="gv-btn-secondary" onClick={clearFilters}>
              Clear filters
            </button>
          ) : undefined
        }
        onChanged={() => void refresh()}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPage={(next) => {
          setFilters({ page: next });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
