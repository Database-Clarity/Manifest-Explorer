/**
 * Cloudflare Worker for manifest.d2clarity.com.
 *
 * A lightweight, edge-cached read proxy for the shared manifest-history data
 * in the `manifest-history` R2 bucket. Everything that is not `/api/history/*`
 * falls through to the static Vite build (Cloudflare Assets serves those
 * requests directly, without invoking this Worker).
 *
 * R2 layout (shared with scripts/history/* and src/manifest/history.ts):
 *
 *   v1/versions.json                             HistoryManifestIndex
 *   v1/buckets/{table}/{bucketHex}.json.gz       { [hash]: ItemRevision[] }
 *
 * The hourly history updater runs in GitHub Actions; this Worker never writes
 * to R2 and never parses a manifest table.
 */

// ---------------------------------------------------------------------------
// Minimal Workers runtime types
// ---------------------------------------------------------------------------

interface R2ObjectBody {
  readonly body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface Env {
  MANIFEST_HISTORY: R2Bucket;
  ASSETS: Fetcher;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSIONS_KEY = 'v1/versions.json';
const BUCKET_PREFIX = 'v1/buckets';

const LITE_ITEM_TABLE = 'DestinyInventoryItemLiteDefinition';
const FULL_ITEM_TABLE = 'DestinyInventoryItemDefinition';

const HISTORY_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=86400, immutable';

const TABLE_RE = /^[A-Za-z0-9_]{1,96}$/;
const BUCKET_RE = /^[0-9a-f]{2,3}$/;
const CACHE_BUSTER_RE = /^\d{1,12}$/;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function handleFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === 'OPTIONS' && isHistoryPath(pathname)) {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, If-None-Match',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (pathname === '/api/history/versions' || pathname === '/api/history/versions/') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'Method not allowed');
    }
    return serveVersions(url, env, ctx);
  }

  if (pathname.startsWith('/api/history/bucket/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'Method not allowed');
    }
    return serveBucket(url, env, ctx);
  }

  // Static assets and SPA routes are served from Cloudflare Assets.
  return env.ASSETS.fetch(request);
}

export default {
  fetch: handleFetch,
};

// ---------------------------------------------------------------------------
// Edge cache helpers
// ---------------------------------------------------------------------------

/**
 * `caches.default` is a Cloudflare extension to the standard Cache API and is
 * not part of the bundled WebWorker typings, so access it through a narrow
 * runtime-shaped interface.
 */
function getEdgeCache(): EdgeCache | null {
  const globalCaches = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches;
  return globalCaches?.default ?? null;
}

async function matchEdgeCache(cacheKey: Request): Promise<Response | null> {
  const cache = getEdgeCache();
  if (!cache) return null;
  try {
    return (await cache.match(cacheKey)) ?? null;
  } catch (error) {
    // A cache failure must never take the API down; fall through to R2.
    console.warn(
      JSON.stringify({ event: 'history-cache-match-error', error: errorMessage(error) }),
    );
    return null;
  }
}

function storeInEdgeCache(
  cacheKey: Request,
  response: Response,
  ctx: ExecutionContext,
): void {
  const cache = getEdgeCache();
  if (!cache || !ctx?.waitUntil) return;
  // Clone before the response body is returned to the client.
  const copy = response.clone();
  ctx.waitUntil(
    (async () => {
      try {
        await cache.put(cacheKey, copy);
      } catch (error) {
        console.warn(
          JSON.stringify({ event: 'history-cache-put-error', error: errorMessage(error) }),
        );
      }
    })(),
  );
}

function buildCacheKey(url: URL, pathname: string, search = ''): Request {
  const cacheUrl = new URL(url.toString());
  cacheUrl.pathname = pathname;
  cacheUrl.search = search;
  return new Request(cacheUrl.toString(), { method: 'GET' });
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

function isHistoryPath(pathname: string): boolean {
  return pathname === '/api/history' || pathname.startsWith('/api/history/');
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function jsonOk(value: unknown, cacheControl: string): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

function fallbackEtag(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

async function serveVersions(
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const cacheKey = buildCacheKey(url, '/api/history/versions');
  const cached = await matchEdgeCache(cacheKey);
  if (cached) return cached;

  try {
    const object = await env.MANIFEST_HISTORY.get(VERSIONS_KEY);
    if (!object) {
      return jsonError(404, 'History index not found');
    }

    const body = await object.text();
    const etag = fallbackEtag(body);
    const response = new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': HISTORY_CACHE_CONTROL,
        ETag: etag,
      },
    });

    storeInEdgeCache(cacheKey, response, ctx);
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'history-versions-error', error: errorMessage(error) }),
    );
    return jsonError(503, 'History storage unavailable');
  }
}

async function serveBucket(
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  // ["api", "history", "bucket", table, bucketHex]
  if (segments.length !== 5) {
    return jsonError(404, 'Not found');
  }

  const table = segments[3];
  const bucket = segments[4];
  // Validate before touching the Cache API or R2 so invalid requests are free.
  if (!table || !bucket || !TABLE_RE.test(table) || !BUCKET_RE.test(bucket)) {
    return jsonError(400, 'Invalid history bucket path');
  }

  // The UI requests the Lite item table; history is stored for the full table.
  const canonicalTable = table === LITE_ITEM_TABLE ? FULL_ITEM_TABLE : table;

  // `?v=<version>` makes the bucket URL content-addressed. `format=json`
  // versions the decoded response cache separately from older cached objects
  // that still contain the original gzip bytes.
  const requestedVersion = url.searchParams.get('v');
  const version =
    requestedVersion && CACHE_BUSTER_RE.test(requestedVersion) ? requestedVersion : null;
  const cacheControl = version ? IMMUTABLE_CACHE_CONTROL : HISTORY_CACHE_CONTROL;
  const cacheSearch = version ? `?v=${version}&format=json` : '?format=json';

  const cacheKey = buildCacheKey(
    url,
    `/api/history/bucket/${canonicalTable}/${bucket}`,
    cacheSearch,
  );
  const cached = await matchEdgeCache(cacheKey);
  if (cached) return cached;

  const key = `${BUCKET_PREFIX}/${canonicalTable}/${bucket}.json.gz`;

  try {
    const object = await env.MANIFEST_HISTORY.get(key);
    if (!object) {
      // Buckets with no recorded changes must not produce noisy 404s in the
      // browser console, so answer with an empty bucket instead.
      const empty = jsonOk({}, cacheControl);
      storeInEdgeCache(cacheKey, empty, ctx);
      return empty;
    }

    // R2 stores bucket files as gzip-compressed JSON. Return decoded JSON here
    // rather than forwarding the stored encoding: Cloudflare's remote preview
    // can re-encode a gzip response at the edge, leaving clients with the
    // original gzip bytes after the edge encoding is removed.
    const compressedBody =
      object.body ?? new Response(await object.arrayBuffer()).body;
    const decompressor = new DecompressionStream('gzip') as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    const body = compressedBody?.pipeThrough(decompressor);
    if (!body) {
      return jsonError(503, 'History bucket body unavailable');
    }
    const response = new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cacheControl,
      },
    });

    storeInEdgeCache(cacheKey, response, ctx);
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'history-bucket-error',
        table: canonicalTable,
        bucket,
        error: errorMessage(error),
      }),
    );
    return jsonError(503, 'History storage unavailable');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
