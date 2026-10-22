import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLibrary } from '../store/LibraryContext';
import { useTheme } from '../store/ThemeContext';
import { useUploads } from '../store/UploadContext';
import { Icon, type IconName } from './Icon';
import { UploadModal } from './UploadModal';
import { Spinner } from './ui';

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/folders', label: 'Folders', icon: 'folder' },
  { to: '/assets', label: 'All Assets', icon: 'library' },
  { to: '/collections', label: 'Collections', icon: 'tag' },
  { to: '/uploads', label: 'Uploads', icon: 'upload' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Layout() {
  const { capabilities, collections, stats, filters, setFilters, hasToken } = useLibrary();
  const { theme, toggleTheme } = useTheme();
  const { activeCount } = useUploads();
  const navigate = useNavigate();
  const location = useLocation();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);

  // Debounced global search: lands on the asset library.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search === filters.q) return;
      setFilters({ q: search });
      if (location.pathname !== '/assets') navigate('/assets');
    }, 300);
    return () => clearTimeout(handle);
  }, [search, filters.q, setFilters, navigate, location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const storageConfigured = capabilities?.storageConfigured ?? false;

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm">
          <Icon name="cube" size={19} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-ink">GameVault</p>
          <p className="truncate text-[11px] text-muted">Game asset library</p>
        </div>
      </div>

      <nav className="space-y-0.5" aria-label="Main navigation">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `gv-sidebar-link ${isActive ? 'gv-sidebar-link-active' : ''}`
            }
          >
            <Icon name={item.icon} size={17} />
            <span className="flex-1">{item.label}</span>
            {item.to === '/uploads' && activeCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
                {activeCount}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Collections
        </p>
        <div className="space-y-0.5">
          {collections.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted">No collections yet</p>
          ) : (
            collections.map((collection) => (
              <NavLink
                key={collection.id}
                to={`/collections/${encodeURIComponent(collection.name)}`}
                className={({ isActive }) => `gv-sidebar-link py-1.5 pl-4 text-[13px] ${isActive ? 'gv-sidebar-link-active' : ''}`}
              >
                <span className="flex-1 truncate">{collection.name}</span>
                <span className="text-[11px] tabular-nums text-muted">{collection.count}</span>
              </NavLink>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface2/60 p-2.5 text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${storageConfigured ? 'bg-success' : 'bg-warn'}`}
            aria-hidden="true"
          />
          <span className="font-medium text-ink">
            {storageConfigured ? 'Filebase connected' : 'Setup required'}
          </span>
        </div>
        <p className="mt-1 truncate" title={capabilities?.authRequired ? 'Token protected' : 'No access token'}>
          {capabilities?.storageConfigured
            ? `Bucket: ${capabilities?.appName === 'GameVault' ? 'gaming-asset' : 'gaming-asset'}`
            : 'Add credentials in server/.env'}
        </p>
        <p className="mt-0.5">{stats ? `${stats.totalAssets} assets · ${stats.totalBytesLabel}` : '—'}</p>
        <div className="mt-1.5 flex items-center gap-1">
          <Icon name="lock" size={11} />
          <span>{hasToken ? 'Token active' : 'Private API'}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface shadow-pop animate-slide-up">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-5">
            <button
              type="button"
              className="gv-icon-btn lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" size={18} />
            </button>

            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <Icon name="search" size={16} />
              </span>
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search assets…"
                className="gv-input h-9 pl-9 pr-14 sm:h-10"
                aria-label="Search the asset library"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted sm:block">
                {search ? '⌘K' : '/'}
              </span>
            </div>

            <button
              type="button"
              className="gv-icon-btn shrink-0"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>

            <button
              type="button"
              className="gv-btn-primary h-9 shrink-0 sm:h-10"
              onClick={() => setUploadOpen(true)}
            >
              {activeCount > 0 ? <Spinner size={15} /> : <Icon name="upload" size={16} />}
              <span className="hidden sm:inline">{activeCount > 0 ? `Uploading ${activeCount}` : 'Upload'}</span>
              <span className="sm:hidden">Upload</span>
            </button>
          </div>

          {!storageConfigured && capabilities ? (
            <div className="border-t border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-ink sm:px-5">
              <span className="flex items-center gap-1.5">
                <Icon name="alert" size={13} className="text-warn" />
                <span className="font-medium">Setup mode:</span>
                <span className="truncate text-muted">
                  Filebase credentials are missing, so uploads and downloads are disabled.{' '}
                  <a className="underline decoration-warn/50 underline-offset-2" href="/settings">
                    View setup steps
                  </a>
                </span>
              </span>
            </div>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
          <Outlet />
        </main>
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
