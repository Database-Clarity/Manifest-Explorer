/**
 * Zero-dependency Promise-based IndexedDB wrapper for the manifest cache.
 *
 * Every public function degrades gracefully: if IndexedDB is unavailable,
 * blocked (private browsing), or a request fails (quota exceeded), the
 * operation resolves to a safe fallback and never throws.
 */

import type { SearchIndexEntry } from '../types/manifest';

const DB_NAME = 'clarity-manifest-v1';
const DB_VERSION = 1;

const STORE_META = 'meta';
const STORE_SEARCH_INDEX = 'searchIndex';
const STORE_TABLES = 'tables';
const STORE_FULL_ITEMS = 'fullItems';

export interface ManifestMeta {
  version: string;
  versionSignature: string;
  componentPaths: Record<string, string>;
  fetchedAt: number;
}

export interface SearchIndexCache {
  entries: SearchIndexEntry[];
  indexedTables: string[];
  /**
   * Bump whenever the shape/meaning of a SearchIndexEntry changes so that
   * caches written by an older build are treated as stale and rebuilt instead
   * of being served with missing fields (e.g. `isEnhanced`).
   */
  schemaVersion?: number;
}

/**
 * Current search index schema version. Older caches (or caches without this
 * field) are discarded and rebuilt cleanly.
 */
export const SEARCH_INDEX_SCHEMA_VERSION = 4;

export interface CacheStats {
  available: boolean;
  tableCount: number;
  fullItemBucketCount: number;
  searchIndexCount: number;
  metaCount: number;
}

let dbPromise: Promise<IDBDatabase | null> | undefined;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
        if (!db.objectStoreNames.contains(STORE_SEARCH_INDEX))
          db.createObjectStore(STORE_SEARCH_INDEX);
        if (!db.objectStoreNames.contains(STORE_TABLES)) db.createObjectStore(STORE_TABLES);
        if (!db.objectStoreNames.contains(STORE_FULL_ITEMS))
          db.createObjectStore(STORE_FULL_ITEMS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function getMeta(locale: string): Promise<ManifestMeta | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    const tx = db.transaction(STORE_META, 'readonly');
    const result = await requestResult<unknown>(tx.objectStore(STORE_META).get(`manifest:${locale}`));
    return result as ManifestMeta | undefined;
  } catch {
    return undefined;
  }
}

export async function putMeta(locale: string, meta: ManifestMeta): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(meta, `manifest:${locale}`);
    await txComplete(tx);
  } catch {
    // Degrade silently.
  }
}

export async function getSearchIndex(
  locale: string,
  versionSignature: string,
): Promise<SearchIndexCache | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    const tx = db.transaction(STORE_SEARCH_INDEX, 'readonly');
    const result = await requestResult<unknown>(
      tx.objectStore(STORE_SEARCH_INDEX).get(`${locale}:${versionSignature}`),
    );
    return result as SearchIndexCache | undefined;
  } catch {
    return undefined;
  }
}

export async function putSearchIndex(
  locale: string,
  versionSignature: string,
  cache: SearchIndexCache,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_SEARCH_INDEX, 'readwrite');
    tx.objectStore(STORE_SEARCH_INDEX).put(cache, `${locale}:${versionSignature}`);
    await txComplete(tx);
  } catch {
    // Degrade silently.
  }
}

export async function getTableData(
  locale: string,
  versionSignature: string,
  table: string,
): Promise<Record<string, Record<string, unknown>> | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    const tx = db.transaction(STORE_TABLES, 'readonly');
    const result = await requestResult<unknown>(
      tx.objectStore(STORE_TABLES).get(`${locale}:${versionSignature}:${table}`),
    );
    return result as Record<string, Record<string, unknown>> | undefined;
  } catch {
    return undefined;
  }
}

export async function putTableData(
  locale: string,
  versionSignature: string,
  table: string,
  data: Record<string, Record<string, unknown>>,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_TABLES, 'readwrite');
    tx.objectStore(STORE_TABLES).put(data, `${locale}:${versionSignature}:${table}`);
    await txComplete(tx);
  } catch {
    // Degrade silently.
  }
}

/**
 * Write a batch of full-item raw JSON entries directly (keyed per hash) in a
 * single synchronous readwrite transaction. O(N) total I/O, zero read-modify-write,
 * and sub-millisecond single-item lookups.
 */
export async function putFullItemEntries(
  locale: string,
  versionSignature: string,
  entries: ReadonlyArray<readonly [number, string]>,
): Promise<void> {
  const db = await openDb();
  if (!db || entries.length === 0) return;
  try {
    const tx = db.transaction(STORE_FULL_ITEMS, 'readwrite');
    const store = tx.objectStore(STORE_FULL_ITEMS);
    const prefix = `${locale}:${versionSignature}:item:`;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      store.put(entry[1], `${prefix}${entry[0]}`);
    }
    await txComplete(tx);
  } catch {
    // Degrade silently.
  }
}

export async function getFullItemRaw(
  locale: string,
  versionSignature: string,
  hash: number,
): Promise<string | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    const tx = db.transaction(STORE_FULL_ITEMS, 'readonly');
    const store = tx.objectStore(STORE_FULL_ITEMS);
    return await requestResult<string | undefined>(
      store.get(`${locale}:${versionSignature}:item:${hash}`),
    );
  } catch {
    return undefined;
  }
}

export async function iterateFullItems(
  locale: string,
  versionSignature: string,
  onItem: (hash: number, rawJson: string) => void,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const prefix = `${locale}:${versionSignature}:item:`;
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const tx = db.transaction(STORE_FULL_ITEMS, 'readonly');
    const store = tx.objectStore(STORE_FULL_ITEMS);
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const keyStr = String(cursor.key);
        const hash = Number(keyStr.slice(prefix.length));
        if (Number.isFinite(hash) && typeof cursor.value === 'string') {
          onItem(hash, cursor.value);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error ?? new Error('Cursor failed'));
    });
  } catch {
    // Degrade silently.
  }
}

export async function hasFullItemsCached(
  locale: string,
  versionSignature: string,
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const prefix = `${locale}:${versionSignature}:item:`;
    const tx = db.transaction(STORE_FULL_ITEMS, 'readonly');
    const store = tx.objectStore(STORE_FULL_ITEMS);
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const count = await requestResult<number>(store.count(range));
    return count > 0;
  } catch {
    return false;
  }
}

export async function purgeOldVersions(
  locale: string,
  keepVersionSignature: string,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const shouldDelete = (key: string): boolean => {
    const prefix = `${locale}:`;
    if (!key.startsWith(prefix)) return false;
    return !key.startsWith(`${locale}:${keepVersionSignature}`);
  };
  try {
    for (const storeName of [STORE_SEARCH_INDEX, STORE_TABLES, STORE_FULL_ITEMS]) {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const keys = await requestResult<IDBValidKey[]>(store.getAllKeys());
      const toDelete = keys.filter((key) => shouldDelete(String(key)));
      for (const key of toDelete) store.delete(key);
      await txComplete(tx);
    }
  } catch {
    // Degrade silently.
  }
}

export async function clearAllCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    for (const storeName of [STORE_META, STORE_SEARCH_INDEX, STORE_TABLES, STORE_FULL_ITEMS]) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      await txComplete(tx);
    }
  } catch {
    // Degrade silently.
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  const db = await openDb();
  if (!db) {
    return {
      available: false,
      tableCount: 0,
      fullItemBucketCount: 0,
      searchIndexCount: 0,
      metaCount: 0,
    };
  }
  const countKeys = async (storeName: string): Promise<number> => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      return await requestResult<number>(tx.objectStore(storeName).count());
    } catch {
      return 0;
    }
  };
  const [tableCount, fullItemBucketCount, searchIndexCount, metaCount] = await Promise.all([
    countKeys(STORE_TABLES),
    countKeys(STORE_FULL_ITEMS),
    countKeys(STORE_SEARCH_INDEX),
    countKeys(STORE_META),
  ]);
  return { available: true, tableCount, fullItemBucketCount, searchIndexCount, metaCount };
}
