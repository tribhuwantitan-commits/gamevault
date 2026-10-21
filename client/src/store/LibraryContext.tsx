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
  HealthResponse,
  SortKey,
  Stats,
} from '../lib/types';

export interface Filters {
  q: string;
  collection: string;
  kind: string;
  tag: string;
  sort: SortKey;
  page: number;
  pageSize: number;
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  collection: 'All',
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
  createCollection: (name: string, description?: string) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;

  needsToken: boolean;
  setAccessToken: (token: string) => void;
  hasToken: boolean;
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
  const [needsToken, setNeedsToken] = useState(false);
  const [hasToken, setHasToken] = useState(Boolean(getToken()));

  const abortRef = useRef<AbortController | null>(null);
  const firstLoad = useRef(true);

  const handleApiError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        setNeedsToken(true);
        return 'This library is protected. Enter your GameVault access token.';
      }
      if (err.code === 'storage_not_configured') return err.message;
      return err.message;
    }
    return err instanceof Error ? err.message : 'Something went wrong.';
  }, []);

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

  useEffect(() => {
    void refreshCapabilities();
    void checkHealth();
  }, [refreshCapabilities, checkHealth]);

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

  const hasActiveFilters =
    Boolean(filters.q) ||
    filters.collection !== 'All' ||
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
      needsToken,
      setAccessToken,
      hasToken,
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
      needsToken,
      setAccessToken,
      hasToken,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return ctx;
}
