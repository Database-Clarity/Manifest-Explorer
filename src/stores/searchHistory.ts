import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const SEARCH_HISTORY_STORAGE_KEY = 'clarity-manifest-search-history';
export const MAX_RECENT_SEARCHES = 50;
export const MAX_SAVED_SEARCHES = 200;
export const MAX_QUERY_LENGTH = 2048;
export const MAX_NAME_LENGTH = 80;

export interface SearchScope {
  /** Explorer table filter active when the search ran; 'all' when the query owns table: */
  table: string;
  deepSearch: boolean;
}

export type SearchRecordSource = 'enter' | 'result' | 'blur' | 'idle' | 'menu';

export interface SearchHistoryEntry {
  id: string;
  query: string;
  key: string;
  name?: string;
  saved: boolean;
  createdAt: number;
  lastUsage: number;
  usageCount: number;
  scope: SearchScope;
  lastSource?: SearchRecordSource;
}

const SEARCH_RECORD_SOURCES: ReadonlySet<SearchRecordSource> = new Set([
  'enter',
  'result',
  'blur',
  'idle',
  'menu',
]);

const RECORD_DEDUPE_WINDOW_MS = 2000;
const IDLE_COALESCE_WINDOW_MS = 15000;

const SMART_SINGLE_QUOTES = /[\u2018\u2019]/g;
const SMART_DOUBLE_QUOTES = /[\u201C\u201D]/g;
const INCOMPLETE_TAIL = /[:(-]$/;
const INCOMPLETE_OPERATOR = /\b(?:or|and|not)$/i;
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Stable identity for a query: trimmed, whitespace-collapsed, straight quotes, lowercase. */
export function normalizeSearchKey(query: string): string {
  return query
    .replace(SMART_SINGLE_QUOTES, "'")
    .replace(SMART_DOUBLE_QUOTES, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasBalancedSyntax(query: string): boolean {
  let inQuote = false;
  let parenDepth = 0;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];

    if (character === '\\') {
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuote = !inQuote;
      continue;
    }

    if (inQuote) {
      continue;
    }

    if (character === '(') {
      parenDepth += 1;
    } else if (character === ')') {
      parenDepth -= 1;
      if (parenDepth < 0) {
        return false;
      }
    }
  }

  return !inQuote && parenDepth === 0;
}

/**
 * A search is worth remembering only when it is a deliberate, complete query:
 * long enough, balanced, not ending mid-token, and not just punctuation/operators.
 */
export function isRecordableSearch(query: string): boolean {
  const trimmed = query.trim();

  if (trimmed.length < 2 || trimmed.length > MAX_QUERY_LENGTH) {
    return false;
  }
  if (!HAS_WORD_CHARACTER.test(trimmed)) {
    return false;
  }
  if (!hasBalancedSyntax(trimmed)) {
    return false;
  }
  if (INCOMPLETE_TAIL.test(trimmed)) {
    return false;
  }
  if (INCOMPLETE_OPERATOR.test(trimmed)) {
    return false;
  }

  return true;
}

function isPinnedEntry(entry: SearchHistoryEntry): boolean {
  return entry.saved || Boolean(entry.name?.trim());
}

function byLastUsageDesc(a: SearchHistoryEntry, b: SearchHistoryEntry): number {
  return b.lastUsage - a.lastUsage;
}

/**
 * Saved/named entries survive recent-search churn. Only the overflow beyond
 * MAX_SAVED_SEARCHES (oldest lastUsage first) is trimmed.
 */
function pruneEntries(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
  const pinned = entries
    .filter(isPinnedEntry)
    .sort(byLastUsageDesc)
    .slice(0, MAX_SAVED_SEARCHES);
  const recent = entries
    .filter((entry) => !isPinnedEntry(entry))
    .sort(byLastUsageDesc)
    .slice(0, MAX_RECENT_SEARCHES);

  return [...pinned, ...recent].sort(byLastUsageDesc);
}

function makeId(now: number): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp/random id used in older or restricted contexts.
  }
  return `search-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function copyScope(scope: SearchScope): SearchScope {
  return { table: scope.table, deepSearch: scope.deepSearch };
}

function safeLocalStorage(): Storage | undefined {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage;
    }
  } catch {
    // Some test/browser-privacy contexts expose a throwing localStorage getter.
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Fall through to the no-op storage below.
  }
  return undefined;
}

/**
 * Resolves storage lazily on every operation. This keeps SSR/test contexts safe
 * while still picking up a localStorage that becomes available after module
 * evaluation (for example after a privacy prompt or a test polyfill).
 */
function createSafeStorage(): Storage {
  const resolve = (): Storage | undefined => safeLocalStorage();

  return {
    get length() {
      return resolve()?.length ?? 0;
    },
    clear() {
      resolve()?.clear();
    },
    getItem(key) {
      return resolve()?.getItem(key) ?? null;
    },
    key(index) {
      return resolve()?.key(index) ?? null;
    },
    removeItem(key) {
      resolve()?.removeItem(key);
    },
    setItem(key, value) {
      resolve()?.setItem(key, value);
    },
  };
}

const searchHistoryStorage = createJSONStorage<Pick<SearchHistoryState, 'entries'>>(() =>
  createSafeStorage(),
);

function sanitizeScope(value: unknown): SearchScope {
  if (typeof value !== 'object' || value === null) {
    return { table: 'all', deepSearch: false };
  }
  const candidate = value as Record<string, unknown>;
  return {
    table:
      typeof candidate.table === 'string' && candidate.table.trim().length > 0
        ? candidate.table.trim()
        : 'all',
    deepSearch: candidate.deepSearch === true,
  };
}

function isRecordSource(value: unknown): value is SearchRecordSource {
  return typeof value === 'string' && SEARCH_RECORD_SOURCES.has(value as SearchRecordSource);
}

function sanitizeEntry(candidate: unknown, fallbackNow: number): SearchHistoryEntry | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const raw = candidate as Record<string, unknown>;
  if (typeof raw.query !== 'string') {
    return null;
  }

  const query = raw.query.trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length === 0) {
    return null;
  }

  const fallbackTimestamp =
    typeof raw.lastUsage === 'number' && Number.isFinite(raw.lastUsage) && raw.lastUsage >= 0
      ? raw.lastUsage
      : fallbackNow;
  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt >= 0
      ? raw.createdAt
      : fallbackTimestamp;
  const lastUsage =
    typeof raw.lastUsage === 'number' && Number.isFinite(raw.lastUsage) && raw.lastUsage >= 0
      ? raw.lastUsage
      : createdAt;
  const usageCount =
    typeof raw.usageCount === 'number' &&
    Number.isFinite(raw.usageCount) &&
    raw.usageCount > 0
      ? Math.floor(raw.usageCount)
      : 1;
  const name =
    typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  const lastSource = isRecordSource(raw.lastSource) ? raw.lastSource : undefined;

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : makeId(lastUsage),
    query,
    key: normalizeSearchKey(query),
    ...(name.length > 0 ? { name } : {}),
    saved: raw.saved === true,
    createdAt,
    lastUsage,
    usageCount,
    scope: sanitizeScope(raw.scope),
    ...(lastSource ? { lastSource } : {}),
  };
}

function mergeDuplicateEntries(
  existing: SearchHistoryEntry,
  duplicate: SearchHistoryEntry,
): SearchHistoryEntry {
  const newer = duplicate.lastUsage > existing.lastUsage ? duplicate : existing;
  const older = newer === existing ? duplicate : existing;
  const name = newer.name ?? older.name;

  return {
    ...newer,
    ...(name ? { name } : {}),
    saved: existing.saved || duplicate.saved,
    createdAt: Math.min(existing.createdAt, duplicate.createdAt),
    lastUsage: Math.max(existing.lastUsage, duplicate.lastUsage),
    usageCount: Math.max(existing.usageCount, duplicate.usageCount),
  };
}

/** Repairs corrupt payloads: drops malformed rows, recomputes keys, dedupes, and caps. */
export function sanitizeEntries(value: unknown): SearchHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const now = Date.now();
  const byKey = new Map<string, SearchHistoryEntry>();

  for (const candidate of value) {
    const entry = sanitizeEntry(candidate, now);
    if (!entry) continue;

    const existing = byKey.get(entry.key);
    byKey.set(entry.key, existing ? mergeDuplicateEntries(existing, entry) : entry);
  }

  const entries = [...byKey.values()];
  const usedIds = new Set<string>();
  for (const entry of entries) {
    if (usedIds.has(entry.id)) {
      let id = makeId(entry.lastUsage);
      while (usedIds.has(id)) {
        id = makeId(entry.lastUsage);
      }
      entry.id = id;
    }
    usedIds.add(entry.id);
  }

  return pruneEntries(entries);
}

export interface SearchHistoryState {
  entries: SearchHistoryEntry[];
  recordSearch: (
    query: string,
    scope: SearchScope,
    source: SearchRecordSource,
    now?: number,
  ) => void;
  saveQuery: (query: string, scope: SearchScope, now?: number) => void;
  unsaveByQuery: (query: string) => void;
  toggleSaveQuery: (query: string, scope: SearchScope, now?: number) => boolean;
  toggleSaved: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  clearRecent: () => void;
  clearAll: () => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>()(
  persist(
    (set, get) => ({
      entries: [],

      recordSearch: (query, scope, source, now = Date.now()) =>
        set((state) => {
          if (!isRecordableSearch(query)) {
            return {};
          }

          const displayQuery = query.trim();
          const key = normalizeSearchKey(displayQuery);
          if (key.length === 0) {
            return {};
          }

          const entries = [...state.entries];
          const existingIndex = entries.findIndex((entry) => entry.key === key);

          if (existingIndex >= 0) {
            const existing = entries[existingIndex];
            if (!existing) {
              return {};
            }
            // Enter + result click + idle all describe one commit. Within the
            // window they must not inflate the usage count or reorder the list.
            if (now - existing.lastUsage < RECORD_DEDUPE_WINDOW_MS) {
              return {};
            }
            entries[existingIndex] = {
              ...existing,
              query: displayQuery,
              scope: copyScope(scope),
              lastUsage: now,
              usageCount: existing.usageCount + 1,
              lastSource: source,
            };
            return { entries: pruneEntries(entries) };
          }

          // Idle recording fires while the user is still typing. If the previous
          // idle snapshot is a prefix of this query, grow it in place instead of
          // leaving a trail of partial searches behind.
          if (source === 'idle') {
            const mostRecent = entries.reduce<SearchHistoryEntry | undefined>(
              (latest, entry) =>
                latest === undefined || entry.lastUsage > latest.lastUsage ? entry : latest,
              undefined,
            );
            const idleAge = mostRecent ? now - mostRecent.lastUsage : Number.POSITIVE_INFINITY;

            if (
              mostRecent &&
              !mostRecent.saved &&
              !mostRecent.name &&
              mostRecent.lastSource === 'idle' &&
              mostRecent.usageCount === 1 &&
              idleAge >= 0 &&
              idleAge < IDLE_COALESCE_WINDOW_MS &&
              key.startsWith(mostRecent.key)
            ) {
              const index = entries.indexOf(mostRecent);
              if (index >= 0) {
                entries[index] = {
                  ...mostRecent,
                  query: displayQuery,
                  key,
                  scope: copyScope(scope),
                  lastUsage: now,
                };
                return { entries: pruneEntries(entries) };
              }
            }
          }

          entries.push({
            id: makeId(now),
            query: displayQuery,
            key,
            saved: false,
            createdAt: now,
            lastUsage: now,
            usageCount: 1,
            scope: copyScope(scope),
            lastSource: source,
          });
          return { entries: pruneEntries(entries) };
        }),

      saveQuery: (query, scope, now = Date.now()) =>
        set((state) => {
          const displayQuery = query.trim().slice(0, MAX_QUERY_LENGTH);
          if (displayQuery.length === 0) {
            return {};
          }

          const key = normalizeSearchKey(displayQuery);
          if (key.length === 0) {
            return {};
          }

          const entries = [...state.entries];
          const existingIndex = entries.findIndex((entry) => entry.key === key);

          if (existingIndex >= 0) {
            const existing = entries[existingIndex];
            if (!existing) {
              return {};
            }
            entries[existingIndex] = {
              ...existing,
              query: displayQuery,
              scope: copyScope(scope),
              saved: true,
              lastUsage: Math.max(existing.lastUsage, now),
            };
          } else {
            entries.push({
              id: makeId(now),
              query: displayQuery,
              key,
              saved: true,
              createdAt: now,
              lastUsage: now,
              usageCount: 1,
              scope: copyScope(scope),
            });
          }

          return { entries: pruneEntries(entries) };
        }),

      unsaveByQuery: (query) =>
        set((state) => {
          const key = normalizeSearchKey(query);
          if (!state.entries.some((entry) => entry.key === key && entry.saved)) {
            return {};
          }
          return {
            entries: pruneEntries(
              state.entries.map((entry) =>
                entry.key === key ? { ...entry, saved: false } : entry,
              ),
            ),
          };
        }),

      toggleSaveQuery: (query, scope, now = Date.now()) => {
        const displayQuery = query.trim();
        if (displayQuery.length === 0) {
          return false;
        }

        const key = normalizeSearchKey(displayQuery);
        const existing = get().entries.find((entry) => entry.key === key);

        if (existing?.saved) {
          set((state) => ({
            entries: pruneEntries(
              state.entries.map((entry) =>
                entry.id === existing.id ? { ...entry, saved: false } : entry,
              ),
            ),
          }));
          return false;
        }

        get().saveQuery(displayQuery, scope, now);
        return true;
      },

      toggleSaved: (id) =>
        set((state) => {
          if (!state.entries.some((entry) => entry.id === id)) {
            return {};
          }
          return {
            entries: pruneEntries(
              state.entries.map((entry) =>
                entry.id === id ? { ...entry, saved: !entry.saved } : entry,
              ),
            ),
          };
        }),

      rename: (id, name) =>
        set((state) => {
          const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
          return {
            entries: pruneEntries(
              state.entries.map((entry) => {
                if (entry.id !== id) {
                  return entry;
                }
                if (trimmed.length > 0) {
                  // A named search is automatically pinned; the star toggle
                  // remains the explicit way to unstar it later.
                  return { ...entry, name: trimmed, saved: true };
                }
                const next = { ...entry };
                delete next.name;
                return next;
              }),
            ),
          };
        }),

      remove: (id) =>
        set((state) => ({
          entries: state.entries.filter((entry) => entry.id !== id),
        })),

      clearRecent: () =>
        set((state) => ({
          entries: state.entries.filter((entry) => entry.saved),
        })),

      clearAll: () => set({ entries: [] }),
    }),
    {
      name: SEARCH_HISTORY_STORAGE_KEY,
      version: 1,
      storage: searchHistoryStorage,
      partialize: (state) => ({ entries: state.entries }),
      merge: (persisted, current) => {
        const value =
          typeof persisted === 'object' && persisted !== null
            ? (persisted as Record<string, unknown>)
            : {};
        return {
          ...current,
          entries: sanitizeEntries(value.entries),
        };
      },
    },
  ),
);
