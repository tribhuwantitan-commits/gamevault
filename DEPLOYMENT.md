# Deploying GameVault

GameVault is a single Node service plus a static SPA. Nothing here deploys automatically —
these are the steps you run yourself. **Never make the Filebase bucket public.**

---

## 1. Environment variables to configure on the host

| Variable | Required | Example |
| --- | --- | --- |
| `FILEBASE_ACCESS_KEY_ID` | ✅ | `1f3c…` |
| `FILEBASE_SECRET_ACCESS_KEY` | ✅ | `a9d2…` |
| `FILEBASE_BUCKET` | ✅ | `gaming-asset` |
| `FILEBASE_ENDPOINT` | ✅ | `https://s3.filebase.io` |
| `GAMEVAULT_AUTH_TOKEN` | ✅ before going public | `openssl rand -hex 32` |
| `GAMEVAULT_PASSWORD_HASH` | optional (recommended) | `pbkdf2$sha256$600000$…` — see §7.8 |
| `GAMEVAULT_SESSION_TTL_HOURS` | optional | `24` |
| `NODE_ENV` | ✅ | `production` |
| `PORT` | usually injected by the host | `3001` |
| `HOST` | recommended | `0.0.0.0` |
| `FILEBASE_REGION` | optional | `us-east-1` |
| `GAMEVAULT_ALLOWED_ORIGINS` | only for split hosting | `https://vault.example.com` |
| `MAX_UPLOAD_BYTES`, `MULTIPART_*` | optional | see `server/.env.example` |
| `GAMEVAULT_DATA_DIR` | optional | `/var/lib/gamevault` (persistent volume) |

Do **not** add a `VITE_` prefixed secret — Vite inlines those into the bundle.

---

## 2. Single server (simplest, recommended)

The Express API serves the built SPA, so everything is same-origin and CORS is not involved.

```bash
git clone <your-repo> gamevault && cd gamevault
npm ci
npm run build                     # builds server/dist and client/dist
cp server/.env.example server/.env && $EDITOR server/.env   # fill in credentials
NODE_ENV=production npm start     # http://localhost:3001
```

Keep it alive with systemd:

```ini
# /etc/systemd/system/gamevault.service
[Unit]
Description=GameVault
After=network.target

[Service]
Type=simple
User=gamevault
WorkingDirectory=/opt/gamevault
EnvironmentFile=/opt/gamevault/server/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
# `server/data` must be writable and persistent
StateDirectory=gamevault

[Install]
WantedBy=multi-user.target
```

Add `GAMEVAULT_DATA_DIR=/var/lib/gamevault` to the env file when using `StateDirectory`.

### Reverse proxy (Caddy example — HTTPS is handled for you)

```caddyfile
vault.example.com {
  encode zstd gzip
  # Uploads are streamed straight from the browser to Filebase, so the API
  # body stays small. This just gives headroom for JSON + redirects.
  request_body {
    max_size 1MB
  }
  reverse_proxy 127.0.0.1:3001
}
```

nginx equivalent:

```nginx
server {
  listen 443 ssl http2;
  server_name vault.example.com;
  client_max_body_size 1m;         # browsers upload to Filebase directly

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

---

## 3. Split hosting (static frontend + API elsewhere)

Useful for Vercel/Netlify/Cloudflare Pages + Render/Fly/Railway.

1. **API host** — run the Node service (Build: `npm ci && npm run build --workspace server`,
   Start: `node server/dist/index.js`). Set the env vars above plus
   `GAMEVAULT_ALLOWED_ORIGINS=https://your-frontend.example.com`.
2. **Frontend host** — build with `npm run build --workspace client`, publish `client/dist`.
   Configure a rewrite/proxy so `/api/*` reaches the API host (keeps the cookie-free
   same-origin behaviour and avoids CORS complications):

   * Netlify (`_redirects`): `/api/*  https://api.example.com/api/:splat  200`
   * Vercel (`vercel.json`): `{ "rewrites": [{ "source": "/api/:path*", "destination": "https://api.example.com/api/:path*" }] }`
   * Cloudflare Pages (`_redirects`): same syntax as Netlify.

   If you cannot proxy, the browser will call the API cross-origin: then
   `GAMEVAULT_ALLOWED_ORIGINS` must list the frontend origin exactly (scheme + host + port).
3. **Filebase CORS** must include the frontend origin for direct uploads (see README).

---

## 4. Docker (optional)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
ENV GAMEVAULT_DATA_DIR=/data
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
```

Run with `-v gamevault-data:/data -p 3001:3001 --env-file server/.env`.

---

## 5. Pre-flight checklist

- [ ] `server/.env` exists **only** on the server, and `.env` is git-ignored.
- [ ] `GAMEVAULT_AUTH_TOKEN` set; the UI asks for it and the API returns `401` without it.
- [ ] Bucket is **private**; no public-read ACL or policy was added.
- [ ] Bucket CORS allows your origin, the `PUT`/`GET`/`HEAD` methods, and exposes `ETag`.
- [ ] Settings → **Test bucket access** succeeds; Settings → **Rescan bucket** lists what you expect.
- [ ] `server/data` (or `GAMEVAULT_DATA_DIR`) is on persistent storage.
- [ ] HTTPS terminates in front of the app.
- [ ] `grep -r "FILEBASE\|SECRET_ACCESS" client/dist || echo clean` → `clean`.
- [ ] Back up `server/data/assets.json` (small JSON; also recoverable by rescanning the bucket).

---

## 6. Scaling notes

* Metadata is a JSON file written atomically — comfortable for tens of thousands of assets on one
  instance. Multiple API replicas would each hold their own copy; move to SQLite/Postgres (the
  `MetadataStore` interface in `server/src/lib/store.ts` is the only thing to replace) before
  scaling horizontally.
* The rate limiter is in-memory per process; use a proxy or a shared store for multi-instance.
* Large uploads never touch the API: the browser PUTs (or multipart-PUTs) directly to Filebase.
  Only presigning and verification happen on the server.

---

## 7. Android-only deployment (no PC) — Render, single service

This section is written for someone deploying entirely from a phone. It uses the existing
`npm ci && npm run build` + `npm start` scripts; nothing in the app changes.

### 7.1 Why a single Node service

The API already serves the built SPA from `client/dist` (`server/src/app.ts`), so one service gives
you one HTTPS origin, no CORS, and no separate frontend host. That is the lowest-risk option and it
matches section 2 above.

### 7.1b Build step: devDependencies must be installed

The build compiles TypeScript, so it needs `typescript`, `@types/node` and `@types/express`, which
live in `devDependencies`. Render sets `NODE_ENV=production`, and npm then treats an install as
`--omit=dev` — the build fails with `sh: 1: tsc: not found` or
`error TS2688: Cannot find type definition file for 'node'`.

Two guards are in the repo, use either or both:

* `.npmrc` contains `include=dev`, so a plain `npm ci` installs dev dependencies even under
  `NODE_ENV=production`. This also fixes services whose build command was set by hand in the
  dashboard.
* `render.yaml` pins `buildCommand: npm ci --include=dev && npm run build` for blueprint deploys.

Runtime is unaffected: `NODE_ENV=production` still applies, and the server only requires
`dependencies` at run time.

### 7.2 Cost review (verify current prices on the provider page before paying)

| Option | Approx. monthly | Important catch |
| --- | --- | --- |
| **Render Starter + 1 GB disk** (recommended) | **≈ $7.25** ($7 compute + $0.25 disk) | Always on, persistent disk, HTTPS included |
| **Render Free + bucket index mirror** (selected) | **$0** | Sleeps after ~15 min idle (first request after that takes ~30–60 s). No persistent disk, so the index is stored in your bucket via `GAMEVAULT_INDEX_OBJECT` — see 7.7. 5 GB bandwidth cap. |
| Railway Hobby | ≈ $5 | Usage-based; add a volume for `/var/data` |
| Fly.io / VPS | ≈ $3–6 | Cheapest, but you manage everything by hand |

On a paid host, attach the disk (the index is a file, not a database). On the free plan there is no
disk — use the bucket index mirror in 7.7 instead, which is already enabled in `render.yaml`.

### 7.3 Secrets you will type into the host dashboard (never into chat or Git)

Four values at most. Generate two of them on your phone with the HTML tools in `tools/`.

| Variable | Where it comes from |
| --- | --- |
| `FILEBASE_ACCESS_KEY_ID` | Filebase console → Access Keys |
| `FILEBASE_SECRET_ACCESS_KEY` | Filebase console (shown once) |
| `GAMEVAULT_AUTH_TOKEN` | `tools/token-generator.html` (tap Generate → Copy) |
| `GAMEVAULT_PASSWORD_HASH` | `tools/password-hash.html` (§7.8) — optional but recommended |

`render.yaml` already pins the non-secret values (`FILEBASE_BUCKET=gaming-asset`,
`FILEBASE_ENDPOINT=https://s3.filebase.io`, `FILEBASE_REGION=us-east-1`, `NODE_ENV=production`,
`GAMEVAULT_DATA_DIR=/var/data`) and marks the three secrets `sync: false`, so Render prompts for them
and stores them server-side.

### 7.4 Getting the code onto the host

Render deploys from a Git repository, so the code needs to be in GitHub first. From a phone the
easiest routes are:

1. **Connect GitHub in this chat** and let the agent push the repo, then deploy from the Render
   dashboard (least typing).
2. **Termux** (F-Droid/Play Store): `pkg install git`, unzip the project, `git init`, push to a new
   GitHub repo.
3. GitHub mobile web → create repo → *Add file → Upload files*. Works, but you must upload the
   source tree (not `node_modules`, not `dist` — both are git-ignored; the host builds them).

### 7.5 Deploy steps (phone)

1. Render → **New → Blueprint** → pick the repo (it reads `render.yaml`).
2. When prompted, paste the three secret values.
3. Deploy and wait for the build (`npm ci && npm run build`). First build takes a few minutes.
4. Open `https://<name>.onrender.com/api/health` — expect `"status": "ok"` and
   `"configured": true`. If it says `setup_required`, an env var is missing.
5. Open the site — GameVault asks for the access token. Paste `GAMEVAULT_AUTH_TOKEN`.
6. **Settings → Test bucket access** must go green, then **Settings → Rescan bucket**.
7. In the Filebase console, confirm the bucket is still **private** and add the CORS rule from the
   README with `ExposeHeaders: ["ETag"]` (required for files over 32 MB).

### 7.6 Troubleshooting (Filebase specifics)

* `SignatureDoesNotMatch` or bucket-not-found in Settings? Filebase documents region `auto`; this
  project defaults to `us-east-1` (which Filebase accepts). If it fails, set
  `FILEBASE_REGION=auto` in the host dashboard and redeploy.
* Both URL styles are valid on Filebase. This app signs virtual-hosted URLs
  (`gaming-asset.s3.filebase.io/...`), which is Filebase's documented default — no extra flag needed.
* Uploads failing only in the browser, while *Test bucket access* is green → the bucket CORS rule is
  missing or does not include your `https://<name>.onrender.com` origin.

### 7.7 Free tier: keeping the index in your bucket

Render Free cannot attach a disk, and the filesystem is wiped on every redeploy and every cold start
(after ~15 minutes idle). By default the metadata index (`assets.json`) lives on that disk, so it would
reset constantly.

`render.yaml` therefore sets:

```yaml
GAMEVAULT_INDEX_OBJECT=_gamevault/index.json
```

With this on, every metadata change is mirrored to your bucket at `_gamevault/index.json` and restored
on boot — so titles, tags, collections and notes all survive restarts. Properties that make this safe:

* It lives **outside** the `assets/` prefix, so *Rescan bucket* never treats it as an asset.
* Writes are debounced and single-flight; a failed mirror only logs a warning and never breaks a request.
* If the object is missing or unreadable, startup falls back to the local file (or an empty index).
* Leave `GAMEVAULT_INDEX_OBJECT` unset to disable it entirely and use disk only.

You can verify it from the Filebase console: open the bucket and confirm a `_gamevault/index.json`
object appears after your first upload or metadata edit.

Cold starts on the free plan are normal: the first page load after a sleep can take 30–60 seconds.

### 7.8 Password login (a short password instead of the long token)

`GAMEVAULT_AUTH_TOKEN` is a 64-character machine secret — fine for scripts, painful to
type on a phone. `GAMEVAULT_PASSWORD_HASH` adds a **separate, human-friendly login
password** for the browser UI. It does not replace the token: both work, and both are
checked with the same `requireAuth` middleware.

How it works:

- The browser posts the password once to `POST /api/auth/login`.
- The server compares it against the stored **PBKDF2-SHA256** hash (600 000 iterations,
  random 16-byte salt) in constant time.
- On success the server sets an `HttpOnly`, `SameSite=Strict` cookie (`gv_session`)
  holding an HMAC-signed expiry timestamp. **The password, the hash and the API token are
  never sent to the browser.**
- Sessions refresh while you use the app and expire after **24 hours of inactivity**
  (`GAMEVAULT_SESSION_TTL_HOURS`). The UI also locks itself client-side after the same
  idle period, so an abandoned tab cannot be used.
- `Settings → Session → Lock now` ends the session immediately.

**Step 1 — generate the hash (phone).** Open `tools/password-hash.html` in your phone
browser (it works offline, nothing is uploaded), type the password twice, tap
**Create hash**, then **Copy**. You get one line:

```
pbkdf2$sha256$600000$<salt>$<hash>
```

No browser to hand? Any Node install works:

```bash
node server/scripts/hash-password.mjs 'my login password'
```

**Step 2 — paste it into the host.** Render → your service → **Environment** →
`GAMEVAULT_PASSWORD_HASH` → paste the `pbkdf2$…` line → **Save changes**. `render.yaml`
already declares the variable with `sync: false`, so the value never lives in Git.
Optionally set `GAMEVAULT_SESSION_TTL_HOURS` (default `24`).

**Step 3 — use it.** Open the site; it asks for the password instead of the token.
The token still works for API calls (`X-GameVault-Token` header) and via
"Use an API token instead" on the login screen.

Notes:

- Leave the variable empty to keep token-only login — nothing else changes.
- Changing the password means generating a new hash and updating the variable; changing
  `GAMEVAULT_AUTH_TOKEN` also invalidates every existing session.
- Sessions are stateless, so a cookie copied out of a browser stays valid until it
  expires. Keeping the TTL at 24 hours limits that exposure; "Lock now" clears it locally.
- Never paste the password itself (or the hash) into chat, a commit, or a `VITE_` variable.
