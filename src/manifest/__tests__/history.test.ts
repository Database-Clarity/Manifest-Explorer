import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHistoryCache,
  fetchHistoryVersionsIndex,
  fetchItemHistory,
  fetchManifestRelease,
  getHistoryBucketHex,
  reconstructRemovedSnapshot,
  reconstructRevisionSnapshot,
  type ItemRevision,
  type HistoryManifestIndex,
  type HistoryVersionMeta,
} from '../history';

const version: HistoryVersionMeta = {
  i: 4,
  id: 'v-4',
  version: '2.9.0.4',
  date: '2024-01-02T00:00:00.000Z',
  source: 'sqlite',
  added: 1,
  modified: 0,
  removed: 0,
};

const index: HistoryManifestIndex = {
  schema: 1,
  generatedAt: '2024-01-02T00:00:00.000Z',
  buckets: { DestinyInventoryItemDefinition: 64 },
  versions: [version],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('history bucket calculation', () => {
  it('pads bucket names according to the configured bucket count', () => {
    expect(getHistoryBucketHex(0, 512)).toBe('000');
    expect(getHistoryBucketHex(511, 512)).toBe('1ff');
    expect(getHistoryBucketHex(63, 64)).toBe('3f');
    expect(getHistoryBucketHex(0, 1)).toBe('00');
    expect(getHistoryBucketHex(12, 0)).toBeNull();
  });

  it('uses the unsigned 32-bit value for hashes above 2^31', () => {
    expect(getHistoryBucketHex(0x80000000, 64)).toBe('00');
    expect(getHistoryBucketHex(-1, 512)).toBe('1ff');
    expect(getHistoryBucketHex(0xffffffff, 512)).toBe('1ff');
  });
});

describe('reverse-patch reconstruction', () => {
  it('reverses multi-step edits, additions, deletions, nested arrays, and escaped pointers immutably', () => {
    const current = {
      displayProperties: { name: 'Latest', 'a/b~c': 'new' },
      list: ['x', 'b'],
      nested: { values: [2, 2, 3] },
      added: { ok: true },
    };
    const original = JSON.stringify(current);
    const revisions: ItemRevision[] = [
      {
        v: 2,
        k: 'm',
        d: [
          [0, '/displayProperties/name', 'Old', 'Middle'],
          [0, '/displayProperties/a~1b~0c', 'old', 'new'],
          [2, '/removed', 'bye'],
          [2, '/list/0', 'a'],
          [2, '/list/1', 'c'],
        ],
      },
      {
        v: 3,
        k: 'm',
        d: [
          [0, '/displayProperties/name', 'Middle', 'Latest'],
          [1, '/added', { ok: true }],
          [1, '/list/0', 'x'],
          [0, '/nested/values/0', 1, 2],
          [1, '/nested/values/2', 3],
        ],
      },
    ];

    expect(reconstructRevisionSnapshot(current, revisions, 2)).toEqual({
      displayProperties: { name: 'Middle', 'a/b~c': 'new' },
      list: ['b'],
      nested: { values: [1, 2] },
    });
    expect(reconstructRevisionSnapshot(current, revisions, 1)).toEqual({
      displayProperties: { name: 'Old', 'a/b~c': 'old' },
      list: ['a', 'b', 'c'],
      nested: { values: [1, 2] },
      removed: 'bye',
    });
    expect(reconstructRevisionSnapshot(current, revisions)).toEqual(current);
    expect(JSON.stringify(current)).toBe(original);
  });

  it('reverses array additions, removals, and modifications in newest-first order', () => {
    const current = { values: ['B', 'c'] };
    const revisions: ItemRevision[] = [
      { v: 2, k: 'm', d: [[2, '/values/0', 'a']] },
      { v: 3, k: 'm', d: [[1, '/values/1', 'c']] },
      { v: 4, k: 'm', d: [[0, '/values/0', 'b', 'B']] },
    ];

    expect(reconstructRevisionSnapshot(current, revisions, 3)).toEqual({
      values: ['b', 'c'],
    });
    expect(reconstructRevisionSnapshot(current, revisions, 2)).toEqual({
      values: ['b'],
    });
    expect(reconstructRevisionSnapshot(current, revisions, 1)).toEqual({
      values: ['a', 'b'],
    });
  });

  it('restores nested removals before reversing a newly-added parent structure', () => {
    const current = { branch: { items: [{}] } };
    const revisions: ItemRevision[] = [
      { v: 2, k: 'a', d: [[1, '/branch', { items: [{ name: 'x' }] }]] },
      { v: 3, k: 'm', d: [[2, '/branch/items/0/name', 'x']] },
    ];

    expect(reconstructRevisionSnapshot(current, revisions, 2)).toEqual({
      branch: { items: [{ name: 'x' }] },
    });
    expect(reconstructRevisionSnapshot(current, revisions, 1)).toBeNull();
  });

  it('returns an absent snapshot before the item’s Added version', () => {
    const current = { displayProperties: { name: 'Item' } };
    const revisions: ItemRevision[] = [
      { v: 5, k: 'a', d: [[1, '/displayProperties', { name: 'Item' }]] },
    ];

    expect(reconstructRevisionSnapshot(current, revisions, 4)).toBeNull();
    expect(reconstructRevisionSnapshot(current, revisions, 5)).toEqual(current);
  });

  it('reconstructs a full removed snapshot from nested removal values', () => {
    const revisions: ItemRevision[] = [
      {
        v: 8,
        k: 'r',
        d: [
          [2, '/displayProperties/name', 'Removed item'],
          [2, '/displayProperties/icon', '/icons/removed.png'],
          [2, '/sockets/socketEntries/0/singleInitialItemHash', 42],
        ],
      },
    ];

    expect(reconstructRemovedSnapshot(revisions, 8)).toEqual({
      displayProperties: { name: 'Removed item', icon: '/icons/removed.png' },
      sockets: { socketEntries: [{ singleInitialItemHash: 42 }] },
    });
    expect(reconstructRemovedSnapshot(revisions, 7)).toBeNull();
  });
});

describe('fetchItemHistory', () => {
  beforeEach(() => {
    clearHistoryCache();
    vi.unstubAllGlobals();
  });

  it('caches the index and bucket and maps the Lite table to the full item table', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/history/versions')) {
        return jsonResponse(index);
      }
      return jsonResponse({
        '123': [{ v: 4, k: 'a', d: [[1, '/displayProperties/name', 'Item']] }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchItemHistory('DestinyInventoryItemLiteDefinition', 123);
    const second = await fetchItemHistory('DestinyInventoryItemLiteDefinition', 123);

    expect(first.available).toBe(true);
    expect(first.revisions).toHaveLength(1);
    expect(first.firstSeen).toEqual(version);
    expect(second.revisions).toEqual(first.revisions);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      '/api/history/bucket/DestinyInventoryItemDefinition/3b?v=4&format=json',
    );
  });

  it('keys bucket requests by the last version index so edge caches bust on each release', async () => {
    const latest: HistoryVersionMeta = {
      ...version,
      i: 9,
      id: 'v-9',
      version: '2.9.0.9',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/history/versions')) {
        return jsonResponse({ ...index, versions: [version, latest] });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchItemHistory('DestinyInventoryItemDefinition', 123);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      '/api/history/bucket/DestinyInventoryItemDefinition/3b?v=9&format=json',
    );
  });

  it('returns an unavailable result for HTTP 404 and network errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const missing = await fetchItemHistory('DestinyInventoryItemDefinition', 123);
    clearHistoryCache();
    const offline = await fetchItemHistory('DestinyInventoryItemDefinition', 123);

    expect(missing).toMatchObject({ available: false, versions: [], revisions: [] });
    expect(offline).toMatchObject({ available: false, versions: [], revisions: [] });
    expect(missing.error).toContain('404');
    expect(offline.error).toBe('offline');
  });

  it('returns unavailable if an item bucket is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(index))
      .mockResolvedValueOnce(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchItemHistory('DestinyInventoryItemDefinition', 123);

    expect(result.available).toBe(false);
    expect(result.revisions).toEqual([]);
    expect(result.error).toContain('404');
  });
});

describe('history release API', () => {
  beforeEach(() => {
    clearHistoryCache();
    vi.unstubAllGlobals();
  });

  it('fetches and caches the versions index', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(index));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchHistoryVersionsIndex();
    const second = await fetchHistoryVersionsIndex();

    expect(first).toEqual(index);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches a release summary with the latest-version cache key', async () => {
    const release = {
      v: 4,
      date: version.date,
      version: version.version,
      totals: { a: 1, m: 2, r: 0, u: 0, c: 0 },
      tables: {
        DestinyInventoryItemDefinition: {
          a: [[123, 'Test Item', 'Legendary Weapon', '/icons/test.png', 5]],
        },
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(release));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchManifestRelease(4, 9);
    const second = await fetchManifestRelease(4, 9);

    expect(first).toEqual(release);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/history/release/4?v=9',
    );
  });
});
