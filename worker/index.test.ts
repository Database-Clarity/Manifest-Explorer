import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

const IMMUTABLE = 'public, max-age=86400, immutable';
const HISTORY = 'public, max-age=300, stale-while-revalidate=3600';

function compressedObject(value: unknown) {
  const bytes = new Uint8Array(gzipSync(JSON.stringify(value)));
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    httpEtag: '"r2-etag"',
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    text: async () => JSON.stringify(value),
  };
}

const entryDatesBinary = Uint8Array.from([
  0x45, 0x44, 0x41, 0x54, // EDAT
  0x01, 0x00, // schema, flags
  0x01, 0x00, // one version
  0x00, 0x00, 0x00, 0x00, // unix timestamp seconds
  0x00, 0x00, // no tables
]);
const compressedEntryDates = new Uint8Array(gzipSync(entryDatesBinary));

function setupWorker() {
  const cacheMatch = vi.fn(async () => undefined);
  const cachePut = vi.fn(async () => undefined);
  vi.stubGlobal('caches', {
    default: {
      match: cacheMatch,
      put: cachePut,
    },
  });

  const manifestHistory = {
    get: vi.fn(async (key: string) => {
      if (key === 'v1/versions.json') {
        return {
          text: async () => JSON.stringify({ schema: 1, generatedAt: '2025-01-01' }),
        };
      }
      if (key === 'v1/entry-dates.bin.gz') {
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(compressedEntryDates);
              controller.close();
            },
          }),
          httpEtag: '"entry-dates-r2"',
          arrayBuffer: async () => compressedEntryDates.buffer.slice(
            compressedEntryDates.byteOffset,
            compressedEntryDates.byteOffset + compressedEntryDates.byteLength,
          ),
          text: async () => '',
        };
      }
      return compressedObject({});
    }),
  };
  const env = {
    MANIFEST_HISTORY: manifestHistory,
    ASSETS: { fetch: vi.fn() },
  } as unknown as Env;
  const ctx = { waitUntil: vi.fn((promise: Promise<unknown>) => void promise) };
  return { env, ctx, cacheMatch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('history Worker cache policy', () => {
  it.each([
    ['/api/history/release/300', '/api/history/release/300?v=320'],
    ['/api/history/bucket/TestTable/00', '/api/history/bucket/TestTable/00?v=320'],
  ])('does not make a %s response immutable with v alone', async (_base, path) => {
    const { env, ctx } = setupWorker();
    const response = await worker.fetch(
      new Request(`https://example.test${path}`),
      env,
      ctx,
    );

    expect(response.headers.get('Cache-Control')).toBe(HISTORY);
  });

  it.each([
    '/api/history/release/300?v=320&rev=1764633600000',
    '/api/history/bucket/TestTable/00?v=320&rev=1764633600000',
  ])('makes a response immutable with valid v and rev: %s', async (path) => {
    const { env, ctx, cacheMatch } = setupWorker();
    const response = await worker.fetch(
      new Request(`https://example.test${path}`),
      env,
      ctx,
    );

    expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
    const cacheKey = cacheMatch.mock.calls[0]?.[0] as Request | undefined;
    expect(cacheKey?.url).toContain('format=json-v3');
    expect(cacheKey?.url).toContain('rev=1764633600000');
  });

  it.each([
    '/api/history/release/300?v=320&rev=bad%2Frevision',
    '/api/history/bucket/TestTable/00?v=320&rev=bad%2Frevision',
  ])('ignores invalid revisions for immutable caching: %s', async (path) => {
    const { env, ctx } = setupWorker();
    const response = await worker.fetch(
      new Request(`https://example.test${path}`),
      env,
      ctx,
    );

    expect(response.headers.get('Cache-Control')).toBe(HISTORY);
  });

  it('uses the short revalidation policy for versions.json', async () => {
    const { env, ctx } = setupWorker();
    const response = await worker.fetch(
      new Request('https://example.test/api/history/versions'),
      env,
      ctx,
    );

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate');
  });

  it('serves decompressed EDAT bytes with an R2 ETag and binary content type', async () => {
    const { env, ctx } = setupWorker();
    const response = await worker.fetch(
      new Request('https://example.test/api/history/entry-dates'),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('ETag')).toBe('"entry-dates-r2"');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...entryDatesBinary]);
  });

  it('supports conditional entry-date requests with 304 responses', async () => {
    const { env, ctx } = setupWorker();
    const response = await worker.fetch(
      new Request('https://example.test/api/history/entry-dates', {
        headers: { 'If-None-Match': '"entry-dates-r2"' },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe('"entry-dates-r2"');
    expect(await response.text()).toBe('');
  });

  it('uses immutable caching and a binary-format edge key only with valid v and rev', async () => {
    const immutable = setupWorker();
    const response = await worker.fetch(
      new Request('https://example.test/api/history/entry-dates?v=321&rev=1764633600000'),
      immutable.env,
      immutable.ctx,
    );
    expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
    const cacheKey = immutable.cacheMatch.mock.calls[0]?.[0] as Request | undefined;
    expect(cacheKey?.url).toContain('format=bin-v1');
    expect(cacheKey?.url).toContain('rev=1764633600000');

    const nonImmutable = setupWorker();
    const ordinary = await worker.fetch(
      new Request('https://example.test/api/history/entry-dates?v=321&rev=invalid%2Fvalue'),
      nonImmutable.env,
      nonImmutable.ctx,
    );
    expect(ordinary.headers.get('Cache-Control')).toBe(HISTORY);
  });

  it('returns a JSON 404 when the entry-date artifact is missing', async () => {
    const { env, ctx } = setupWorker();
    vi.mocked(env.MANIFEST_HISTORY.get).mockResolvedValueOnce(null);
    const response = await worker.fetch(
      new Request('https://example.test/api/history/entry-dates'),
      env,
      ctx,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Entry dates not found' });
  });
});
