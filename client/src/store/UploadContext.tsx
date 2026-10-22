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
import { describeUploadError, uploadFile } from '../lib/upload';
import type { Asset, UploadOptions } from '../lib/types';
import { useLibrary } from './LibraryContext';
import { useToast } from './ToastContext';

export type UploadStatus =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'verifying'
  | 'done'
  | 'error'
  | 'canceled';

export interface UploadTask {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  loaded: number;
  progress: number;
  speedBps: number;
  error?: string;
  collection: string;
  folderId: string | null;
  tags: string[];
  description: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  assetId?: string;
  multipart?: boolean;
}

interface QueueEntry {
  taskId: string;
  file: File;
  options: UploadOptions;
  controller: AbortController;
}

interface UploadContextValue {
  tasks: UploadTask[];
  activeCount: number;
  isUploading: boolean;
  addFiles: (files: File[], options: UploadOptions) => number;
  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  clearFinished: () => void;
  configure: (options: UploadOptions) => void;
  configuration: UploadOptions;
}

const CONCURRENT_UPLOADS = 2;

const UploadContext = createContext<UploadContextValue | null>(null);

const MAX_BYTES = 20 * 1024 * 1024 * 1024; // client-side guard; the server is authoritative

export function UploadProvider({ children }: { children: ReactNode }) {
  const { addAsset, refresh, refreshStats, capabilities, collections } = useLibrary();
  const { push } = useToast();

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [configuration, setConfiguration] = useState<UploadOptions>({
    collection: 'Game',
    folderId: null,
    autoVersion: true,
    tags: [],
    description: '',
  });

  const filesRef = useRef(new Map<string, File>());
  const queueRef = useRef<QueueEntry[]>([]);
  const runningRef = useRef(new Map<string, QueueEntry>());
  const canceledRef = useRef(new Set<string>());
  const startedAtRef = useRef(new Map<string, number>());

  const patchTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((current) => current.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const schedule = useCallback(() => {
    const maxBytes = capabilities?.limits.maxUploadBytes ?? MAX_BYTES;

    while (runningRef.current.size < CONCURRENT_UPLOADS && queueRef.current.length > 0) {
      const entry = queueRef.current.shift()!;
      const { taskId, file, options, controller } = entry;

      if (canceledRef.current.has(taskId)) {
        canceledRef.current.delete(taskId);
        patchTask(taskId, { status: 'canceled', finishedAt: Date.now() });
        continue;
      }

      runningRef.current.set(taskId, entry);
      startedAtRef.current.set(taskId, Date.now());

      patchTask(taskId, {
        status: 'preparing',
        startedAt: Date.now(),
        error: undefined,
        loaded: 0,
        progress: 0,
      });

      void (async () => {
        try {
          if (file.size > maxBytes) {
            throw new Error(
              `${file.name} is larger than the ${(maxBytes / 1024 / 1024).toFixed(0)} MB upload limit.`,
            );
          }
          const asset: Asset = await uploadFile(file, options, {
            signal: controller.signal,
            onPhase: (phase) => patchTask(taskId, { status: phase }),
            onProgress: ({ loaded, total }) => {
              const started = startedAtRef.current.get(taskId) ?? Date.now();
              const elapsed = Math.max(0.25, (Date.now() - started) / 1000);
              patchTask(taskId, {
                loaded,
                progress: total > 0 ? Math.min(1, loaded / total) : 0,
                speedBps: loaded / elapsed,
              });
            },
          });

          patchTask(taskId, {
            status: 'done',
            progress: 1,
            loaded: file.size,
            finishedAt: Date.now(),
            assetId: asset.id,
          });
          addAsset(asset);
          void refreshStats();
          void refresh();
          push({
            tone: 'success',
            title: 'Upload complete',
            description: `${asset.displayName} was verified in Filebase.`,
          });
        } catch (err) {
          const message = describeUploadError(err);
          const canceled =
            canceledRef.current.has(taskId) ||
            (err instanceof DOMException && err.name === 'AbortError');
          patchTask(taskId, {
            status: canceled ? 'canceled' : 'error',
            error: canceled ? undefined : message,
            finishedAt: Date.now(),
          });
          if (!canceled) {
            push({ tone: 'error', title: `Could not upload ${file.name}`, description: message });
          }
        } finally {
          runningRef.current.delete(taskId);
          startedAtRef.current.delete(taskId);
          canceledRef.current.delete(taskId);
          filesRef.current.delete(taskId);
          schedule();
        }
      })();
    }
  }, [addAsset, capabilities?.limits.maxUploadBytes, patchTask, push, refresh, refreshStats]);

  const addFiles = useCallback(
    (files: File[], options: UploadOptions) => {
      const accepted: UploadTask[] = [];
      const rejected: string[] = [];
      const allowed = new Set((capabilities?.supportedExtensions ?? []).map((e) => e.toLowerCase()));

      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!ext || (allowed.size > 0 && !allowed.has(ext))) {
          rejected.push(file.name);
          continue;
        }
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        filesRef.current.set(id, file);
        const task: UploadTask = {
          id,
          name: file.name,
          size: file.size,
          status: 'queued',
          loaded: 0,
          progress: 0,
          speedBps: 0,
          collection: options.collection,
          folderId: options.folderId ?? null,
          tags: options.tags,
          description: options.description,
          queuedAt: Date.now(),
        };
        accepted.push(task);
        queueRef.current.push({ taskId: id, file, options, controller: new AbortController() });
      }

      if (accepted.length > 0) {
        setTasks((current) => [...accepted, ...current]);
        schedule();
      }
      if (rejected.length > 0) {
        push({
          tone: 'warning',
          title: `${rejected.length} file${rejected.length === 1 ? '' : 's'} skipped`,
          description: `Unsupported format: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? '…' : ''}`,
        });
      }
      return accepted.length;
    },
    [capabilities?.supportedExtensions, push, schedule],
  );

  const cancelTask = useCallback((id: string) => {
    canceledRef.current.add(id);

    const queued = queueRef.current.find((q) => q.taskId === id);
    if (queued) {
      queued.controller.abort();
      queueRef.current = queueRef.current.filter((q) => q.taskId !== id);
      canceledRef.current.delete(id);
      setTasks((current) =>
        current.map((t) => (t.id === id ? { ...t, status: 'canceled', finishedAt: Date.now() } : t)),
      );
      return;
    }

    // In flight: abort the upload so the worker's catch block settles the task.
    runningRef.current.get(id)?.controller.abort();

    setTasks((current) =>
      current.map((t) =>
        t.id === id && ['queued', 'preparing', 'uploading', 'verifying'].includes(t.status)
          ? { ...t, status: 'canceled', finishedAt: Date.now() }
          : t,
      ),
    );
  }, []);

  const retryTask = useCallback(
    (id: string) => {
      const task = tasks.find((t) => t.id === id);
      const file = filesRef.current.get(id);
      if (!task || !file) {
        push({
          tone: 'warning',
          title: 'Cannot retry',
          description: 'The original file is no longer available in this tab. Please re-select it.',
        });
        return;
      }
      patchTask(id, { status: 'queued', error: undefined, progress: 0, loaded: 0, finishedAt: undefined });
      queueRef.current.push({
        taskId: id,
        file,
        options: {
          collection: task.collection,
          folderId: task.folderId ?? null,
          autoVersion: true,
          tags: task.tags,
          description: task.description,
        },
        controller: new AbortController(),
      });
      schedule();
    },
    [patchTask, push, schedule, tasks],
  );

  const clearFinished = useCallback(() => {
    setTasks((current) =>
      current.filter((t) => !['done', 'error', 'canceled'].includes(t.status)),
    );
  }, []);

  const activeCount = useMemo(
    () => tasks.filter((t) => ['queued', 'preparing', 'uploading', 'verifying'].includes(t.status)).length,
    [tasks],
  );

  useEffect(() => {
    if (collections.length > 0 && !collections.some((c) => c.name === configuration.collection)) {
      // Keep the selection valid if the collection list changed.
      setConfiguration((c) => ({ ...c, collection: collections[0]!.name }));
    }
  }, [collections, configuration.collection]);

  return (
    <UploadContext.Provider
      value={{
        tasks,
        activeCount,
        isUploading: activeCount > 0,
        addFiles,
        cancelTask,
        retryTask,
        clearFinished,
        // Kept in sync so retries use the latest global options.
        configure: setConfiguration,
        configuration,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUploads(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploads must be used inside <UploadProvider>');
  return ctx;
}
