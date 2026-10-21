import { useState } from 'react';
import { api, setToken } from '../lib/api';
import { useLibrary } from '../store/LibraryContext';
import { Icon } from './Icon';
import { Spinner } from './ui';

export function TokenGate() {
  const { setAccessToken, capabilities } = useLibrary();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = value.trim();
    if (!token) return;
    setBusy(true);
    setError(null);
    setToken(token);
    try {
      await api.listAssets({ pageSize: 1 });
      setAccessToken(token);
    } catch (err) {
      setToken('');
      setError(
        (err as { status?: number }).status === 401
          ? 'That token was rejected by the server.'
          : 'Could not verify the token. Is the API reachable?',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-ink">
            <Icon name="lock" size={19} />
          </span>
          <div>
            <h1 className="text-base font-semibold text-ink">GameVault is locked</h1>
            <p className="text-xs text-muted">
              {capabilities?.authRequired
                ? 'This API requires the access token configured in server/.env.'
                : 'The server rejected the request.'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="gv-label" htmlFor="access-token">
              Access token
            </label>
            <input
              id="access-token"
              type="password"
              autoComplete="current-password"
              className="gv-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="GAMEVAULT_AUTH_TOKEN"
            />
          </div>
          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}
          <button type="submit" className="gv-btn-primary w-full" disabled={busy || !value.trim()}>
            {busy ? <Spinner size={15} /> : <Icon name="check" size={15} />}
            Unlock library
          </button>
          <p className="text-[11px] leading-relaxed text-muted">
            The token is kept in this tab’s session storage only and is sent as an{' '}
            <span className="font-mono">X-GameVault-Token</span> header. It is not the Filebase secret.
          </p>
        </form>
      </div>
    </div>
  );
}
