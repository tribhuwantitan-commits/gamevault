# GameVault

A private, self-hosted cloud library for **game development assets** — upload, organise,
preview and download textures, models, audio, video, archives and project files. Files live in
**Filebase S3-compatible object storage**; metadata lives in a single JSON file on the server.
No database, no third-party services, no public bucket.

```
React + TypeScript + Vite  ·  Tailwind CSS  ·  Node + Express + TypeScript  ·  AWS SDK v3 → Filebase
```

---

## What actually works

Verified in this workspace by automated tests (`server/test/*.test.ts`) and a real browser
session driven by Playwright (`e2e/smoke.mjs`) against an S3-compatible server:

| Area | Status |
| --- | --- |
| Upload (single presigned PUT + multipart ≥ threshold), progress, cancel, retry | ✅ tested end-to-end over HTTP |
| Server-side verification of every upload (`HEAD`, size must match) — no simulated success | ✅ tested (mismatch is discarded with `422`) |
| Listing, search, category/type/tag filters, sorting, pagination, stats | ✅ tested |
| Download via short-lived presigned GET, previews via short-lived redirect | ✅ tested (bytes compared) |
| Rename / re-tag / move collection (PATCH), delete (object + index) | ✅ tested |
| Bucket rescan (`POST /api/assets/rescan`, Settings → Rescan) | ✅ tested (detects objects deleted behind the app's back) |
| Collections: create, delete empty custom ones, built-ins protected | ✅ tested |
| Image / audio / video previews, **glTF/GLB/OBJ/STL/FBX 3D preview**, download-only fallback for BLEND/ZIP/etc. | ✅ tested in Chromium |
| Dark + light theme, responsive desktop/mobile, drag & drop, confirmations, toasts, empty/loading states | ✅ tested |
| Token gate (`GAMEVAULT_AUTH_TOKEN`) + setup mode without credentials | ✅ tested |
| Password login (`GAMEVAULT_PASSWORD_HASH`) with HttpOnly session + idle auto-lock | ✅ tested |
| **Uploads to the real Filebase service** | ⚠️ **not tested here** — no Filebase credentials exist in this workspace. Everything is exercised against a local S3-compatible server instead; point `FILEBASE_ENDPOINT` at `https://s3.filebase.io` and add real keys to try it. |

If a format has no browser loader, the UI says so and offers a download. Nothing is faked.

---

## Quick start

```bash
# 1. install
npm install

# 2. configure the server (never commit this file)
cp server/.env.example server/.env
#    → paste FILEBASE_ACCESS_KEY_ID / FILEBASE_SECRET_ACCESS_KEY
#    → optionally set GAMEVAULT_AUTH_TOKEN (openssl rand -hex 32)

# 3. develop (API on :3001, Vite on :5173 with /api proxied to the API)
npm run dev

# 4. production build, served by the API on one origin
npm run build
npm start            # http://localhost:3001
```

Tests:

```bash
npm test                    # 23 tests: validation, API round-trips, auth gate, setup mode
npm run check:secrets       # asserts no credential-shaped strings in client/dist
node e2e/smoke.mjs          # 27-check Playwright run against the built app (optional)
```

`e2e/smoke.mjs` needs `playwright` + `npx playwright install chromium` and a running API
(`npm run dev:local` then `npm run build && npm start`), plus sample files in `/tmp/assets`:

```bash
node -e "require('fs').mkdirSync('/tmp/assets',{recursive:true})"   # add real PNG/GLB/WAV/ZIP/FBX here
s3cmd cp ...                                                        # …or any sample assets
node e2e/smoke.mjs --base http://127.0.0.1:3001 --dir /tmp/assets --shots /tmp/shots
```

> The server starts fine **without** credentials: the UI shows a clearly-labelled setup state,
> reading an empty library works, and uploads return a descriptive `503 storage_not_configured`.
> It never crashes and never reports a fake success.

### Trying it without Filebase (local S3 stand-in)

`server/dev/mock-s3.mjs` is a tiny S3-compatible server used for development and the test suite.
One command starts it together with the API and Vite, with matching env vars:

```bash
npm run dev:local      # mock S3 :9101 + API :3001 + Vite :5173
```

To preview the production build on a specific port (e.g. 9100), override `PORT` — keep the
stand-in on a different port so the two never fight for it:

```bash
npm run build
PORT=9100 FILEBASE_ENDPOINT=http://127.0.0.1:9101 npm start
```

Every feature (upload, multipart, previews, download, delete, rescan) works against it.
Path-style addressing switches on automatically for non-Filebase endpoints. Real Filebase
credentials in `server/.env` take precedence — this stand-in is never used in production.

---

## Filebase setup

1. Create a bucket named **`gaming-asset`** in the Filebase console and leave it **private**.
2. Create an access key (Storage → Access Keys) with read/write access to that bucket.
3. Put the values in `server/.env`:

```env
FILEBASE_ACCESS_KEY_ID=...
FILEBASE_SECRET_ACCESS_KEY=...
FILEBASE_BUCKET=gaming-asset
FILEBASE_ENDPOINT=https://s3.filebase.io
PORT=3001
```

4. **CORS on the bucket** — required because the browser uploads directly to Filebase with
   presigned URLs (this keeps large files off your API server). Add a rule like:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://your-gamevault-domain.example"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

`ExposeHeaders: ["ETag"]` is what makes multipart uploads completable. If you would rather avoid
CORS entirely, raise `MULTIPART_THRESHOLD_BYTES` above your largest file so every upload uses a
single presigned `PUT` (still a cross-origin request, so CORS is still needed).

5. Restart the API and open **Settings → Test bucket access** — it performs a read-only list of the
   `assets/` prefix to prove the credentials work.

---

## Configuration

Everything is read from the server environment (`server/.env`, or the host's env vars).
See `server/.env.example` for the annotated list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FILEBASE_ACCESS_KEY_ID` | – | **required** Filebase key (server-only) |
| `FILEBASE_SECRET_ACCESS_KEY` | – | **required** Filebase secret (server-only) |
| `FILEBASE_BUCKET` | `gaming-asset` | bucket name |
| `FILEBASE_ENDPOINT` | `https://s3.filebase.io` | S3-compatible endpoint |
| `FILEBASE_REGION` | `us-east-1` | signing region |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | API listener |
| `GAMEVAULT_AUTH_TOKEN` | empty | shared secret required on every non-public API call |
| `GAMEVAULT_PASSWORD_HASH` | empty | optional login password (PBKDF2 hash) for the browser UI — see `DEPLOYMENT.md` §7.8 |
| `GAMEVAULT_SESSION_TTL_HOURS` | `24` | idle session lifetime before the password is required again |
| `GAMEVAULT_ALLOWED_ORIGINS` | `http://localhost:5173,…` | extra browser origins allowed to call the API |
| `MAX_UPLOAD_BYTES` | `2147483648` (2 GiB) | per-file ceiling |
| `MULTIPART_THRESHOLD_BYTES` | `33554432` (32 MiB) | files at/above this use multipart |
| `MULTIPART_PART_SIZE_BYTES` | `8388608` (8 MiB) | multipart part size |
| `PRESIGN_UPLOAD_EXPIRES_SECONDS` | `900` | upload URL lifetime |
| `PRESIGN_DOWNLOAD_EXPIRES_SECONDS` | `600` | download/preview URL lifetime |
| `GAMEVAULT_DATA_DIR` | `server/data` | where `assets.json` lives |
| `GAMEVAULT_INDEX_OBJECT` | empty (off) | mirror the index into the bucket, e.g. `_gamevault/index.json` — needed on hosts without a persistent disk |

No variable is prefixed with `VITE_`, so nothing is inlined into the frontend bundle.

---

## Security model

**What is protected**

* Credentials are read only by the server process. They are never sent to the browser, never
  written to logs, never embedded in the bundle (there is no `VITE_*` secret and no `.env` import
  in client code), and never returned by an API response. `npm run build` produces a bundle that
  contains no Filebase strings — verify with `grep -r "FILEBASE" client/dist || echo clean`.
* The bucket stays private. The browser gets **short-lived presigned URLs** (10 min downloads,
  15 min uploads) and same-origin redirects; it never gets credentials.
* Object keys are generated by the server (`assets/<uuid>/<sanitised-name>`). The browser never
  supplies a key: it supplies a filename + size, which are validated against an allow-list,
  sanitised (directory components and control characters stripped) and capped in length.
* Every mutation is validated with Zod; unknown PATCH fields are rejected. Object ids must be
  UUIDs. Downloads and deletes resolve the key from the server-side index only.
* Deletion requires the asset to exist in the index; a request can only delete under `assets/`.
* Uploads are verified with `HEAD` before being indexed: a mismatched size deletes the object and
  returns `422` instead of recording a bogus entry.
* A rescan only ever lists the `assets/` prefix, so nothing else in the bucket is exposed.
* Rate limiting, security headers, strict CORS, and a 256 kB JSON body limit are on by default.

**What you must do before exposing it publicly**

* Set `GAMEVAULT_AUTH_TOKEN` (`openssl rand -hex 32`). Without it, **anyone who can reach the API
  can list, download and delete your assets.** A private bucket does *not* make an unauthenticated
  API private — the API is the only thing that can mint download URLs.
* Serve over HTTPS (the token is a bearer credential).
* Set `GAMEVAULT_ALLOWED_ORIGINS` to your real frontend origin(s) if they differ from the API's.
* Prefer typing a short password on your phone? Generate a hash with
  `tools/password-hash.html` (works offline) or `npm run hash-password`, and set
  `GAMEVAULT_PASSWORD_HASH`. The long token keeps working for scripts; the browser gets a
  24-hour, HttpOnly session cookie instead. Neither the token nor the hash ever reaches the
  browser.
* The token gate is a single shared secret, appropriate for a personal library. For multiple
  users, replace `server/src/middleware/auth.ts` with real sessions/OIDC — the rest of the app
  does not need to change.

---

## API

All routes are under `/api`. `401` when a token is configured and missing/invalid.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | public; `?storage=1` performs a read-only Filebase round-trip |
| `GET` | `/capabilities` | public; setup state, limits, supported formats, collections |
| `GET` | `/assets` | `?q&collection&kind&tag&sort&page&pageSize` → `{items,page,total,totalPages,summary}` |
| `GET` | `/assets/stats` | totals, per-collection/type breakdown, top tags |
| `POST` | `/assets/upload-url` | validates, then returns a presigned single `PUT` or a multipart ticket |
| `POST` | `/assets/multipart/parts` | re-sign part URLs (100 at a time) |
| `POST` | `/assets/multipart/complete` | finish + verify + index |
| `POST` | `/assets/multipart/abort` | cancel and clean up |
| `POST` | `/assets/confirm-upload` | verify single upload with `HEAD`, then index |
| `GET` | `/assets/:id` | metadata |
| `GET` | `/assets/:id/file` | `302` → short-lived presigned URL (previews) |
| `GET` | `/assets/:id/download` | JSON with presigned URL (`?redirect=1` for a direct `302`) |
| `PATCH` | `/assets/:id` | `title`, `tags`, `collection`, `description` |
| `DELETE` | `/assets/:id` | deletes the object, then the index entry |
| `POST` | `/assets/rescan` | reconcile index ↔ bucket |
| `GET`/`POST`/`DELETE` | `/collections[/:id]` | list with counts, create custom, delete empty custom |

Errors are always `{ "error": { "code", "message", "details?" } }` — e.g. `unsupported_file_type`
(415), `file_too_large` (413), `upload_not_verified` (502), `size_mismatch` (422),
`storage_not_configured` (503), `unauthorized` (401), `collection_not_empty` (409).

Example:

```bash
curl localhost:3001/api/health
curl -H "X-GameVault-Token: $TOKEN" "localhost:3001/api/assets?collection=Textures&sort=newest"
```

---

## Project layout

```
gamevault/
├─ server/                     Express + TypeScript API
│  ├─ src/config.ts            env parsing, limits, storage config
│  ├─ src/lib/files.ts         format registry, filename sanitiser, key builder
│  ├─ src/lib/store.ts         atomic JSON metadata store (single writer, temp+rename)
│  ├─ src/lib/s3.ts            Filebase client, presigning, multipart, listing
│  ├─ src/routes/              assets.ts, collections.ts, meta.ts
│  ├─ src/middleware/          auth (token gate), errors, rate limit
│  ├─ dev/mock-s3.mjs          local S3-compatible server (dev/tests only)
│  ├─ test/                    node:test suites
│  └─ data/assets.json         metadata index (git-ignored, created at runtime)
├─ client/                     React + Vite + Tailwind SPA
│  ├─ src/components/          layout, cards, modals, previews, UI primitives
│  ├─ src/pages/               dashboard, assets, collections, uploads, settings
│  ├─ src/store/               library/upload/theme/toast contexts
│  └─ src/lib/                 api client, upload engine, formatting
├─ e2e/smoke.mjs               Playwright browser smoke test
└─ README.md · DEPLOYMENT.md
```

**Metadata & sync.** `server/data/assets.json` holds metadata only — never binaries. It is written
atomically (temp file + rename) behind a single-writer queue, and a corrupt file is parked as
`assets.json.corrupt-<ts>` while the app starts clean. If the index is lost entirely, press
**Settings → Rescan bucket**: objects under `assets/` are re-indexed from their stored keys and
entries whose object has disappeared are dropped.

---

## Deployment

Full instructions (single-server, split hosting, reverse proxy, Docker, checklists) are in
[`DEPLOYMENT.md`](./DEPLOYMENT.md). The short version:

```bash
npm ci
npm run build          # server/dist + client/dist
# set the env vars on the host (see the table above), then:
NODE_ENV=production npm start
```

The API serves `client/dist` on the same origin, so there is no CORS to configure in that setup.
Environment variables that **must** be set on the host: `FILEBASE_ACCESS_KEY_ID`,
`FILEBASE_SECRET_ACCESS_KEY`, `FILEBASE_BUCKET`, `FILEBASE_ENDPOINT`, `GAMEVAULT_AUTH_TOKEN`,
`PORT` (most hosts inject it), and `NODE_ENV=production`. Add a persistent volume for
`server/data` (or set `GAMEVAULT_DATA_DIR`) so the metadata index survives restarts.

The app never makes the bucket public and never deploys anything on its own.

---

## Known limitations

* **OBJ** previews geometry only (the `.mtl` material is not applied); **FBX** is parsed
  client-side with three.js' loader, so advanced materials/skinning may look plain. **BLEND**,
  **DAE**, **USDZ** and compressed (Draco/KTX2) glTF are download-only and labelled as such.
* `glTF` files that reference external `.bin`/texture files only preview correctly if those files
  are embedded in the upload; the UI warns about this.
* Single shared-secret auth (see above), one metadata file (fine for thousands of assets; swap for
  SQLite/Postgres if you outgrow it), and a fixed-window in-memory rate limiter — put a real
  limiter or reverse proxy in front for multi-instance deployments.
* Real Filebase uploads were not exercised in this workspace (no credentials). The identical code
  path was verified against a local S3-compatible server.
