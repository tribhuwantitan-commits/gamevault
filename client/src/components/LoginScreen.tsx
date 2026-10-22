import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { useLibrary } from '../store/LibraryContext';
import { Icon } from './Icon';
import { Spinner } from './ui';

/**
 * Password login. The password is posted once to /api/auth/login; the server
 * verifies the hash and replies with an HttpOnly session cookie. Neither the
 * password, the hash, nor the API token is ever stored in the browser.
 */
export function LoginScreen({ onUseToken }: { onUseToken: () => void }) {
  const { login, capabilities } = useLibrary();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 429
            ? 'Too many attempts. Wait a few minutes and try again.'
            : err.message,
        );
      } else {
        setError('Could not reach the server. Check your connection.');
      }
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const ttlHours = Math.round((capabilities?.sessionTtlSeconds ?? 86400) / 3600);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-ink">
            <Icon name="lock" size={19} />
          </span>
          <div>
            <h1 className="text-base font-semibold text-ink">Welcome back</h1>
            <p className="text-xs text-muted">Enter your GameVault password to unlock the library.</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="gv-label" htmlFor="login-password">
              Password
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="login-password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                className="gv-input pr-11"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your login password"
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShow((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition hover:text-ink"
                aria-label={show ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
              </button>
            </div>
          </div>

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <button type="submit" className="gv-btn-primary w-full" disabled={busy || !password}>
            {busy ? <Spinner size={15} /> : <Icon name="lock" size={15} />}
            Unlock
          </button>
        </form>

        <div className="mt-4 space-y-2 border-t border-line pt-3">
          <p className="text-[11px] leading-relaxed text-muted">
            Your session stays unlocked while you use the app and locks automatically after{' '}
            {ttlHours} hours of inactivity. The password is checked on the server and is never stored in
            your browser.
          </p>
          <button
            type="button"
            onClick={onUseToken}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            Use an API token instead
          </button>
        </div>
      </div>
    </div>
  );
}
