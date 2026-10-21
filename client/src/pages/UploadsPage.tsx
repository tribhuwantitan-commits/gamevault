import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBytes } from '../lib/format';
import { useLibrary } from '../store/LibraryContext';
import { useUploads } from '../store/UploadContext';
import { useToast } from '../store/ToastContext';
import { Icon } from '../components/Icon';
import { UploadQueue } from '../components/UploadQueue';
import { Badge, Spinner } from '../components/ui';

export function UploadsPage() {
  const { capabilities, collections } = useLibrary();
  const { addFiles, configure, configuration, activeCount } = useUploads();
  const { push } = useToast();

  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const storageReady = capabilities?.storageConfigured ?? false;

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    if (!storageReady) {
      push({
        tone: 'error',
        title: 'Storage not configured',
        description: 'Add your Filebase keys to server/.env and restart the API.',
      });
      return;
    }
    const added = addFiles(Array.from(fileList), configuration);
    if (added > 0) {
      push({
        tone: 'info',
        title: `${added} file${added === 1 ? '' : 's'} queued`,
        description: 'Uploads run in the background — progress is shown below.',
      });
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Uploads</h1>
          <p className="mt-1 text-sm text-muted">
            Files stream directly to Filebase with presigned URLs. An asset only appears in the library after
            the server confirms the object exists.
          </p>
        </div>
        {activeCount > 0 ? (
          <Badge tone="accent">
            <Spinner size={11} /> {activeCount} in progress
          </Badge>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-3">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              handleFiles(event.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition ${
              dragActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
            }`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Icon name="upload" size={22} />
            </span>
            <p className="text-sm font-medium text-ink">
              Drop files here or{' '}
              <button
                type="button"
                className="text-accent underline decoration-accent/40 underline-offset-2"
                onClick={() => inputRef.current?.click()}
              >
                choose files
              </button>
            </p>
            <p className="text-xs text-muted">
              Up to {capabilities ? formatBytes(capabilities.limits.maxUploadBytes) : '—'} per file · files over{' '}
              {capabilities ? formatBytes(capabilities.limits.multipartThresholdBytes) : '—'} upload in parts
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept={(capabilities?.supportedExtensions ?? []).map((ext) => `.${ext}`).join(',')}
              onChange={(event) => {
                handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          <div className="gv-panel p-3 sm:p-4">
            <UploadQueue emptyHint="No uploads yet in this session. Drop files above to get started." />
          </div>
        </section>

        <aside className="space-y-4">
          <section className="gv-panel space-y-3 p-4">
            <h2 className="text-sm font-semibold text-ink">Batch defaults</h2>
            <div>
              <label className="gv-label" htmlFor="uploads-collection">
                Collection
              </label>
              <select
                id="uploads-collection"
                className="gv-input"
                value={configuration.collection}
                onChange={(event) => configure({ ...configuration, collection: event.target.value })}
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.name}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="gv-label" htmlFor="uploads-tags">
                Tags (comma separated)
              </label>
              <input
                id="uploads-tags"
                className="gv-input"
                value={configuration.tags.join(', ')}
                placeholder="lowpoly, sci-fi"
                onChange={(event) =>
                  configure({
                    ...configuration,
                    tags: event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                      .slice(0, 24),
                  })
                }
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              Defaults apply to newly queued files. You can edit tags and collections per asset afterwards.
            </p>
          </section>

          <section className="gv-panel p-4">
            <h2 className="text-sm font-semibold text-ink">Before you upload</h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
              <li className="flex gap-1.5">
                <Icon name="check" size={13} className="mt-0.5 shrink-0 text-success" />
                Keep the bucket private — GameVault generates temporary download links instead.
              </li>
              <li className="flex gap-1.5">
                <Icon name="check" size={13} className="mt-0.5 shrink-0 text-success" />
                Multipart uploads need the bucket CORS rule to expose the <span className="font-mono">ETag</span>{' '}
                header.
              </li>
              <li className="flex gap-1.5">
                <Icon name="check" size={13} className="mt-0.5 shrink-0 text-success" />
                Unsupported formats are rejected before anything is signed.
              </li>
            </ul>
            <Link to="/settings" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              Connection settings <Icon name="chevronRight" size={12} />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
