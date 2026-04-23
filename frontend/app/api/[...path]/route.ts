/**
 * Catch-all proxy: forwards every /api/* request from the browser to the
 * FastAPI backend (BACKEND_URL, default http://localhost:8001).
 *
 * Why this exists instead of next.config rewrites():
 *   next.config rewrites() don't reliably forward Range request headers or
 *   properly stream 206 Partial Content responses — both of which are required
 *   for in-browser video playback. This route handler explicitly preserves
 *   all request/response headers and streams the body without buffering.
 */

import { NextRequest, NextResponse } from 'next/server';

// Always resolved server-side; never sent to the browser.
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8001';

// Force Node.js runtime (not Edge) for full streaming / duplex fetch support.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hop-by-hop headers that must not be forwarded end-to-end.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

async function proxy(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const target = `${BACKEND}/api/${pathSegments.join('/')}${req.nextUrl.search}`;

  // ── Build forwarded request headers ──────────────────────────────────────
  const forwardHeaders = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    // Drop host (backend shouldn't see the browser's hostname) and hop-by-hop headers.
    if (lower !== 'host' && !HOP_BY_HOP.has(lower)) {
      forwardHeaders.set(key, value);
    }
  });

  // ── Body forwarding (POST/PUT/PATCH/DELETE) ───────────────────────────────
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  // 'duplex: half' is required by Node.js fetch when the body is a ReadableStream.
  // TypeScript's RequestInit doesn't declare this yet, so we cast.
  const fetchInit = {
    method: req.method,
    headers: forwardHeaders,
    ...(hasBody ? { body: req.body, duplex: 'half' } : {}),
  } as RequestInit;

  // ── Proxy to backend ──────────────────────────────────────────────────────
  let upstream: Response;
  try {
    upstream = await fetch(target, fetchInit);
  } catch (err) {
    console.error('[api-proxy] backend unreachable:', target, err);
    return new NextResponse('Backend unavailable', { status: 502 });
  }

  // ── Build forwarded response headers ─────────────────────────────────────
  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });

  // Stream the body directly — no buffering — so video range requests and
  // large file downloads work correctly.
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
