import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Asset } from '../lib/types';
import { formatBytes, kindLabel, relativeTime } from '../lib/format';
import { useLibrary } from '../store/LibraryContext';
import { Icon } from '../components/Icon';
import { AssetGrid } from '../components/AssetGrid';
import { Badge, StatCard } from '../components/ui';

export function DashboardPage() {
  const { stats, capabilities, loading, needsToken, refreshStats } = useLibrary();
  const navigate = useNavigate();
  const [recent, setRecent] = useState<Asset[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const data = await api.listAssets({ pageSize: 8, sort: 'newest' });
      setRecent(data.items);
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (needsToken) {
      setRecentLoading(false);
      return;
    }
    void loadRecent();
  }, [loadRecent, needsToken, stats?.totalAssets, stats?.latestUploadAt]);

  const kindRows = useMemo(() => {
    if (!stats) return [];
    const total = stats.totalAssets || 1;
    return Object.entries(stats.byKind)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([kind, value]) => ({
        kind,
        count: value.count,
        bytes: value.bytes,
        percent: Math.round((value.count / total) * 100),
      }));
  }, [stats]);

  const isEmpty = (stats?.totalAssets ?? 0) === 0 && !loading;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Your private game asset library, stored in Filebase. Nothing here is shared publicly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="gv-btn-secondary"
            onClick={() => {
              void refreshStats();
              void loadRecent();
            }}
          >
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <Link to="/assets" className="gv-btn-primary">
            <Icon name="library" size={16} /> Open library
          </Link>
        </div>
      </header>

      {capabilities && !capabilities.storageConfigured ? (
        <section className="rounded-2xl border border-warn/40 bg-warn/10 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warn/20 text-warn">
              <Icon name="alert" size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink">Finish setup to start uploading</h2>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs leading-relaxed text-muted">
                {(capabilities.setupInstructions ?? []).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <Link to="/settings" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                Open settings <Icon name="chevronRight" size={12} />
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total assets"
          value={loading ? '—' : String(stats?.totalAssets ?? 0)}
          hint={isEmpty ? 'Library is empty' : `${stats?.byCollection ? Object.keys(stats.byCollection).length : 0} collections in use`}
          icon="library"
          accent
        />
        <StatCard
          label="Storage used"
          value={loading ? '—' : (stats?.totalBytesLabel ?? '0 B')}
          hint="Sum of asset sizes in Filebase"
          icon="cloud"
        />
        <StatCard
          label="Uploaded (7 days)"
          value={loading ? '—' : String(stats?.recentUploads ?? 0)}
          hint={stats?.latestUploadAt ? `Last: ${relativeTime(stats.latestUploadAt)}` : 'No uploads yet'}
          icon="upload"
        />
        <StatCard
          label="Previewable"
          value={
            loading
              ? '—'
              : String(
                  (stats?.byKind.image?.count ?? 0) +
                    (stats?.byKind.audio?.count ?? 0) +
                    (stats?.byKind.video?.count ?? 0) +
                    (stats?.byKind.model3d?.count ?? 0),
                )
          }
          hint="Images, audio, video, glTF"
          icon="image"
        />
      </section>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent uploads</h2>
            {recent.length > 0 ? (
              <Link to="/assets" className="text-xs font-medium text-accent hover:underline">
                View all
              </Link>
            ) : null}
          </div>
          <AssetGrid
            assets={recent}
            view="grid"
            loading={recentLoading}
            emptyIcon="upload"
            emptyTitle="No assets in the library yet"
            emptyDescription="Your bucket index is empty. Use the Upload button to add textures, models, audio or any other game asset — the library only ever shows what really exists in Filebase."
            emptyAction={
              <button type="button" className="gv-btn-primary" onClick={() => navigate('/uploads')}>
                <Icon name="upload" size={15} /> Go to uploads
              </button>
            }
            onChanged={() => {
              void loadRecent();
              void refreshStats();
            }}
          />
        </section>

        <aside className="space-y-4">
          <section className="gv-panel p-4">
            <h2 className="text-sm font-semibold text-ink">Library by type</h2>
            {kindRows.length === 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Nothing stored yet. Type breakdown appears after your first upload.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {kindRows.map((row) => (
                  <li key={row.kind}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">{kindLabel(row.kind)}</span>
                      <span className="tabular-nums text-muted">
                        {row.count} · {formatBytes(row.bytes)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2">
                      <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(2, row.percent)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="gv-panel p-4">
            <h2 className="text-sm font-semibold text-ink">Top tags</h2>
            {stats?.topTags.length ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {stats.topTags.map((tag) => (
                  <Link
                    key={tag.tag}
                    to={`/assets?tag=${encodeURIComponent(tag.tag)}`}
                    className="gv-chip transition hover:border-accent/40 hover:text-accent"
                  >
                    #{tag.tag} <span className="tabular-nums opacity-60">{tag.count}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Tags help you find assets fast. Add them when uploading or from an asset’s detail panel.
              </p>
            )}
          </section>

          <section className="gv-panel p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Icon name="lock" size={14} /> Privacy
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              The bucket stays private. Previews and downloads use short-lived presigned URLs minted by the API
              — credentials never reach this browser.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={capabilities?.storageConfigured ? 'success' : 'warn'}>
                {capabilities?.storageConfigured ? 'Storage connected' : 'Storage not configured'}
              </Badge>
              <Badge tone={capabilities?.authRequired ? 'accent' : 'neutral'}>
                {capabilities?.authRequired ? 'Token required' : 'No API token set'}
              </Badge>
            </div>
          </section>
        </aside>
      </div>

    </div>
  );
}
