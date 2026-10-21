import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'library'
  | 'folder'
  | 'upload'
  | 'settings'
  | 'search'
  | 'sun'
  | 'moon'
  | 'grid'
  | 'list'
  | 'download'
  | 'trash'
  | 'edit'
  | 'close'
  | 'check'
  | 'alert'
  | 'info'
  | 'menu'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'plus'
  | 'refresh'
  | 'image'
  | 'audio'
  | 'video'
  | 'cube'
  | 'archive'
  | 'file'
  | 'tag'
  | 'database'
  | 'external'
  | 'play'
  | 'pause'
  | 'lock'
  | 'cloud'
  | 'sort'
  | 'filter'
  | 'more'
  | 'sparkles'
  | 'code';

const PATHS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  library: (
    <>
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5L12 21l9-4.5" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 012-2h3.6a2 2 0 011.6.8l.9 1.2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />,
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H1a2 2 0 110-4h.1A1.7 1.7 0 002.6 9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H7a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A8.5 8.5 0 1111.2 3a7 7 0 009.8 9.8z" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M8 12l4 4 4-4" />
      <path d="M4 20h16" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
      <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  alert: (
    <>
      <path d="M12 3l9.5 17H2.5L12 3z" />
      <path d="M12 9v5M12 17.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 10-2.3 6.3" />
      <path d="M20 4v7h-7" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-4.5 3.5 3L16 12l4 4" />
    </>
  ),
  audio: (
    <>
      <path d="M5 10v4M9 6v12M13 8.5v7M17 4.5v15M21 9v6" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="5.5" width="13" height="13" rx="2" />
      <path d="M15.5 10l6-3v10l-6-3" />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.5l9 5v9l-9 5-9-5v-9l9-5z" />
      <path d="M3 7.5l9 5 9-5M12 12.5v9" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" />
      <path d="M10 13h4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path d="M14 3v5h5" />
    </>
  ),
  tag: (
    <>
      <path d="M20.5 13.5L13 21a2 2 0 01-2.8 0L3 13.8V4h9.8L21 12.2a1 1 0 010 .9z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
    </>
  ),
  play: <path d="M7 4l13 8-13 8V4z" />,
  pause: <path d="M8 4v16M16 4v16" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </>
  ),
  cloud: <path d="M7 18h10a4 4 0 000-8 6 6 0 00-11.6 1.5A3.5 3.5 0 007 18z" />,
  sort: <path d="M4 7h16M6 12h12M9 17h6" />,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
    </>
  ),
  code: <path d="M9 8l-5 4 5 4M15 8l5 4-5 4" />,
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export function Icon({ name, size = 18, filled = false, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export function KindIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const name: IconName =
    kind === 'image'
      ? 'image'
      : kind === 'audio'
        ? 'audio'
        : kind === 'video'
          ? 'video'
          : kind === 'model3d'
            ? 'cube'
            : kind === 'archive'
              ? 'archive'
              : kind === 'project'
                ? 'code'
                : 'file';
  return <Icon name={name} size={size} />;
}
