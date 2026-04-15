FROM python:3.11-slim

# ── System packages ───────────────────────────────────────────────────────────
# ffmpeg  — video chunking and thumbnail extraction
# Node.js 20 — Next.js frontend
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ───────────────────────────────────────────────────────
# Installed to the system Python so they are available regardless of what is
# bind-mounted over /app at runtime.
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# ── Node.js dependencies ──────────────────────────────────────────────────────
# Installed to /opt/frontend — outside the /app mount point — so they are not
# hidden when the repo is bind-mounted at runtime.
# The entrypoint symlinks /app/frontend/node_modules → /opt/frontend/node_modules.
COPY frontend/package.json frontend/package-lock.json /opt/frontend/
RUN cd /opt/frontend && npm ci --prefer-offline

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Frontend :8000  |  Backend :8001
EXPOSE 8000 8001

ENTRYPOINT ["docker-entrypoint.sh"]
