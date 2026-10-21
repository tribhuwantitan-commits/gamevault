import { useEffect, useMemo, useRef, useState } from 'react';
import { useLibrary } from '../store/LibraryContext';
import { useUploads } from '../store/UploadContext';
import { useToast } from '../store/ToastContext';
import { formatBytes } from '../lib/format';
import { Icon } from './Icon';
import { UploadQueue } from './UploadQueue';
import { Badge, Spinner } from './ui';

export function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { capabilities, collections } = useLibrary();
  const { addFiles, configure, configuration, activeCount } = useUploads();
  const { push } = useToast();

  const [dragActive, setDragActive] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const storageReady = capabilities?.storageConfigured ?? false;
  const maxLabel = capabilities ? formatBytes(capabilities.limits.maxUploadBytes) : '—';
  const multipartLabel = capabilities ? formatBytes(capabilities.limits.multipartThresholdBytes) : '—';

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeCount === 0) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, activeCount]);

  const accepted = useMemo(() => capabilities?.supportedExtensions ?? [], [capabilities]);

  if (!open) return null;

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!storageReady) {
      push({
        tone: 'error',
        title: 'Storage not configured',
        description: 'Add your Filebase credentials to server/.env, then restart the server.',
      });
      return;
    }
    const files = Array.from(fileList);
    const added = addFiles(files, configuration);
    if (added > 0) {
      push({
        tone: 'info',
        title: `${added} file${added === 1 ? '' : 's'} queued`,
        description: `Uploading to collection “${configuration.collection}”.`,
      });
    }
  };

  const addTagToConfig = () => {
    const value = tagDraft.trim().replace(/^#/, '').slice(0, 40);
    if (!value) return;
    if (configuration.tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setTagDraft('');
      return;
    }
    configure({ ...configuration, tags: [...configuration.tags, value] });
    setTagDraft('');
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-black/65 p-0 backdrop-blur-sm sm:p-6 animate-fade-in"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && activeCount === 0) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        className="w-full max-w-2xl overflow-hidden rounded-none border border-line bg-surface shadow-pop sm:my-6 sm:rounded-2xl animate-slide-up"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 id="upload-title" className="text-base font-semibold text-ink">
              Upload assets
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Files go straight to Filebase · {maxLabel} limit per file
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="gv-icon-btn"
            aria-label="Close upload dialog"
            disabled={activeCount > 0}
            title={activeCount > 0 ? 'Wait for uploads to finish (or cancel them)' : 'Close'}
          >
            <Icon name="close" size={17} />
          </button>
        </header>

        <div className="space-y-4 p-4 sm:p-5">
          {!storageReady ? (
            <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-ink">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warn" />
              <div>
                <p className="font-semibold">Filebase is not configured yet.</p>
                <p className="mt-1 text-muted">
                  Add <span className="font-mono">FILEBASE_ACCESS_KEY_ID</span> and{' '}
                  <span className="font-mono">FILEBASE_SECRET_ACCESS_KEY</span> to{' '}
                  <span className="font-mono">server/.env</span>, then restart the API. The UI stays usable in
                  the meantime.
                </p>
              </div>
            </div>
          ) : null}

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
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition ${
              dragActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface2/50'
            } ${storageReady ? '' : 'opacity-70'}`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Icon name="upload" size={20} />
            </span>
            <p className="text-sm font-medium text-ink">
              Drag &amp; drop files here, or{' '}
              <button
                type="button"
                className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                onClick={() => inputRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className="text-xs text-muted">
              PNG · JPG · WebP · SVG · GLB · GLTF · FBX · OBJ · BLEND · WAV · MP3 · OGG · MP4 · ZIP and more
            </p>
            <p className="text-[11px] text-muted/80">
              Files ≥ {multipartLabel} use multipart upload
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept={accepted.map((ext) => `.${ext}`).join(',')}
              onChange={(event) => {
                handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="gv-label" htmlFor="upload-collection">
                Collection
              </label>
              <select
                id="upload-collection"
                className="gv-input"
                value={configuration.collection}
                onChange={(event) => configure({ ...configuration, collection: event.target.value })}
              >
                {collections.length === 0 ? <option value="Other">Other</option> : null}
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.name}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="gv-label" htmlFor="upload-tags">
                Tags for this batch
              </label>
              <input
                id="upload-tags"
                className="gv-input"
                value={tagDraft}
                placeholder="Type a tag and press Enter"
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addTagToConfig();
                  }
                }}
                onBlur={() => setTagDraft('')}
                maxLength={40}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="gv-label" htmlFor="upload-description">
                Notes for this batch (optional)
              </label>
              <input
                id="upload-description"
                className="gv-input"
                value={configuration.description}
                placeholder="e.g. Kenney sci-fi kit, CC0 license"
                onChange={(event) => configure({ ...configuration, description: event.target.value })}
                maxLength={2000}
              />
            </div>
          </div>

          {configuration.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {configuration.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() =>
                      configure({ ...configuration, tags: configuration.tags.filter((t) => t !== tag) })
                    }
                    aria-label={`Remove tag ${tag}`}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <UploadQueue emptyHint="Select files above to queue an upload." />

        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface2/40 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <Badge tone="neutral">
              <Icon name="lock" size={11} /> Private bucket
            </Badge>
            <span>Presigned uploads · nothing is stored as “successful” until Filebase confirms it.</span>
          </div>
          <button
            type="button"
            className="gv-btn-primary"
            onClick={() => {
              if (activeCount > 0) {
                push({
                  tone: 'info',
                  title: 'Uploads still running',
                  description: 'You can keep this window open until they finish.',
                });
                return;
              }
              onClose();
            }}
          >
            {activeCount > 0 ? <Spinner size={15} /> : <Icon name="check" size={15} />}
            {activeCount > 0 ? `${activeCount} in progress` : 'Done'}
          </button>
        </footer>
      </div>
    </div>
  );
}
