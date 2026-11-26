/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_NAME_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RECENT_SEARCHES,
  MAX_SAVED_SEARCHES,
  SEARCH_HISTORY_STORAGE_KEY,
  isRecordableSearch,
  normalizeSearchKey,
  sanitizeEntries,
  useSearchHistoryStore,
  type SearchHistoryEntry,
  type SearchScope,
} from '../searchHistory';

const ALL_TABLES: SearchScope = { table: 'all', deepSearch: false };

/**
 * Node 26 exposes an experimental `localStorage` accessor that shields jsdom's
 * storage from Vitest's global bridge. Install a real in-memory Storage before
 * the persistence tests exercise rehydration.
 */
function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: createMemoryStorage(),
  writable: true,
});
const ITEM_SCOPE: SearchScope = {
  table: 'DestinyInventoryItemDefinition',
  deepSearch: true,
};

function entries(): SearchHistoryEntry[] {
  return useSearchHistoryStore.getState().entries;
}

function byKey(key: string): SearchHistoryEntry | undefined {
  return entries().find((entry) => entry.key === key);
}

function resetStore(): void {
  useSearchHistoryStore.setState({ entries: [] });
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  }
}

beforeEach(resetStore);

describe('search history helpers', () => {
  it('normalizes whitespace, smart quotes, and casing for keys only', () => {
    expect(normalizeSearchKey('  “Hand   Cannon”  ')).toBe('"hand cannon"');
    expect(normalizeSearchKey('Spider’s  Vow')).toBe("spider's vow");
    expect(normalizeSearchKey('TIER:EXOTIC')).toBe('tier:exotic');
  });

  it('records only deliberate, complete searches', () => {
    expect(isRecordableSearch('ab')).toBe(true);
    expect(isRecordableSearch('"foo bar"')).toBe(true);
    expect(isRecordableSearch('(foo or bar)')).toBe(true);
    expect(isRecordableSearch('sand')).toBe(true);

    expect(isRecordableSearch(' a ')).toBe(false);
    expect(isRecordableSearch('x'.repeat(MAX_QUERY_LENGTH + 1))).toBe(false);
    expect(isRecordableSearch('"foo')).toBe(false);
    expect(isRecordableSearch('foo (bar')).toBe(false);
    expect(isRecordableSearch('foo)')).toBe(false);
    expect(isRecordableSearch('foo:')).toBe(false);
    expect(isRecordableSearch('foo(')).toBe(false);
    expect(isRecordableSearch('foo-')).toBe(false);
    expect(isRecordableSearch('foo and')).toBe(false);
    expect(isRecordableSearch('foo-or')).toBe(false);
    expect(isRecordableSearch('foo not')).toBe(false);
    expect(isRecordableSearch(':::')).toBe(false);
    expect(isRecordableSearch('()')).toBe(false);
    expect(isRecordableSearch('   ')).toBe(false);
  });
});

describe('Search history store', () => {
  it('records the display query with its scope while keying case-insensitively', () => {
    useSearchHistoryStore
      .getState()
      .recordSearch('  Hand   Cannon  ', ITEM_SCOPE, 'enter', 1000);

    const entry = byKey('hand cannon');
    expect(entry).toMatchObject({
      query: 'Hand   Cannon',
      key: 'hand cannon',
      saved: false,
      createdAt: 1000,
      lastUsage: 1000,
      usageCount: 1,
      scope: ITEM_SCOPE,
      lastSource: 'enter',
    });
    expect(entry?.id).toBeTruthy();
    expect(entry?.name).toBeUndefined();
  });

  it('dedupes one commit across Enter/result/idle within the 2s window', () => {
    const state = useSearchHistoryStore.getState();
    state.recordSearch('hand cannon', ALL_TABLES, 'enter', 1000);

    const id = byKey('hand cannon')?.id;

    useSearchHistoryStore
      .getState()
      .recordSearch('Hand Cannon', ITEM_SCOPE, 'result', 2500);
    expect(entries()).toHaveLength(1);
    expect(byKey('hand cannon')).toMatchObject({
      id,
      query: 'hand cannon',
      lastUsage: 1000,
      usageCount: 1,
      lastSource: 'enter',
    });

    useSearchHistoryStore
      .getState()
      .recordSearch('HAND CANNON', ITEM_SCOPE, 'menu', 3500);
    expect(entries()).toHaveLength(1);
    expect(byKey('hand cannon')).toMatchObject({
      id,
      query: 'HAND CANNON',
      lastUsage: 3500,
      usageCount: 2,
      scope: ITEM_SCOPE,
      lastSource: 'menu',
    });
  });

  it('coalesces idle prefix snapshots in place instead of leaving partial searches', () => {
    const state = useSearchHistoryStore.getState();
    state.recordSearch('hand', ALL_TABLES, 'idle', 1000);
    const id = byKey('hand')?.id;

    useSearchHistoryStore
      .getState()
      .recordSearch('hand cannon', ITEM_SCOPE, 'idle', 4000);
    expect(entries()).toHaveLength(1);
    expect(byKey('hand cannon')).toMatchObject({
      id,
      query: 'hand cannon',
      key: 'hand cannon',
      createdAt: 1000,
      lastUsage: 4000,
      usageCount: 1,
      lastSource: 'idle',
      scope: ITEM_SCOPE,
    });
    expect(byKey('hand')).toBeUndefined();

    // Outside the 15s idle window a new partial commit stands on its own.
    useSearchHistoryStore
      .getState()
      .recordSearch('hand cannon roll', ALL_TABLES, 'idle', 20000);
    expect(entries()).toHaveLength(2);
    expect(byKey('hand cannon roll')).toBeDefined();
  });

  it('does not coalesce idle snapshots into a saved or non-prefix entry', () => {
    const state = useSearchHistoryStore.getState();
    state.saveQuery('hand', ALL_TABLES, 1000);

    useSearchHistoryStore
      .getState()
      .recordSearch('hand cannon', ALL_TABLES, 'idle', 4000);
    expect(entries()).toHaveLength(2);
    expect(byKey('hand')?.saved).toBe(true);
    expect(byKey('hand cannon')).toBeDefined();

    useSearchHistoryStore
      .getState()
      .recordSearch('bar', ALL_TABLES, 'idle', 5000);
    expect(entries()).toHaveLength(3);
  });

  it('caps recent entries while keeping saved and named searches forever', () => {
    const state = useSearchHistoryStore.getState();
    state.saveQuery('saved search', ALL_TABLES, 0);
    state.recordSearch('named search', ALL_TABLES, 'enter', 1);
    const named = byKey('named search');
    expect(named).toBeDefined();
    useSearchHistoryStore.getState().rename(named!.id, 'My named search');

    for (let index = 0; index < MAX_RECENT_SEARCHES + 5; index += 1) {
      useSearchHistoryStore
        .getState()
        .recordSearch(`query ${index}`, ALL_TABLES, 'enter', 1000 + index);
    }

    expect(entries().some((entry) => entry.key === 'saved search')).toBe(true);
    expect(entries().some((entry) => entry.key === 'named search')).toBe(true);
    expect(
      entries().filter((entry) => !entry.saved && !entry.name),
    ).toHaveLength(MAX_RECENT_SEARCHES);
  });

  it('caps named/saved entries at MAX_SAVED_SEARCHES by last usage', () => {
    for (let index = 0; index < MAX_SAVED_SEARCHES + 5; index += 1) {
      useSearchHistoryStore
        .getState()
        .saveQuery(`saved ${index}`, ALL_TABLES, 1000 + index);
    }

    const saved = entries().filter((entry) => entry.saved);
    expect(saved).toHaveLength(MAX_SAVED_SEARCHES);
    expect(entries().some((entry) => entry.key === 'saved 0')).toBe(false);
    expect(
      entries().some((entry) => entry.key === `saved ${MAX_SAVED_SEARCHES + 4}`),
    ).toBe(true);
  });

  it('saves without inflating usage counts and ignores empty queries', () => {
    const state = useSearchHistoryStore.getState();
    state.recordSearch('hand cannon', ALL_TABLES, 'enter', 1000);
    useSearchHistoryStore.getState().saveQuery('Hand Cannon', ITEM_SCOPE, 1500);

    expect(byKey('hand cannon')).toMatchObject({
      query: 'Hand Cannon',
      saved: true,
      usageCount: 1,
      lastUsage: 1500,
      scope: ITEM_SCOPE,
    });

    useSearchHistoryStore.getState().saveQuery('new saved query', ALL_TABLES, 2000);
    expect(byKey('new saved query')).toMatchObject({
      saved: true,
      usageCount: 1,
      createdAt: 2000,
      lastUsage: 2000,
    });

    useSearchHistoryStore.getState().saveQuery('    ', ALL_TABLES, 3000);
    expect(entries()).toHaveLength(2);
  });

  it('renames with a trim + cap, auto-pins named entries, and can clear the name', () => {
    const state = useSearchHistoryStore.getState();
    state.recordSearch('hand cannon', ALL_TABLES, 'enter', 1000);
    const entry = byKey('hand cannon');
    expect(entry).toBeDefined();

    useSearchHistoryStore.getState().rename(entry!.id, '   PvP   ');
    expect(byKey('hand cannon')).toMatchObject({
      name: 'PvP',
      saved: true,
    });

    const longName = 'x'.repeat(MAX_NAME_LENGTH + 20);
    useSearchHistoryStore.getState().rename(entry!.id, longName);
    expect(byKey('hand cannon')?.name).toHaveLength(MAX_NAME_LENGTH);

    useSearchHistoryStore.getState().rename(entry!.id, '   ');
    const cleared = byKey('hand cannon');
    expect(cleared?.name).toBeUndefined();
    expect(cleared?.saved).toBe(true);
  });

  it('toggles saves by query and by id without losing a name', () => {
    const state = useSearchHistoryStore.getState();
    expect(state.toggleSaveQuery('hand cannon', ALL_TABLES, 1000)).toBe(true);
    expect(byKey('hand cannon')).toMatchObject({
      saved: true,
      usageCount: 1,
    });

    expect(
      useSearchHistoryStore
        .getState()
        .toggleSaveQuery('HAND CANNON', ALL_TABLES, 2000),
    ).toBe(false);
    expect(byKey('hand cannon')?.saved).toBe(false);

    useSearchHistoryStore.getState().rename(byKey('hand cannon')!.id, 'My cannon');
    useSearchHistoryStore.getState().unsaveByQuery('hand cannon');
    expect(byKey('hand cannon')).toMatchObject({
      saved: false,
      name: 'My cannon',
    });

    const id = byKey('hand cannon')!.id;
    useSearchHistoryStore.getState().toggleSaved(id);
    expect(byKey('hand cannon')?.saved).toBe(true);

    expect(useSearchHistoryStore.getState().toggleSaveQuery('   ', ALL_TABLES)).toBe(
      false,
    );
  });

  it('clears recent searches without touching saved ones, and clearAll empties', () => {
    const state = useSearchHistoryStore.getState();
    state.recordSearch('recent one', ALL_TABLES, 'enter', 1000);
    state.recordSearch('recent two', ALL_TABLES, 'result', 4000);
    state.saveQuery('saved one', ALL_TABLES, 5000);

    useSearchHistoryStore.getState().clearRecent();
    expect(entries().map((entry) => entry.key)).toEqual(['saved one']);

    useSearchHistoryStore.getState().recordSearch('recent again', ALL_TABLES, 'enter', 8000);
    expect(entries()).toHaveLength(2);
    useSearchHistoryStore.getState().clearAll();
    expect(entries()).toEqual([]);
  });

  it('removes individual entries by id', () => {
    useSearchHistoryStore.getState().saveQuery('first', ALL_TABLES, 1000);
    useSearchHistoryStore.getState().saveQuery('second', ALL_TABLES, 2000);
    const first = byKey('first');
    expect(first).toBeDefined();

    useSearchHistoryStore.getState().remove(first!.id);
    expect(entries().map((entry) => entry.key)).toEqual(['second']);
  });
});

describe('Search history persistence', () => {
  it('sanitizes corrupt payloads, recomputes keys, dedupes, and drops garbage', () => {
    const sanitized = sanitizeEntries([
      null,
      42,
      'nope',
      { query: 123 },
      { query: '   ' },
      {
        id: 'one',
        query: '  Hand   Cannon ',
        name: '   ',
        saved: 'yes',
        createdAt: 100,
        lastUsage: 200,
        usageCount: -2,
        scope: null,
        lastSource: 'bogus',
      },
      {
        id: 'duplicate',
        query: 'hand cannon',
        saved: true,
        createdAt: 50,
        lastUsage: 300,
        usageCount: 4,
        scope: { table: 'DestinyInventoryItemDefinition', deepSearch: true },
      },
      {
        id: 'two',
        query: 'recent query',
        saved: false,
        createdAt: 10,
        lastUsage: 10,
        usageCount: 1,
        scope: { table: 'all', deepSearch: false },
      },
      {
        id: 'duplicate',
        query: 'third query',
        saved: false,
        createdAt: 5,
        lastUsage: 5,
        usageCount: 1,
        scope: { table: 'all', deepSearch: false },
      },
    ]);

    expect(sanitized).toHaveLength(3);
    expect(new Set(sanitized.map((entry) => entry.id)).size).toBe(3);
    const cannon = sanitized.find((entry) => entry.key === 'hand cannon');
    expect(cannon).toMatchObject({
      query: 'hand cannon',
      saved: true,
      createdAt: 50,
      lastUsage: 300,
      usageCount: 4,
      scope: { table: 'DestinyInventoryItemDefinition', deepSearch: true },
    });
    expect(cannon?.name).toBeUndefined();
    expect(cannon?.lastSource).toBeUndefined();

    const recent = sanitized.find((entry) => entry.key === 'recent query');
    expect(recent?.scope).toEqual({ table: 'all', deepSearch: false });
  });

  it('hydrates a valid payload through the store merge', async () => {
    window.localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          entries: [
            null,
            {
              id: 'persisted',
              query: 'Persisted Query',
              saved: true,
              createdAt: 10,
              lastUsage: 20,
              usageCount: 2,
              scope: { table: 'all', deepSearch: false },
            },
          ],
        },
      }),
    );

    await useSearchHistoryStore.persist.rehydrate();

    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      id: 'persisted',
      query: 'Persisted Query',
      key: 'persisted query',
      saved: true,
      usageCount: 2,
    });
  });

  it('survives malformed localStorage JSON without throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, '{not valid json');

    await expect(useSearchHistoryStore.persist.rehydrate()).resolves.toBeUndefined();
    expect(entries()).toEqual([]);

    consoleError.mockRestore();
  });
});
