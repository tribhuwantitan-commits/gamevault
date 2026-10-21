import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '../lib/types';
import { formatBytes, formatDateTime, kindLabel, relativeTime } from '../lib/format';
import { useLibrary } from '../store/LibraryContext';
import { useToast } from '../store/ToastContext';
import { downloadAsset } from '../lib/download';
import { AssetPreview } from './preview/AssetPreview';
import { Icon } from './Icon';
import { Badge, Spinner } from './ui';
import { ConfirmDialog } from './ConfirmDialog';
import { ApiError } from '../lib/api';

interface Props {
  asset: Asset;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export function AssetDetailModal({ asset, onClose, onDeleted }: Props) {
  const { collections, updateAsset, removeAsset } = useLibrary();
  const { push } = useToast();

  const [title, setTitle] = useState(asset.title);
  const [description, setDescription] = useState(asset.description);
  const [collection, setCollection] = useState(asset.collection);
  const [tags, setTags] = useState<string[]>(asset.tags);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const dirty = useMemo(
    () =>
      title !== asset.title ||
      description !== asset.description ||
      collection !== asset.collection ||
      tags.join('|') !== asset.tags.join('|'),
    [title, description, collection, tags, asset],
  );

  const addTag = () => {
    const value = tagDraft.trim().replace(/^#/, '').slice(0, 40);
    if (!value) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setTagDraft('');
      return;
    }
    if (tags.length >= 24) {
      push({ tone: 'warning', title: 'Tag limit reached', description: 'An asset can carry up to 24 tags.' });
      return;
    }
    setTags([...tags, value]);
    setTagDraft('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateAsset(asset.id, { title: title.trim(), description, collection, tags });
      push({ tone: 'success', title: 'Asset updated', description: 'Metadata saved to the library index.' });
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not save changes',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const filename = await downloadAsset(asset.id);
      push({ tone: 'success', title: 'Download started', description: filename });
    } catch (err) {
      push({
        tone: 'error',
        title: 'Download failed',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await removeAsset(asset.id);
      push({ tone: 'success', title: 'Asset deleted', description: `${asset.displayName} was removed from Filebase.` });
      setConfirmDelete(false);
      onDeleted(asset.id);
      onClose();
    } catch (err) {
      push({
        tone: 'error',
        title: 'Delete failed',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/65 p-0 backdrop-blur-sm sm:p-6 animate-fade-in"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-title"
        className="relative my-0 w-full max-w-6xl overflow-hidden rounded-none border border-line bg-surface shadow-pop sm:my-4 sm:rounded-2xl animate-slide-up"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="asset-title" className="truncate text-base font-semibold text-ink">
              {asset.displayName}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="font-mono">{asset.filename}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(asset.size)}</span>
              <span aria-hidden="true">·</span>
              <span>{kindLabel(asset.kind)}</span>
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="gv-icon-btn shrink-0"
            aria-label="Close details"
          >
            <Icon name="close" size={17} />
          </button>
        </header>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)]">
          <div className="border-b border-line p-3 sm:p-4 lg:border-b-0 lg:border-r">
            <div className="h-[42vh] min-h-[240px] w-full sm:h-[52vh]">
              <AssetPreview asset={asset} onDownload={handleDownload} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {asset.tags.map((tag) => (
                <span key={tag} className="gv-chip">
                  #{tag}
                </span>
              ))}
              {asset.tags.length === 0 ? <span className="text-xs text-muted">No tags yet</span> : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="gv-btn-primary flex-1" onClick={handleDownload} disabled={downloading}>
                {downloading ? <Spinner size={15} /> : <Icon name="download" size={15} />}
                Download
              </button>
              <a
                className="gv-btn-secondary"
                href={asset.fileUrl}
                target="_blank"
                rel="noreferrer noopener"
                title="Open the raw file in a new tab"
              >
                <Icon name="external" size={15} /> Open
              </a>
              <button
                type="button"
                className="gv-btn-danger"
                onClick={() => setConfirmDelete(true)}
                title="Delete asset"
                aria-label="Delete asset"
              >
                <Icon name="trash" size={15} />
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-line bg-surface2/50 p-3 text-xs">
              <div>
                <dt className="text-muted">Type</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {asset.contentType} <span className="text-muted">(.{asset.extension})</span>
                </dd>
              </div>
              <div>
                <dt className="text-muted">Size</dt>
                <dd className="mt-0.5 font-medium text-ink">{formatBytes(asset.size)}</dd>
              </div>
              <div>
                <dt className="text-muted">Uploaded</dt>
                <dd className="mt-0.5 font-medium text-ink" title={formatDateTime(asset.uploadedAt)}>
                  {relativeTime(asset.uploadedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Updated</dt>
                <dd className="mt-0.5 font-medium text-ink" title={formatDateTime(asset.updatedAt)}>
                  {relativeTime(asset.updatedAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">Object key</dt>
                <dd className="mt-0.5 break-all font-mono text-[11px] text-ink/80">{asset.key}</dd>
              </div>
            </dl>

            <div className="space-y-3">
              <div>
                <label className="gv-label" htmlFor="asset-display-name">
                  Display name
                </label>
                <input
                  id="asset-display-name"
                  className="gv-input"
                  value={title}
                  placeholder={asset.originalFilename}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                />
              </div>

              <div>
                <label className="gv-label" htmlFor="asset-collection">
                  Collection
                </label>
                <select
                  id="asset-collection"
                  className="gv-input"
                  value={collection}
                  onChange={(event) => setCollection(event.target.value)}
                >
                  {collections.length === 0 ? <option value={asset.collection}>{asset.collection}</option> : null}
                  {collections.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="gv-label">Tags</span>
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface p-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() => setTags(tags.filter((t) => t !== tag))}
                        className="rounded-full hover:text-danger"
                        aria-label={`Remove tag ${tag}`}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-muted/70"
                    value={tagDraft}
                    placeholder={tags.length ? 'Add tag…' : 'e.g. sci-fi, modular, lowpoly'}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        addTag();
                      } else if (event.key === 'Backspace' && !tagDraft && tags.length > 0) {
                        setTags(tags.slice(0, -1));
                      }
                    }}
                    onBlur={() => setTagDraft((draft) => draft)}
                    maxLength={40}
                  />
                </div>
              </div>

              <div>
                <label className="gv-label" htmlFor="asset-description">
                  Notes
                </label>
                <textarea
                  id="asset-description"
                  className="gv-input min-h-[64px] resize-y"
                  value={description}
                  placeholder="License, source, engine notes…"
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <Badge tone={dirty ? 'warn' : 'neutral'}>{dirty ? 'Unsaved changes' : 'Synced'}</Badge>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="gv-btn-ghost"
                    onClick={() => {
                      setTitle(asset.title);
                      setDescription(asset.description);
                      setCollection(asset.collection);
                      setTags(asset.tags);
                      setTagDraft('');
                    }}
                    disabled={!dirty || saving}
                  >
                    Reset
                  </button>
                  <button type="button" className="gv-btn-primary" onClick={save} disabled={!dirty || saving}>
                    {saving ? <Spinner size={15} /> : <Icon name="check" size={15} />}
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this asset?"
        description={
          <>
            <strong className="text-ink">{asset.displayName}</strong> will be permanently removed from the
            Filebase bucket <span className="font-mono text-xs">{asset.key}</span>. This cannot be undone.
          </>
        }
        confirmLabel="Delete asset"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
