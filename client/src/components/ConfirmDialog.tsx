import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Spinner } from './ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-pop animate-slide-up"
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              tone === 'danger' ? 'bg-danger/15 text-danger' : 'bg-accent-soft text-accent'
            }`}
          >
            <Icon name={tone === 'danger' ? 'alert' : 'info'} size={18} />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-base font-semibold text-ink">
              {title}
            </h2>
            <div className="mt-1 text-sm leading-relaxed text-muted">{description}</div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="gv-btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === 'danger' ? 'gv-btn bg-danger text-white hover:bg-danger/90' : 'gv-btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Spinner size={15} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
