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
 *   v1/releases/{versionIndex}.json.gz           Release summary for one history index
 *   v1/buckets/{table}/{bucketHex}.json.gz       { [hash]: ItemRevision[] }
 *   v1/entry-dates.bin.gz                        Compact per-entry date index
 *
 * The hourly history updater runs in GitHub Actions; this Worker never writes
 * to R2 and never parses a manifest table.
 */

// ---------------------------------------------------------------------------
// Minimal Workers runtime types
// ---------------------------------------------------------------------------

interface R2ObjectBody {
  readonly body: ReadableStream<Uint8Array> | null;
  /** R2 supplies a quoted validator for the stored object; mocks may omit it. */
  readonly httpEtag?: string;
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
const ENTRY_DATES_KEY = 'v1/entry-dates.bin.gz';
const BUCKET_PREFIX = 'v1/buckets';
const RELEASE_PREFIX = 'v1/releases';

const LITE_ITEM_TABLE = 'DestinyInventoryItemLiteDefinition';
const FULL_ITEM_TABLE = 'DestinyInventoryItemDefinition';

const HISTORY_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';
const VERSIONS_CACHE_CONTROL = 'public, max-age=60, must-revalidate';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=86400, immutable';

const TABLE_RE = /^[A-Za-z0-9_]{1,96}$/;
const BUCKET_RE = /^[0-9a-f]{2,3}$/;
const RELEASE_RE = /^\d{1,6}$/;
const CACHE_BUSTER_RE = /^\d{1,12}$/;
const REVISION_RE = /^[0-9A-Za-z._-]{1,40}$/;

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
    return serveVersions(request, url, env, ctx);
  }

  if (pathname === '/api/history/entry-dates' || pathname === '/api/history/entry-dates/') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'Method not allowed');
    }
    return serveEntryDates(request, url, env, ctx);
  }

  if (pathname.startsWith('/api/history/bucket/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'Method not allowed');
    }
    return serveBucket(request, url, env, ctx);
  }

  if (pathname.startsWith('/api/history/release/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'Method not allowed');
    }
    return serveRelease(request, url, env, ctx);
  }

  if (pathname === '/history' || pathname.startsWith('/history/')) {
    return serveHistoryPage(request, url, env);
  }

  // Static assets and SPA routes are served from Cloudflare Assets.
  return env.ASSETS.fetch(request);
}

const HISTORY_PAGE_TITLE = 'Destiny 2 Manifest History';
const HISTORY_PAGE_DESCRIPTION =
  'Browse Destiny 2 manifest updates from 2017 to today with categorized changes and full JSON diffs.';
const HISTORY_PAGE_IMAGE = 'https://manifest.d2clarity.com/og-history.png?v=20261127-1';
const HISTORY_PAGE_IMAGE_ALT = 'Destiny 2 Manifest History diffs by Clarity';

async function serveHistoryPage(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  // Fetch the SPA index.html from Assets and swap Open Graph / Twitter tags so
  // link previews on Discord, Slack, and social platforms show the /history
  // embed image and copy without needing JS execution.
  const indexUrl = new URL('/index.html', url.origin);
  const assetResponse = await env.ASSETS.fetch(
    new Request(indexUrl.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: request.headers,
    }),
  );
  const contentType = assetResponse.headers.get('Content-Type') ?? '';
  if (!assetResponse.ok || !contentType.includes('text/html')) {
    return assetResponse;
  }

  const canonicalUrl = `https://manifest.d2clarity.com${url.pathname}`;
  const html = (await assetResponse.text())
    .replace(/<title>[^<]*<\/title>/, `<title>${HISTORY_PAGE_TITLE}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_DESCRIPTION}$2`,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_TITLE}$2`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_DESCRIPTION}$2`,
    )
    .replace(
      /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
      `$1${canonicalUrl}$2`,
    )
    .replace(
      /(<meta\s+property="og:image"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_IMAGE}$2`,
    )
    .replace(
      /(<meta\s+property="og:image:alt"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_IMAGE_ALT}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_TITLE}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_DESCRIPTION}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/,
      `$1${HISTORY_PAGE_IMAGE}$2`,
    );

  const headers = new Headers(assetResponse.headers);
  headers.delete('Content-Length');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(request.method === 'HEAD' ? null : html, {
    status: assetResponse.status,
    headers,
  });
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

function jsonOk(value: unknown, cacheControl: string, etag?: string): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
  };
  if (etag) headers.ETag = etag;
  return new Response(JSON.stringify(value), {
    status: 200,
    headers,
  });
}

// ---------------------------------------------------------------------------
// Conditional request helpers
// ---------------------------------------------------------------------------

/** `If-None-Match` uses the weak comparison function (RFC 9110 §13.1.2). */
function stripWeakPrefix(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

function ifNoneMatchMatches(header: string | null, etag: string | null): boolean {
  if (!header || !etag) return false;
  const target = stripWeakPrefix(etag.trim());
  if (!target) return false;
  return header.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    // `*` matches any current representation.
    if (trimmed === '*') return true;
    return stripWeakPrefix(trimmed) === target;
  });
}

function notModifiedResponse(cacheControl: string | null, etag: string): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, ETag: etag };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  return new Response(null, { status: 304, headers });
}

/** HEAD keeps the representation headers but never a body. */
function headOnlyResponse(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers });
}

function withCacheControl(response: Response, cacheControl: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', cacheControl);
  return new Response(response.body, { status: response.status, headers });
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
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const isHead = request.method === 'HEAD';
  const ifNoneMatch = request.headers.get('If-None-Match');
  const cacheKey = buildCacheKey(url, '/api/history/versions');
  const cached = await matchEdgeCache(cacheKey);
  if (cached) {
    const cachedEtag = cached.headers.get('ETag');
    // Older edge entries predate validators. Refresh those from R2 instead of
    // serving a cache hit that cannot participate in conditional requests.
    if (cachedEtag) {
      if (ifNoneMatchMatches(ifNoneMatch, cachedEtag)) {
        return notModifiedResponse(VERSIONS_CACHE_CONTROL, cachedEtag);
      }
      const refreshed = withCacheControl(cached, VERSIONS_CACHE_CONTROL);
      return isHead ? headOnlyResponse(refreshed) : refreshed;
    }
  }

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
        'Cache-Control': VERSIONS_CACHE_CONTROL,
        ETag: etag,
      },
    });

    // Always cache the full 200 representation and derive 304 responses from
    // it on demand; a 304 must never be stored in `caches.default`.
    storeInEdgeCache(cacheKey, response, ctx);

    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      return notModifiedResponse(VERSIONS_CACHE_CONTROL, etag);
    }
    return isHead ? headOnlyResponse(response) : response;
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'history-versions-error', error: errorMessage(error) }),
    );
    return jsonError(503, 'History storage unavailable');
  }
}

async function serveBucket(
  request: Request,
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

  // A valid `v` plus `rev` makes the bucket URL content-addressed. The
  // decoded-cache format suffix separates this payload from older cache data.
  const requestedVersion = url.searchParams.get('v');
  const version =
    requestedVersion && CACHE_BUSTER_RE.test(requestedVersion) ? requestedVersion : null;
  const requestedRevision = url.searchParams.get('rev');
  const revision =
    requestedRevision && REVISION_RE.test(requestedRevision) ? requestedRevision : null;
  const cacheControl =
    version && revision ? IMMUTABLE_CACHE_CONTROL : HISTORY_CACHE_CONTROL;
  const cacheSearch = `?${version ? `v=${version}&` : ''}format=json-v3${
    revision ? `&rev=${revision}` : ''
  }`;
  const isHead = request.method === 'HEAD';
  const ifNoneMatch = request.headers.get('If-None-Match');
  const deterministicEtag =
    `"${canonicalTable}:${bucket}:${version ?? 'latest'}:${revision ?? 'latest'}"`;

  const cacheKey = buildCacheKey(
    url,
    `/api/history/bucket/${canonicalTable}/${bucket}`,
    cacheSearch,
  );
  const cached = await matchEdgeCache(cacheKey);
  if (cached) {
    const cachedEtag = cached.headers.get('ETag');
    // Legacy bucket cache entries have no validator; bypass them so the
    // decoded R2 representation can be refreshed with an ETag.
    if (cachedEtag) {
      if (ifNoneMatchMatches(ifNoneMatch, cachedEtag)) {
        return notModifiedResponse(cacheControl, cachedEtag);
      }
      const refreshed = withCacheControl(cached, cacheControl);
      return isHead ? headOnlyResponse(refreshed) : refreshed;
    }
  }

  const key = `${BUCKET_PREFIX}/${canonicalTable}/${bucket}.json.gz`;

  try {
    const object = await env.MANIFEST_HISTORY.get(key);
    // R2's validator changes whenever the stored object changes; the
    // deterministic fallback still distinguishes every URL variant.
    const etag = object?.httpEtag || deterministicEtag;
    if (!object) {
      // Buckets with no recorded changes must not produce noisy 404s in the
      // browser console, so answer with an empty bucket instead.
      const empty = jsonOk({}, cacheControl, etag);
      storeInEdgeCache(cacheKey, empty, ctx);
      if (ifNoneMatchMatches(ifNoneMatch, etag)) {
        return notModifiedResponse(cacheControl, etag);
      }
      return isHead ? headOnlyResponse(empty) : empty;
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
        ETag: etag,
      },
    });

    // Always cache the full 200 representation and derive 304 responses from
    // it on demand; a 304 must never be stored in `caches.default`.
    storeInEdgeCache(cacheKey, response, ctx);

    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      return notModifiedResponse(cacheControl, etag);
    }
    return isHead ? headOnlyResponse(response) : response;
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

async function serveEntryDates(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const requestedVersion = url.searchParams.get('v');
  const version =
    requestedVersion && CACHE_BUSTER_RE.test(requestedVersion) ? requestedVersion : null;
  const requestedRevision = url.searchParams.get('rev');
  const revision =
    requestedRevision && REVISION_RE.test(requestedRevision) ? requestedRevision : null;
  const cacheControl =
    version && revision ? IMMUTABLE_CACHE_CONTROL : HISTORY_CACHE_CONTROL;
  const cacheSearch = `?${version ? `v=${version}&` : ''}format=bin-v1${
    revision ? `&rev=${revision}` : ''
  }`;
  const isHead = request.method === 'HEAD';
  const ifNoneMatch = request.headers.get('If-None-Match');
  const deterministicEtag = `"entry-dates:${version ?? 'latest'}:${revision ?? 'latest'}"`;
  const cacheKey = buildCacheKey(url, '/api/history/entry-dates', cacheSearch);
  const cached = await matchEdgeCache(cacheKey);
  if (cached) {
    const cachedEtag = cached.headers.get('ETag');
    if (cachedEtag) {
      if (ifNoneMatchMatches(ifNoneMatch, cachedEtag)) {
        return notModifiedResponse(cacheControl, cachedEtag);
      }
      const refreshed = withCacheControl(cached, cacheControl);
      return isHead ? headOnlyResponse(refreshed) : refreshed;
    }
  }

  try {
    const object = await env.MANIFEST_HISTORY.get(ENTRY_DATES_KEY);
    if (!object) return jsonError(404, 'Entry dates not found');
    const etag = object.httpEtag || deterministicEtag;
    const compressedBody = object.body ?? new Response(await object.arrayBuffer()).body;
    const decompressor = new DecompressionStream('gzip') as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    const body = compressedBody?.pipeThrough(decompressor);
    if (!body) return jsonError(503, 'Entry dates body unavailable');
    const response = new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/octet-stream',
        'Cache-Control': cacheControl,
        ETag: etag,
      },
    });
    storeInEdgeCache(cacheKey, response, ctx);
    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      return notModifiedResponse(cacheControl, etag);
    }
    return isHead ? headOnlyResponse(response) : response;
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'history-entry-dates-error', error: errorMessage(error) }),
    );
    return jsonError(503, 'History storage unavailable');
  }
}

async function serveRelease(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  // ["api", "history", "release", versionIndex]
  if (segments.length !== 4) {
    return jsonError(404, 'Not found');
  }

  const versionIndex = segments[3];
  // Validate before touching the Cache API or R2 so invalid requests are free.
  if (!versionIndex || !RELEASE_RE.test(versionIndex)) {
    return jsonError(400, 'Invalid history release path');
  }

  // A valid `v` plus `rev` makes the release URL content-addressed. The
  // decoded-cache format suffix separates refreshed data from older responses.
  const requestedVersion = url.searchParams.get('v');
  const version =
    requestedVersion && CACHE_BUSTER_RE.test(requestedVersion) ? requestedVersion : null;
  const requestedRevision = url.searchParams.get('rev');
  const revision =
    requestedRevision && REVISION_RE.test(requestedRevision) ? requestedRevision : null;
  const cacheControl =
    version && revision ? IMMUTABLE_CACHE_CONTROL : HISTORY_CACHE_CONTROL;
  const cacheSearch = `?${version ? `v=${version}&` : ''}format=json-v3${
    revision ? `&rev=${revision}` : ''
  }`;
  const isHead = request.method === 'HEAD';
  const ifNoneMatch = request.headers.get('If-None-Match');
  const deterministicEtag =
    `"release:${versionIndex}:${version ?? 'latest'}:${revision ?? 'latest'}"`;

  const cacheKey = buildCacheKey(
    url,
    `/api/history/release/${versionIndex}`,
    cacheSearch,
  );
  const cached = await matchEdgeCache(cacheKey);
  if (cached) {
    const cachedEtag = cached.headers.get('ETag');
    // Legacy release cache entries have no validator; fall through to R2 and
    // replace them with a validated response.
    if (cachedEtag) {
      if (ifNoneMatchMatches(ifNoneMatch, cachedEtag)) {
        return notModifiedResponse(cacheControl, cachedEtag);
      }
      const refreshed = withCacheControl(cached, cacheControl);
      return isHead ? headOnlyResponse(refreshed) : refreshed;
    }
  }

  const key = `${RELEASE_PREFIX}/${versionIndex}.json.gz`;

  try {
    const object = await env.MANIFEST_HISTORY.get(key);
    if (!object) {
      return jsonError(404, 'History release not found');
    }
    // R2's validator changes whenever the stored object changes; the
    // deterministic fallback still distinguishes every URL variant.
    const etag = object.httpEtag || deterministicEtag;

    // R2 stores release files as gzip-compressed JSON. Return decoded JSON
    // here for the same reason as `serveBucket`: Cloudflare's edge can
    // re-encode a gzip response, leaving clients with gzip bytes.
    const compressedBody =
      object.body ?? new Response(await object.arrayBuffer()).body;
    const decompressor = new DecompressionStream('gzip') as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    const body = compressedBody?.pipeThrough(decompressor);
    if (!body) {
      return jsonError(503, 'History release body unavailable');
    }
    const response = new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cacheControl,
        ETag: etag,
      },
    });

    // Always cache the full 200 representation and derive 304 responses from
    // it on demand; a 304 must never be stored in `caches.default`.
    storeInEdgeCache(cacheKey, response, ctx);

    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      return notModifiedResponse(cacheControl, etag);
    }
    return isHead ? headOnlyResponse(response) : response;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'history-release-error',
        versionIndex,
        error: errorMessage(error),
      }),
    );
    return jsonError(503, 'History storage unavailable');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
