import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useLibrary } from '../store/LibraryContext';
import { useTheme } from '../store/ThemeContext';
import { useToast } from '../store/ToastContext';
import { Icon } from '../components/Icon';
import { Badge, Spinner } from '../components/ui';
import type { RescanResult } from '../lib/types';

export function SettingsPage() {
  const {
    capabilities,
    health,
    checkingHealth,
    checkHealth,
    refresh,
    refreshStats,
    refreshCollections,
    passwordLoginEnabled,
    sessionExpiresAt,
    lockNow,
  } = useLibrary();
  const { theme, setTheme } = useTheme();
  const { push } = useToast();

  const [rescanning, setRescanning] = useState(false);
  const [rescanResult, setRescanResult] = useState<RescanResult | null>(null);

  const deepCheck = async () => {
    const result = await checkHealth(true);
    if (!result) {
      push({ tone: 'error', title: 'Health check failed', description: 'The API did not respond.' });
      return;
    }
    if (result.storage.reachable) {
      push({
        tone: 'success',
        title: 'Filebase reachable',
        description: `Read access confirmed on bucket “${result.storage.bucket}”.`,
      });
    } else {
      push({
        tone: 'error',
        title: 'Storage check failed',
        description: result.storage.error ?? 'The bucket could not be read with the configured credentials.',
      });
    }
  };

  const runRescan = async () => {
    setRescanning(true);
    try {
      const result = await api.rescan();
      setRescanResult(result);
      await Promise.all([refresh(), refreshStats(), refreshCollections()]);
      push({
        tone: 'success',
        title: 'Bucket rescanned',
        description: `${result.added} added · ${result.kept} matched · ${result.removed} dropped · ${result.totalObjects} objects in bucket.`,
      });
    } catch (err) {
      push({
        tone: 'error',
        title: 'Rescan failed',
        description: err instanceof ApiError ? err.message : 'Unexpected error.',
      });
    } finally {
      setRescanning(false);
    }
  };

  const storage = health?.storage;
  const configured = capabilities?.storageConfigured ?? false;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Connection status, storage maintenance and preferences. Credentials live only in the server
          environment.
        </p>
      </header>

      <section className="gv-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name="database" size={16} /> Filebase connection
            </h2>
            <p className="mt-1 text-xs text-muted">
              S3-compatible object storage. The bucket must stay private; GameVault never makes it public.
            </p>
          </div>
          <Badge tone={configured ? 'success' : 'warn'}>
            {configured ? 'Credentials present' : 'Credentials missing'}
          </Badge>
        </div>

        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface2/50 p-3">
            <dt className="text-muted">Endpoint</dt>
            <dd className="mt-0.5 break-all font-mono text-[11px] text-ink">
              {storage?.endpoint ?? 'https://s3.filebase.io'}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface2/50 p-3">
            <dt className="text-muted">Bucket</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-ink">{storage?.bucket ?? 'gaming-asset'}</dd>
          </div>
          <div className="rounded-xl border border-line bg-surface2/50 p-3">
            <dt className="text-muted">Region</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-ink">{storage?.region ?? 'us-east-1'}</dd>
          </div>
          <div className="rounded-xl border border-line bg-surface2/50 p-3">
            <dt className="text-muted">API status</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {health ? (
                <span className={health.status === 'ok' ? 'text-success' : 'text-warn'}>
                  {health.status === 'ok' ? 'Healthy' : health.status.replace('_', ' ')}
                </span>
              ) : (
                'Unknown'
              )}
            </dd>
          </div>
        </dl>

        {!configured ? (
          <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3">
            <p className="text-xs font-semibold text-ink">Add credentials to finish setup</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-2.5 font-mono text-[11px] leading-relaxed text-ink/90">
{`# server/.env
FILEBASE_ACCESS_KEY_ID=...
FILEBASE_SECRET_ACCESS_KEY=...
FILEBASE_BUCKET=gaming-asset
FILEBASE_ENDPOINT=https://s3.filebase.io
PORT=3001`}
            </pre>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Create the keys in the Filebase console (Storage → Access Keys). Restart the API afterwards. The
              app keeps running in setup mode until then — it never crashes or fakes an upload.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="gv-btn-secondary" onClick={deepCheck} disabled={checkingHealth || !configured}>
            {checkingHealth ? <Spinner size={15} /> : <Icon name="cloud" size={15} />}
            Test bucket access
          </button>
          <span className="text-[11px] text-muted">
            Performs a read-only list of the <span className="font-mono">assets/</span> prefix.
          </span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="gv-panel p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="refresh" size={16} /> Rebuild index from bucket
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            If <span className="font-mono">server/data/assets.json</span> is lost or out of sync, rescan the
            bucket. Files under the <span className="font-mono">assets/</span> prefix are re-indexed and entries
            whose object no longer exists are dropped. Object data is never modified.
          </p>
          <button
            type="button"
            className="gv-btn-primary mt-3"
            onClick={runRescan}
            disabled={rescanning || !configured}
          >
            {rescanning ? <Spinner size={15} /> : <Icon name="refresh" size={15} />}
            Rescan bucket
          </button>
          {rescanResult ? (
            <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface2/60 p-2.5 font-mono text-[11px] text-ink/85">
{JSON.stringify(rescanResult, null, 2)}
            </pre>
          ) : null}
        </section>

        <section className="gv-panel p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="sparkles" size={16} /> Preferences
          </h2>
          <div className="mt-3 space-y-3">
            <div>
              <span className="gv-label">Theme</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className={theme === 'dark' ? 'gv-btn-primary' : 'gv-btn-secondary'}
                  onClick={() => setTheme('dark')}
                >
                  <Icon name="moon" size={15} /> Dark
                </button>
                <button
                  type="button"
                  className={theme === 'light' ? 'gv-btn-primary' : 'gv-btn-secondary'}
                  onClick={() => setTheme('light')}
                >
                  <Icon name="sun" size={15} /> Light
                </button>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-line bg-surface2/50 p-3">
                <dt className="text-muted">Max file size</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {capabilities ? formatBytes(capabilities.limits.maxUploadBytes) : '—'}
                </dd>
              </div>
              <div className="rounded-xl border border-line bg-surface2/50 p-3">
                <dt className="text-muted">Multipart above</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {capabilities ? formatBytes(capabilities.limits.multipartThresholdBytes) : '—'}
                </dd>
              </div>
              <div className="rounded-xl border border-line bg-surface2/50 p-3">
                <dt className="text-muted">Download link TTL</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {capabilities ? `${Math.round(capabilities.presign.downloadExpiresSeconds / 60)} min` : '—'}
                </dd>
              </div>
              <div className="rounded-xl border border-line bg-surface2/50 p-3">
                <dt className="text-muted">Upload URL TTL</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {capabilities ? `${Math.round(capabilities.presign.uploadExpiresSeconds / 60)} min` : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      <section className="gv-panel p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="image" size={16} /> Supported formats &amp; previews
        </h2>
        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface2/50 p-3">
            <p className="font-semibold text-ink">3D preview (three.js)</p>
            <p className="mt-1 font-mono text-[11px] text-muted">glb · gltf</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Draco/KTX2-compressed meshes and glTF files that reference external .bin/texture files may not
              render — download those instead.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface2/50 p-3">
            <p className="font-semibold text-ink">Native browser preview</p>
            <p className="mt-1 break-words font-mono text-[11px] text-muted">
              {(capabilities?.previewSupport.native ?? ['png', 'jpg', 'webp', 'svg', 'mp3', 'wav', 'ogg', 'mp4', 'webm']).join(' · ')}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface2/50 p-3">
            <p className="font-semibold text-ink">Download only</p>
            <p className="mt-1 break-words font-mono text-[11px] text-muted">
              {(capabilities?.previewSupport.downloadOnly ?? ['obj', 'fbx', 'blend', 'zip']).join(' · ')}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              These are stored and downloadable but are not rendered in the browser.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Accepted extensions: {(capabilities?.supportedExtensions ?? []).join(', ')}
        </p>
      </section>

      <section className="gv-panel p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="lock" size={16} /> Session
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <Badge tone={passwordLoginEnabled ? 'success' : 'neutral'}>
            {passwordLoginEnabled ? 'Password login' : 'API token only'}
          </Badge>
          {sessionExpiresAt ? (
            <span>Session valid until {new Date(sessionExpiresAt).toLocaleString()}</span>
          ) : (
            <span>No password session in this browser</span>
          )}
          {passwordLoginEnabled ? (
            <span>
              Locks automatically after{' '}
              {Math.round((capabilities?.sessionTtlSeconds ?? 86_400) / 3600)} hours of inactivity.
            </span>
          ) : null}
          <button type="button" className="gv-btn-secondary ml-auto" onClick={lockNow}>
            <Icon name="lock" size={14} /> Lock now
          </button>
        </div>
      </section>

      <section className="gv-panel border-danger/30 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="lock" size={16} /> Security notes
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>
            • The bucket is private. Previews and downloads use short-lived presigned URLs generated on the
            server.
          </li>
          <li>
            • Filebase keys are read from <span className="font-mono">server/.env</span> only. They are never sent
            to the browser, never logged, and never included in API responses.
          </li>
          <li>
            • Set <span className="font-mono">GAMEVAULT_AUTH_TOKEN</span> before exposing this app beyond
            localhost. A private bucket does not make an unauthenticated API private — anyone who can reach this
            server could list or delete your assets.
          </li>
          <li>
            • Uploads are validated on the server (extension allow-list, size limits, filename sanitisation) and
            every object is verified with a HEAD request before it is indexed.
          </li>
        </ul>
      </section>
    </div>
  );
}
