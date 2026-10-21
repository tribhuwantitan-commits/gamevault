import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 00-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmptyState({
  icon = 'library',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: IconName;
  accent?: boolean;
}) {
  return (
    <div className="gv-panel flex items-start justify-between gap-3 p-4 shadow-card sm:p-5">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-ink">{value}</p>
        {hint ? <p className="mt-1 truncate text-xs text-muted">{hint}</p> : null}
      </div>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          accent ? 'bg-accent text-accent-ink' : 'bg-surface2 text-muted'
        }`}
      >
        <Icon name={icon} size={19} />
      </span>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line pt-4 sm:flex-row">
      <p className="text-xs text-muted">
        Page {page} of {totalPages} · {total} asset{total === 1 ? '' : 's'}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="gv-btn-secondary"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          <Icon name="chevronLeft" size={16} /> Previous
        </button>
        <button
          type="button"
          className="gv-btn-secondary"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
        >
          Next <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger';
}) {
  const tones: Record<string, string> = {
    neutral: 'border-line bg-surface2 text-muted',
    accent: 'border-transparent bg-accent-soft text-accent',
    success: 'border-transparent bg-success/15 text-success',
    warn: 'border-transparent bg-warn/15 text-warn',
    danger: 'border-transparent bg-danger/15 text-danger',
  };
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1 self-start rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'danger' | 'success' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const colors = {
    accent: 'bg-accent',
    danger: 'bg-danger',
    success: 'bg-success',
  } as const;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface2"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 ${colors[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="gv-panel overflow-hidden">
      <div className="gv-skeleton aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-3.5">
        <div className="gv-skeleton h-3.5 w-3/4" />
        <div className="gv-skeleton h-3 w-1/2" />
      </div>
    </div>
  );
}
