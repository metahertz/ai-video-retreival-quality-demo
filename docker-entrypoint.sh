#!/usr/bin/env bash
set -e

# ── node_modules ──────────────────────────────────────────────────────────────
# The repo is bind-mounted at /app, so /app/frontend/node_modules may not exist.
# Symlink the pre-built modules from the image into the mounted tree.
if [ ! -e /app/frontend/node_modules ]; then
    echo "[entrypoint] Linking node_modules from /opt/frontend/node_modules"
    ln -s /opt/frontend/node_modules /app/frontend/node_modules
fi

# ── videos directory ──────────────────────────────────────────────────────────
mkdir -p /app/backend/videos

# ── yt-dlp update ────────────────────────────────────────────────────────────
echo "[entrypoint] Updating yt-dlp to latest version"
pip install --upgrade yt-dlp
echo "[entrypoint] yt-dlp version: $(python3 -c 'import yt_dlp; print(yt_dlp.version.__version__)')"

# ── frontend build ────────────────────────────────────────────────────────────
# Build at container start so that NEXT_PUBLIC_API_URL (and any other
# NEXT_PUBLIC_* vars set in docker-compose) are baked into the bundle.
# next dev compiles on-demand which causes chunk-load timeouts behind a proxy.
echo "[entrypoint] Building frontend (NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL})"
cd /app/frontend
npm run build

# ── services ──────────────────────────────────────────────────────────────────
echo "[entrypoint] Starting backend  → http://0.0.0.0:8001"
cd /app
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 &
BACKEND_PID=$!

echo "[entrypoint] Starting frontend → http://0.0.0.0:8000"
cd /app/frontend
npm start &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

wait
