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

# ── services ──────────────────────────────────────────────────────────────────
echo "[entrypoint] Starting backend  → http://0.0.0.0:8001"
cd /app
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload &
BACKEND_PID=$!

echo "[entrypoint] Starting frontend → http://0.0.0.0:8000"
cd /app/frontend
npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

wait
