import type {
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  ReverseReferenceResponse,
  VariantItem,
} from '../types/manifest';

export interface LruCache<V> {
  readonly size: number;
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): boolean;
  clear(): void;
}

export function createLruCache<V>(maxSize: number): LruCache<V> {
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new RangeError('LRU cache maxSize must be a positive integer.');
  }

  const entries = new Map<string, V>();

  return {
    get size() {
      return entries.size;
    },
    get(key) {
      if (!entries.has(key)) {
        return undefined;
      }
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value as V);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxSize) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        entries.delete(oldestKey);
      }
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}

export interface CachedReferences {
  data: ReverseReferenceResponse;
  loadedTableCount: number;
}

export const detailCache = createLruCache<DefinitionDetailPayload>(120);
export const variantsCache = createLruCache<VariantItem[]>(120);
export const referencesCache = createLruCache<CachedReferences>(80);
export const clarityCache = createLruCache<ClarityDescriptionEntry | null>(200);

export function cacheKey(table: string, hash: number): string {
  return `${table}:${hash}`;
}

export function clearInspectorCaches(): void {
  detailCache.clear();
  variantsCache.clear();
  referencesCache.clear();
  clarityCache.clear();
}

export function evictInspectorEntry(table: string, hash: number): void {
  const key = cacheKey(table, hash);
  detailCache.delete(key);
  variantsCache.delete(key);
  referencesCache.delete(key);
  clarityCache.delete(key);
}
