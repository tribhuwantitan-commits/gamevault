import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, getToken, setToken } from '../lib/api';
import type {
  Asset,
  Capabilities,
  Collection,
  Folder,
  HealthResponse,
  SortKey,
  Stats,
} from '../lib/types';

export interface Filters {
  q: string;
  collection: string;
  /** Folder filter: '' = every asset, 'root' = not filed, else a folder id. */
  folder: string;
  kind: string;
  tag: string;
  sort: SortKey;
  page: number;
  pageSize: number;
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  collection: 'All',
  folder: '',
  kind: 'all',
  tag: '',
  sort: 'newest',
  page: 1,
  pageSize: 24,
};

const VIEW_KEY = 'gamevault.view';

interface LibraryContextValue {
  capabilities: Capabilities | null;
  capsLoading: boolean;
  refreshCapabilities: () => Promise<void>;

  health: HealthResponse | null;
  checkingHealth: boolean;
  checkHealth: (deep?: boolean) => Promise<HealthResponse | null>;

  assets: Asset[];
  total: number;
  page: number;
  totalPages: number;
  stats: Stats | null;
  loading: boolean;
  fetching: boolean;
  error: string | null;

  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;

  view: 'grid' | 'list';
  setView: (view: 'grid' | 'list') => void;

  refresh: () => Promise<void>;
  refreshStats: () => Promise<void>;
  updateAsset: (id: string, patch: Partial<Asset>) => Promise<Asset | null>;
  removeAsset: (id: string) => Promise<void>;
  addAsset: (asset: Asset) => void;

  collections: Collection[];
  refreshCollections: () => Promise<void>;

  folders: Folder[];
  foldersLoading: boolean;
  refreshFolders: () => Promise<void>;
  createFolder: (name: string, parentId: string | null) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string, mode?: 'move' | 'delete') => Promise<void>;
  moveAsset: (id: string, folderId: string | null) => Promise<void>;
  /** Child folders of `parentId` (null = top level), name-sorted. */
  childFolders: (parentId: string | null) => Folder[];
  folderById: (id: string | null) => Folder | null;
  createCollection: (name: string, description?: string) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;

  needsToken: boolean;
  setAccessToken: (token: string) => void;
  hasToken: boolean;

  /** Password login (GAMEVAULT_PASSWORD_HASH configured on the server). */
  passwordLoginEnabled: boolean;
  requiresLogin: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  lockNow: () => void;
  sessionExpiresAt: string | null;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capsLoading, setCapsLoading] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setViewState] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });

  const [collections, setCollections] = useState<Collection[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [needsToken, setNeedsToken] = useState(false);
  const [hasToken, setHasToken] = useState(Boolean(getToken()));
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const firstLoad = useRef(true);

  const handleApiError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        // Password login available -> send the user to the login screen.
        setRequiresLogin((current) => {
          if (current) return current;
          setNeedsToken(!passwordLoginEnabled);
          return passwordLoginEnabled;
        });
        return passwordLoginEnabled
          ? 'Your session ended. Please log in again.'
          : 'This library is protected. Enter your GameVault access token.';
      }
      if (err.code === 'storage_not_configured') return err.message;
      return err.message;
    }
    return err instanceof Error ? err.message : 'Something went wrong.';
  }, [passwordLoginEnabled]);

  const refreshCapabilities = useCallback(async () => {
    try {
      const caps = await api.capabilities();
      setCapabilities(caps);
      if (caps.authRequired) setNeedsToken(true);
    } catch (err) {
      setCapabilities(null);
      setNeedsToken(err instanceof ApiError && err.status === 401);
    } finally {
      setCapsLoading(false);
    }
  }, []);

  const refreshCollections = useCallback(async () => {
    try {
      const { collections: list } = await api.listCollections();
      setCollections(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsToken(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFetching(true);
    try {
      const data = await api.listAssets({
        q: filters.q || undefined,
        collection: filters.collection,
        folder: filters.folder || undefined,
        kind: filters.kind,
        tag: filters.tag || undefined,
        sort: filters.sort,
        page: filters.page,
        pageSize: filters.pageSize,
      });
      if (controller.signal.aborted) return;
      setAssets(data.items);
      setTotal(data.total);
      setPage(data.page);
      setTotalPages(data.totalPages);
      setStats(data.summary);
      setError(null);
      setNeedsToken(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(handleApiError(err));
    } finally {
      if (!controller.signal.aborted) {
        setFetching(false);
        setLoading(false);
        firstLoad.current = false;
      }
    }
  }, [filters, handleApiError]);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api.stats());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsToken(true);
    }
  }, []);

  const checkHealth = useCallback(async (deep = false) => {
    setCheckingHealth(true);
    try {
      const result = await api.healthRaw(deep);
      setHealth(result);
      return result;
    } catch {
      setHealth(null);
      return null;
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  const refreshFolders = useCallback(async () => {
    try {
      setFoldersLoading(true);
      const data = await api.listFolders();
      setFolders(data.folders);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsToken(true);
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  const createFolder = useCallback(
    async (name: string, parentId: string | null) => {
      const { folder } = await api.createFolder(name, parentId);
      await refreshFolders();
      return folder;
    },
    [refreshFolders],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      await api.renameFolder(id, name);
      await refreshFolders();
    },
    [refreshFolders],
  );

  const deleteFolder = useCallback(
    async (id: string, mode: 'move' | 'delete' = 'move') => {
      await api.deleteFolder(id, mode);
      await Promise.all([refreshFolders(), refresh()]);
    },
    [refreshFolders, refresh],
  );

  const moveAsset = useCallback(
    async (id: string, folderId: string | null) => {
      try {
        const { asset } = await api.patchAsset(id, { folderId });
        setAssets((current) => current.map((a) => (a.id === id ? asset : a)));
        void refreshFolders();
        void refreshStats();
      } catch (err) {
        throw err;
      }
    },
    [refreshFolders, refreshStats],
  );

  const childFolders = useCallback(
    (parentId: string | null) =>
      folders
        .filter((folder) => (folder.parentId ?? null) === (parentId ?? null))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  const folderById = useCallback(
    (id: string | null) => (id ? (folders.find((folder) => folder.id === id) ?? null) : null),
    [folders],
  );

  /** Read the (public) session state so the right gate is shown on first paint. */
  const refreshSession = useCallback(async () => {
    try {
      const info = await api.session();
      setPasswordLoginEnabled(info.passwordLoginEnabled);
      setSessionExpiresAt(info.expiresAt);
      if (info.passwordLoginEnabled) {
        setRequiresLogin(!info.authenticated);
        setNeedsToken(false);
      }
      return info;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshCapabilities();
    void refreshSession();
    void checkHealth();
  }, [refreshCapabilities, refreshSession, checkHealth]);

  useEffect(() => {
    if (needsToken) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, needsToken]);

  useEffect(() => {
    if (!needsToken) void refreshCollections();
  }, [refreshCollections, needsToken]);

  useEffect(() => {
    if (!needsToken) void refreshFolders();
  }, [refreshFolders, needsToken]);

  const setFilters = useCallback((patch: Partial<Filters>) => {
    setFiltersState((current) => {
      const next = { ...current, ...patch };
      // Any filter change except paging resets to page 1.
      if (!('page' in patch)) next.page = 1;
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState((current) => ({ ...DEFAULT_FILTERS, pageSize: current.pageSize }));
  }, []);

  const setView = useCallback((next: 'grid' | 'list') => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const updateAsset = useCallback(
    async (id: string, patch: Partial<Asset>): Promise<Asset | null> => {
      const previous = assets;
      setAssets((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      try {
        const { asset } = await api.patchAsset(id, {
          title: patch.title,
          tags: patch.tags,
          collection: patch.collection,
          description: patch.description,
        });
        setAssets((current) => current.map((a) => (a.id === id ? asset : a)));
        void refreshStats();
        void refreshCollections();
        return asset;
      } catch (err) {
        setAssets(previous);
        throw err;
      }
    },
    [assets, refreshStats, refreshCollections],
  );

  const removeAsset = useCallback(
    async (id: string) => {
      await api.deleteAsset(id);
      setAssets((current) => current.filter((a) => a.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      void refresh();
      void refreshCollections();
    },
    [refresh, refreshCollections],
  );

  const addAsset = useCallback((asset: Asset) => {
    setAssets((current) => [asset, ...current.filter((a) => a.id !== asset.id)]);
    setTotal((t) => t + 1);
  }, []);

  const createCollection = useCallback(
    async (name: string, description = '') => {
      const { collection } = await api.createCollection(name, description);
      setCollections((current) =>
        [...current, collection].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return collection;
    },
    [],
  );

  const deleteCollection = useCallback(async (id: string) => {
    await api.deleteCollection(id);
    setCollections((current) => current.filter((c) => c.id !== id));
  }, []);

  const login = useCallback(
    async (password: string) => {
      const info = await api.login(password);
      setSessionExpiresAt(info.expiresAt);
      setRequiresLogin(false);
      setNeedsToken(false);
      await Promise.all([refresh(), refreshCollections(), refreshFolders(), checkHealth()]);
    },
    [refresh, refreshCollections, refreshFolders, checkHealth],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the call fails, drop the local view of the session.
    }
    setToken('');
    setHasToken(false);
    setSessionExpiresAt(null);
    setAssets([]);
    setTotal(0);
    setStats(null);
    setFolders([]);
    setRequiresLogin(passwordLoginEnabled);
    setNeedsToken(passwordLoginEnabled ? false : Boolean(capabilities?.authRequired));
  }, [passwordLoginEnabled, capabilities?.authRequired]);

  const lockNow = useCallback(() => {
    void logout();
  }, [logout]);

  const setAccessToken = useCallback(
    (token: string) => {
      setToken(token);
      setHasToken(Boolean(token));
      setNeedsToken(!token);
      if (token) {
        void refreshCapabilities();
        void refresh();
        void refreshCollections();
        void checkHealth();
      }
    },
    [refreshCapabilities, refresh, refreshCollections, checkHealth],
  );

  /**
   * 24-hour inactivity auto-lock.
   *
   * The server also expires the session, so this is the belt to that braces: it
   * locks an idle open tab without waiting for the next API call. Any mouse,
   * key, touch or scroll activity resets the timer.
   */
  useEffect(() => {
    if (!passwordLoginEnabled || requiresLogin) return;

    const ACTIVITY_KEY = 'gamevault.lastActivity';
    const ttlMs = (capabilities?.sessionTtlSeconds ?? 86_400) * 1000;
    const markActivity = () => {
      try {
        localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
      } catch {
        /* storage unavailable — the server-side expiry still applies */
      }
    };

    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite > 15_000) {
        lastWrite = now;
        markActivity();
      }
    };

    markActivity();
    const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    for (const event of events) window.addEventListener(event, onActivity, { passive: true });

    const timer = setInterval(() => {
      let last = Date.now();
      try {
        last = Number(localStorage.getItem(ACTIVITY_KEY) ?? Date.now());
      } catch {
        last = Date.now();
      }
      if (Date.now() - last >= ttlMs) lockNow();
    }, 60_000);

    return () => {
      for (const event of events) window.removeEventListener(event, onActivity);
      clearInterval(timer);
    };
  }, [passwordLoginEnabled, requiresLogin, capabilities?.sessionTtlSeconds, lockNow]);

  const hasActiveFilters =
    Boolean(filters.q) ||
    filters.collection !== 'All' ||
    Boolean(filters.folder) ||
    filters.kind !== 'all' ||
    Boolean(filters.tag) ||
    filters.sort !== 'newest';

  const value = useMemo<LibraryContextValue>(
    () => ({
      capabilities,
      capsLoading,
      refreshCapabilities,
      health,
      checkingHealth,
      checkHealth,
      assets,
      total,
      page,
      totalPages,
      stats,
      loading,
      fetching,
      error,
      filters,
      setFilters,
      clearFilters,
      hasActiveFilters,
      view,
      setView,
      refresh,
      refreshStats,
      updateAsset,
      removeAsset,
      addAsset,
      collections,
      refreshCollections,
      createCollection,
      deleteCollection,
      folders,
      foldersLoading,
      refreshFolders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveAsset,
      childFolders,
      folderById,
      needsToken,
      setAccessToken,
      hasToken,
      passwordLoginEnabled,
      requiresLogin,
      login,
      logout,
      lockNow,
      sessionExpiresAt,
    }),
    [
      capabilities,
      capsLoading,
      refreshCapabilities,
      health,
      checkingHealth,
      checkHealth,
      assets,
      total,
      page,
      totalPages,
      stats,
      loading,
      fetching,
      error,
      filters,
      setFilters,
      clearFilters,
      hasActiveFilters,
      view,
      setView,
      refresh,
      refreshStats,
      updateAsset,
      removeAsset,
      addAsset,
      collections,
      refreshCollections,
      createCollection,
      deleteCollection,
      folders,
      foldersLoading,
      refreshFolders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveAsset,
      childFolders,
      folderById,
      needsToken,
      setAccessToken,
      hasToken,
      passwordLoginEnabled,
      requiresLogin,
      login,
      logout,
      lockNow,
      sessionExpiresAt,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return ctx;
}
