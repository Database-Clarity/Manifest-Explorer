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
});
