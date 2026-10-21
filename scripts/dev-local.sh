#!/usr/bin/env bash
# Runs GameVault fully locally against the bundled S3-compatible dev server,
# so you can try every feature without Filebase credentials.
#   bash scripts/dev-local.sh
# Real credentials in server/.env always take precedence for production use.
set -euo pipefail
cd "$(dirname "$0")/.."

MOCK_PORT="${MOCK_PORT:-9101}"   # 9100 is reserved for the app/preview
export FILEBASE_ENDPOINT="${FILEBASE_ENDPOINT:-http://127.0.0.1:$MOCK_PORT}"
export FILEBASE_ACCESS_KEY_ID="${FILEBASE_ACCESS_KEY_ID:-local-dev-key}"
export FILEBASE_SECRET_ACCESS_KEY="${FILEBASE_SECRET_ACCESS_KEY:-local-dev-secret}"
export FILEBASE_BUCKET="${FILEBASE_BUCKET:-gaming-asset}"

echo "→ starting local S3 stand-in on :$MOCK_PORT (dev only — not Filebase)"
node server/dev/mock-s3.mjs --port "$MOCK_PORT" --dir .mock-s3 &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT

sleep 1
echo "→ API :${PORT:-3001} + Vite :5173 (env: $FILEBASE_ENDPOINT / $FILEBASE_BUCKET)"
npm run dev
