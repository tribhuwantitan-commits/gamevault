import { Icon, type IconName } from './Icon';
import { useToast, type ToastTone } from '../store/ToastContext';

const TONE: Record<ToastTone, { icon: IconName; ring: string; text: string }> = {
  success: { icon: 'check', ring: 'bg-success/15 text-success', text: 'text-ink' },
  error: { icon: 'alert', ring: 'bg-danger/15 text-danger', text: 'text-ink' },
  warning: { icon: 'alert', ring: 'bg-warn/15 text-warn', text: 'text-ink' },
  info: { icon: 'info', ring: 'bg-accent-soft text-accent', text: 'text-ink' },
};

export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 p-4 sm:items-end"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const tone = TONE[toast.tone];
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-pop animate-slide-up"
          >
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone.ring}`}>
              <Icon name={tone.icon} size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${tone.text}`}>{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 break-words text-xs leading-relaxed text-muted">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="text-muted transition hover:text-ink"
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
