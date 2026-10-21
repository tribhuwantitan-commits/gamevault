import { formatBytes, formatSpeed } from '../lib/format';
import { useUploads, type UploadTask } from '../store/UploadContext';
import { Icon } from './Icon';
import { ProgressBar, Spinner } from './ui';

const STATUS_LABEL: Record<UploadTask['status'], string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  uploading: 'Uploading',
  verifying: 'Verifying with Filebase',
  done: 'Complete',
  error: 'Failed',
  canceled: 'Canceled',
};

const ACTIVE: UploadTask['status'][] = ['queued', 'preparing', 'uploading', 'verifying'];

export function UploadQueue({ emptyHint }: { emptyHint?: string }) {
  const { tasks, cancelTask, retryTask, clearFinished } = useUploads();

  if (tasks.length === 0) {
    return <p className="py-4 text-center text-xs text-muted">{emptyHint ?? 'No uploads in this session.'}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Upload queue ({tasks.length})</h3>
        <button
          type="button"
          className="text-xs text-muted transition hover:text-ink disabled:opacity-40"
          onClick={clearFinished}
          disabled={tasks.every((t) => !['done', 'error', 'canceled'].includes(t.status))}
        >
          Clear finished
        </button>
      </div>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="rounded-xl border border-line bg-surface2/40 p-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink" title={task.name}>
                  {task.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <span>{formatBytes(task.size)}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      task.status === 'error' ? 'text-danger' : task.status === 'done' ? 'text-success' : ''
                    }
                  >
                    {STATUS_LABEL[task.status]}
                  </span>
                  {task.status === 'uploading' && task.speedBps > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatSpeed(task.speedBps)}</span>
                    </>
                  ) : null}
                  {task.status === 'uploading' && task.progress > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{Math.round(task.progress * 100)}%</span>
                    </>
                  ) : null}
                </span>
              </span>

              {ACTIVE.includes(task.status) ? (
                <>
                  <Spinner size={14} className="text-accent" />
                  <button
                    type="button"
                    className="gv-icon-btn h-7 w-7"
                    onClick={() => cancelTask(task.id)}
                    title="Cancel upload"
                    aria-label={`Cancel upload of ${task.name}`}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </>
              ) : null}

              {task.status === 'error' ? (
                <button
                  type="button"
                  className="gv-icon-btn h-7 w-7"
                  onClick={() => retryTask(task.id)}
                  title="Retry upload"
                  aria-label={`Retry upload of ${task.name}`}
                >
                  <Icon name="refresh" size={13} />
                </button>
              ) : null}

              {task.status === 'done' ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-success/15 text-success">
                  <Icon name="check" size={14} />
                </span>
              ) : null}
            </div>

            {['preparing', 'uploading', 'verifying'].includes(task.status) ? (
              <div className="mt-2">
                <ProgressBar value={task.progress} />
              </div>
            ) : null}

            {task.error ? (
              <p className="mt-1.5 break-words text-[11px] leading-relaxed text-danger">{task.error}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
