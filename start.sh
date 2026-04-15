#!/usr/bin/env bash
# Start both backend and frontend for the VoyageAI Video Demo

set -e

# Add local binaries (ffmpeg) to PATH
export PATH="$HOME/.local/bin:$PATH"

# Load nvm for Node.js
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting VoyageAI Video Demo..."
echo ""

# Backend (FastAPI)
echo "  Backend → http://localhost:8001"
echo "  API docs → http://localhost:8001/docs"
cd "$REPO_DIR"
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload &
BACKEND_PID=$!

# Frontend (Next.js)
echo "  Frontend → http://localhost:8000"
cd "$REPO_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Both services running. Press Ctrl+C to stop."

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
