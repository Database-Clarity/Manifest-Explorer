import { create } from 'zustand';
import type {
  DefinitionRef,
  FilterCatalog,
  InspectorTab,
  ManifestStatus,
  ResolvedSummaryEntry,
  SearchFilters,
  SearchResultItem,
  TableStatus,
  UnnamedMode,
} from '../types/manifest';
import { hasPositiveTableScopeInQuery } from '../manifest/query';
import { ARTIFACT_PERKS_TABLE, TABLE_METADATA, getShortTableName } from '../manifest/tables';

export type NoticeTone = 'info' | 'warn' | 'danger';

export interface AppNotice {
  id: string;
  tone: NoticeTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export type NoticeInput = Omit<AppNotice, 'id'> & { id?: string };

/**
 * One point in a tab's back/forward history timeline, preserving both display
 * identity and view state (active sub-tab, scroll positions, JSON filter &
 * expanded nodes).
 */
export interface TabHistoryEntry {
  table: string;
  hash: number;
  /** Resolved human display name (overrides Table:Hash everywhere). */
  label?: string;
  icon?: string;
  /** True when the same unsigned hash appears in multiple manifest tables/categories. */
  hasCoTables?: boolean;
  activeTab: InspectorTab;
  scrollByTab: Partial<Record<InspectorTab, number>>;
  jsonFilter?: string;
  jsonExpanded?: Record<string, boolean>;
}

export interface InspectorSession {
  id: string;
  history: TabHistoryEntry[];
  historyIndex: number;
}

export interface ExplorerState {
  query: string;
  deepSearch: boolean;
  filters: SearchFilters;
  manifestStatus: ManifestStatus;
  tables: TableStatus[];
  filterCatalog: FilterCatalog;
  results: SearchResultItem[];
  totalMatches: number;
  searchDurationMs: number;
  scopeEntryCount: number;
  hiddenUnnamedCount: number;
  searching: boolean;
  selectedResultIndex: number;

  sessions: InspectorSession[];
  activeSessionIndex: number;
  /** Active tab's full history + future timeline. */
  history: TabHistoryEntry[];
  historyIndex: number;
  activeTab: InspectorTab;
  pinnedDiffRef: DefinitionRef | null;
  mobileInspectorOpen: boolean;
  inspectorMaximized: boolean;

  notices: AppNotice[];

  setQuery: (query: string) => void;
  setDeepSearch: (enabled: boolean) => void;
  toggleDeepSearch: () => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  resetFilters: () => void;
  setTableFilter: (table: string) => void;
  setSearchResults: (
    items: SearchResultItem[],
    totalMatches: number,
    durationMs: number,
    preserveCursor?: boolean,
    hiddenUnnamedCount?: number,
    scopeEntryCount?: number,
  ) => void;
  setSearching: (searching: boolean) => void;
  setManifestStatus: (status: Partial<ManifestStatus>) => void;
  setTables: (tables: TableStatus[]) => void;
  setFilterCatalog: (catalog: FilterCatalog) => void;
  setSelectedResultIndex: (index: number) => void;

  /**
   * Navigate in-place within the active tab: pushes a fresh entry onto this
   * tab's history (trimming any forward branch beyond historyIndex) and opens
   * the new entry on the Pretty tab. Preserves the prior entry's saved state.
   */
  navigateInTab: (ref: DefinitionRef, jsonFilter?: string) => void;
  /**
   * Always open in a new tab (or focus an existing tab already showing that
   * exact definition) on the Pretty tab.
   */
  openInNewTab: (ref: DefinitionRef, focus?: boolean, jsonFilter?: string) => void;
  switchSession: (index: number) => void;
  closeSession: (index: number) => void;
  closeOtherSessions: (index: number) => void;
  toggleInspectorMaximized: () => void;

  /** Step backward / forward / jump directly inside the active tab's history+future timeline without discarding future entries. */
  navigateBack: () => boolean;
  navigateForward: () => boolean;
  jumpToHistoryIndex: (index: number) => boolean;
  restoreHistoryPoint: (sessionId: string, targetHistoryIndex: number) => boolean;

  /** Persist per-entry view state & resolved display metadata. */
  setActiveTab: (tab: InspectorTab) => void;
  getEntryScroll: (tab: InspectorTab) => number;
  saveEntryScroll: (tab: InspectorTab, scrollTop: number) => void;
  saveEntryJsonState: (patch: {
    jsonFilter?: string;
    jsonExpanded?: Record<string, boolean>;
  }) => void;
  updateEntryMeta: (
    table: string,
    hash: number,
    meta: { label?: string; icon?: string; hasCoTables?: boolean },
  ) => void;
  hydrateEntrySummaries: (summaries: Record<string, ResolvedSummaryEntry>) => void;

  closeInspector: () => void;
  pinForDiff: (ref: DefinitionRef) => void;
  clearPinnedDiff: () => void;
  setMobileInspectorOpen: (open: boolean) => void;

  pushNotice: (notice: NoticeInput) => void;
  dismissNotice: (id: string) => void;

  hydrateFromHashUrl: (hashPath: string) => void;
  buildHashUrl: () => string;
  buildTabGroupShareUrl: () => string;
}

export const DEFAULT_MANIFEST_STATUS: ManifestStatus = {
  phase: 'idle',
  version: '',
  versionSignature: '',
  locale: 'en',
  fromCache: false,
  loadedTableCount: 0,
  totalTableCount: 0,
  indexedEntryCount: 0,
};

export function createDefaultFilters(): SearchFilters {
  return {
    table: 'all',
    tierTypes: [],
    damageTypes: [],
    classTypes: [],
    itemTypes: [],
    itemCategoryHashes: [],
    includeUnnamed: false,
    unnamedMode: 'auto',
    onlyRedacted: false,
  };
}

const NOTICE_TIMEOUTS: Record<NoticeTone, number> = {
  info: 3200,
  warn: 6000,
  danger: 6000,
};

const NOTICE_TIMERS = new Map<string, ReturnType<typeof setTimeout>>();
let noticeCounter = 0;
let sessionCounter = 0;
const ENTRY_SCROLL_BY_TAB = new Map<
  string,
  Partial<Record<InspectorTab, number>>
>();

function entryScrollKey(sessionId: string, historyIndex: number): string {
  return `${sessionId}:${historyIndex}`;
}

function clearSessionEntryScroll(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of ENTRY_SCROLL_BY_TAB.keys()) {
    if (key.startsWith(prefix)) ENTRY_SCROLL_BY_TAB.delete(key);
  }
}

function clearAllEntryScroll(): void {
  ENTRY_SCROLL_BY_TAB.clear();
}

function clearForwardEntryScroll(sessionId: string, historyIndex: number): void {
  const prefix = `${sessionId}:`;
  for (const key of ENTRY_SCROLL_BY_TAB.keys()) {
    if (!key.startsWith(prefix)) continue;
    const entryIndex = Number(key.slice(prefix.length));
    if (Number.isInteger(entryIndex) && entryIndex > historyIndex) {
      ENTRY_SCROLL_BY_TAB.delete(key);
    }
  }
}

function createNoticeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  noticeCounter += 1;
  return `notice-${Date.now()}-${noticeCounter}`;
}

function createSessionId(): string {
  sessionCounter += 1;
  return `tab-${Date.now()}-${sessionCounter}`;
}

export function normalizeTableName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const lookup = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (lookup === 'artifactperks') {
    return ARTIFACT_PERKS_TABLE;
  }
  const tables = Object.keys(TABLE_METADATA);
  const exactTable = tables.find(
    (table) => table.toLowerCase().replace(/[^a-z0-9]/g, '') === lookup,
  );
  if (exactTable) {
    return exactTable;
  }

  const shortNameMatches = tables.filter(
    (table) =>
      getShortTableName(table).toLowerCase().replace(/[^a-z0-9]/g, '') === lookup,
  );
  const knownTable =
    shortNameMatches.find((table) => table !== 'DestinyInventoryItemLiteDefinition') ??
    shortNameMatches[0];
  if (knownTable) {
    return knownTable;
  }
  if (/^Destiny/i.test(trimmed)) {
    return trimmed;
  }
  if (/Definition$/i.test(trimmed)) {
    return `Destiny${trimmed}`;
  }
  return `Destiny${trimmed}Definition`;
}

function isKnownTableName(table: string): boolean {
  if (table === ARTIFACT_PERKS_TABLE) return true;
  return Object.prototype.hasOwnProperty.call(TABLE_METADATA, table);
}

export function shortTableName(name: string): string {
  if (!name.startsWith('Destiny')) {
    return name;
  }
  const rest = name.slice('Destiny'.length);
  return rest.endsWith('Definition') ? rest.slice(0, -'Definition'.length) : rest;
}

export function fallbackEntryLabel(ref: { table: string; hash: number }): string {
  return `${shortTableName(ref.table)}:${ref.hash}`;
}

function createHistoryEntry(ref: DefinitionRef, jsonFilter?: string): TabHistoryEntry {
  const label = ref.label?.trim();
  return {
    table: ref.table,
    hash: ref.hash >>> 0,
    ...(label && label.length > 0 ? { label } : {}),
    ...(ref.icon ? { icon: ref.icon } : {}),
    activeTab: 'pretty',
    scrollByTab: {},
    ...(jsonFilter && jsonFilter.length > 0 ? { jsonFilter } : {}),
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseRefSegment(segment: string): DefinitionRef | null {
  const colon = segment.lastIndexOf(':');
  if (colon <= 0 || colon === segment.length - 1) {
    return null;
  }

  const table = normalizeTableName(safeDecode(segment.slice(0, colon)));
  if (table.length === 0) {
    return null;
  }

  const hashText = safeDecode(segment.slice(colon + 1));
  if (!/^-?\d+$/.test(hashText)) {
    return null;
  }

  const hash = Number.parseInt(hashText, 10);
  if (!Number.isSafeInteger(hash)) {
    return null;
  }

  return { table, hash: hash >>> 0 };
}

function stripHash(hashPath: string): string {
  const marker = hashPath.indexOf('#');
  return marker >= 0 ? hashPath.slice(marker + 1) : hashPath;
}

function syncActiveSession(
  sessions: InspectorSession[],
  activeSessionIndex: number,
): {
  sessions: InspectorSession[];
  activeSessionIndex: number;
  history: TabHistoryEntry[];
  historyIndex: number;
  activeTab: InspectorTab;
} {
  if (sessions.length === 0 || activeSessionIndex < 0) {
    return {
      sessions,
      activeSessionIndex: -1,
      history: [],
      historyIndex: -1,
      activeTab: 'pretty',
    };
  }
  const clamped = Math.max(0, Math.min(activeSessionIndex, sessions.length - 1));
  const active = sessions[clamped]!;
  const current = active.history[active.historyIndex];
  return {
    sessions,
    activeSessionIndex: clamped,
    history: active.history,
    historyIndex: active.historyIndex,
    activeTab: current?.activeTab ?? 'pretty',
  };
}

export const useExplorerStore = create<ExplorerState>()((set, get) => ({
  query: '',
  deepSearch: false,
  filters: createDefaultFilters(),
  manifestStatus: DEFAULT_MANIFEST_STATUS,
  tables: [],
  filterCatalog: { categories: [] },
  results: [],
  totalMatches: 0,
  searchDurationMs: 0,
  scopeEntryCount: 0,
  hiddenUnnamedCount: 0,
  searching: false,
  selectedResultIndex: 0,

  sessions: [],
  activeSessionIndex: -1,
  history: [],
  historyIndex: -1,
  activeTab: 'pretty',
  pinnedDiffRef: null,
  mobileInspectorOpen: false,
  inspectorMaximized: false,

  notices: [],

  setQuery: (query) => set({ query, selectedResultIndex: 0 }),

  setDeepSearch: (deepSearch) => set({ deepSearch, selectedResultIndex: 0 }),

  toggleDeepSearch: () =>
    set((state) => ({ deepSearch: !state.deepSearch, selectedResultIndex: 0 })),

  setFilters: (filters) =>
    set((state) => {
      const nextFilters = { ...state.filters, ...filters };
      if (filters.unnamedMode !== undefined) {
        nextFilters.includeUnnamed = filters.unnamedMode === 'always';
      } else if (filters.includeUnnamed !== undefined) {
        const currentlyTableScoped =
          state.filters.table !== 'all' || hasPositiveTableScopeInQuery(state.query);
        nextFilters.unnamedMode = filters.includeUnnamed
          ? 'always'
          : currentlyTableScoped
            ? 'never'
            : 'auto';
      }
      return { filters: nextFilters, selectedResultIndex: 0 };
    }),

  resetFilters: () =>
    set({
      filters: createDefaultFilters(),
      selectedResultIndex: 0,
    }),

  setTableFilter: (table) =>
    set((state) => {
      const resetUnnamedOverride = table === 'all' && state.filters.unnamedMode === 'never';
      return {
        filters: {
          ...state.filters,
          table,
          ...(resetUnnamedOverride ? { unnamedMode: 'auto' as const, includeUnnamed: false } : {}),
        },
        selectedResultIndex: 0,
      };
    }),

  setSearchResults: (
    items,
    totalMatches,
    durationMs,
    preserveCursor = false,
    hiddenUnnamedCount = 0,
    scopeEntryCount = 0,
  ) =>
    set((state) => ({
      results: items,
      totalMatches: Math.max(0, totalMatches),
      searchDurationMs: Math.max(0, durationMs),
      hiddenUnnamedCount: Math.max(0, hiddenUnnamedCount),
      scopeEntryCount: Math.max(0, scopeEntryCount),
      searching: false,
      selectedResultIndex: preserveCursor
        ? Math.min(state.selectedResultIndex, Math.max(0, items.length - 1))
        : 0,
    })),

  setSearching: (searching) => set({ searching }),

  setManifestStatus: (status) =>
    set((state) => ({
      manifestStatus: { ...state.manifestStatus, ...status },
    })),

  setTables: (tables) => set({ tables }),

  setFilterCatalog: (filterCatalog) => set({ filterCatalog }),

  setSelectedResultIndex: (index) =>
    set((state) => {
      if (state.results.length === 0) {
        return { selectedResultIndex: 0 };
      }
      const clamped = Math.max(0, Math.min(index, state.results.length - 1));
      return { selectedResultIndex: clamped };
    }),

  navigateInTab: (ref, jsonFilter) => {
    const state = get();
    const entry = createHistoryEntry(ref, jsonFilter);

    if (state.activeSessionIndex < 0 || state.sessions.length === 0) {
      const session: InspectorSession = {
        id: createSessionId(),
        history: [entry],
        historyIndex: 0,
      };
      set({
        ...syncActiveSession([session], 0),
        mobileInspectorOpen: true,
      });
      return;
    }

    const active = state.sessions[state.activeSessionIndex]!;
    const current = active.history[active.historyIndex];

    if (current && current.table === entry.table && current.hash === entry.hash) {
      const nextHistory = active.history.map((item, idx) =>
        idx === active.historyIndex
          ? {
              ...item,
              label: entry.label ?? item.label,
              icon: entry.icon ?? item.icon,
              ...(jsonFilter !== undefined ? { jsonFilter } : {}),
            }
          : item,
      );
      const nextSessions = state.sessions.map((s, idx) =>
        idx === state.activeSessionIndex ? { ...s, history: nextHistory } : s,
      );
      set({
        ...syncActiveSession(nextSessions, state.activeSessionIndex),
        mobileInspectorOpen: true,
      });
      return;
    }

    const nextHistory = [...active.history.slice(0, active.historyIndex + 1), entry];
    clearForwardEntryScroll(active.id, active.historyIndex);
    const nextSessions = state.sessions.map((s, idx) =>
      idx === state.activeSessionIndex
        ? {
            ...s,
            history: nextHistory,
            historyIndex: nextHistory.length - 1,
          }
        : s,
    );
    set({
      ...syncActiveSession(nextSessions, state.activeSessionIndex),
      mobileInspectorOpen: true,
    });
  },

  openInNewTab: (ref, focus = true, jsonFilter) => {
    const state = get();
    const unsigned = ref.hash >>> 0;
    const existingIdx = state.sessions.findIndex((s) => {
      const cur = s.history[s.historyIndex];
      return cur !== undefined && cur.table === ref.table && cur.hash === unsigned;
    });

    if (existingIdx >= 0) {
      const nextSessions = state.sessions.map((s, idx) => {
        if (idx !== existingIdx) return s;
        const nextHistory = s.history.map((item, hIdx) =>
          hIdx === s.historyIndex
            ? {
                ...item,
                label: ref.label?.trim() || item.label,
                icon: ref.icon ?? item.icon,
                ...(jsonFilter !== undefined
                  ? { activeTab: 'pretty' as const, jsonFilter }
                  : {}),
              }
            : item,
        );
        return { ...s, history: nextHistory };
      });
      if (focus) {
        set({
          ...syncActiveSession(nextSessions, existingIdx),
          mobileInspectorOpen: true,
        });
      } else {
        set({ sessions: nextSessions });
      }
      return;
    }

    const session: InspectorSession = {
      id: createSessionId(),
      history: [createHistoryEntry(ref, jsonFilter)],
      historyIndex: 0,
    };
    const nextSessions = [...state.sessions, session];
    const nextIndex =
      focus || state.activeSessionIndex < 0
        ? nextSessions.length - 1
        : state.activeSessionIndex;
    set({
      ...syncActiveSession(nextSessions, nextIndex),
      mobileInspectorOpen: focus ? true : state.mobileInspectorOpen,
    });
  },

  switchSession: (index) =>
    set((state) => {
      if (index < 0 || index >= state.sessions.length) {
        return {};
      }
      return {
        ...syncActiveSession(state.sessions, index),
        mobileInspectorOpen: true,
      };
    }),

  closeSession: (index) =>
    set((state) => {
      if (index < 0 || index >= state.sessions.length) {
        return {};
      }
      const closedSession = state.sessions[index];
      if (closedSession) clearSessionEntryScroll(closedSession.id);
      const nextSessions = state.sessions.filter((_, idx) => idx !== index);
      if (nextSessions.length === 0) {
        return {
          ...syncActiveSession([], -1),
          mobileInspectorOpen: false,
          inspectorMaximized: false,
        };
      }
      let nextActive = state.activeSessionIndex;
      if (index < state.activeSessionIndex) {
        nextActive = state.activeSessionIndex - 1;
      } else if (index === state.activeSessionIndex) {
        nextActive = Math.min(index, nextSessions.length - 1);
      }
      return syncActiveSession(nextSessions, nextActive);
    }),

  closeOtherSessions: (index) =>
    set((state) => {
      const keep = state.sessions[index];
      if (!keep) {
        return {};
      }
      for (const session of state.sessions) {
        if (session.id !== keep.id) clearSessionEntryScroll(session.id);
      }
      return syncActiveSession([keep], 0);
    }),

  toggleInspectorMaximized: () =>
    set((state) => ({ inspectorMaximized: !state.inspectorMaximized })),

  navigateBack: () => {
    const state = get();
    if (state.activeSessionIndex < 0) {
      return false;
    }
    const active = state.sessions[state.activeSessionIndex];
    if (!active || active.historyIndex <= 0) {
      return false;
    }
    const nextIdx = active.historyIndex - 1;
    const nextSessions = state.sessions.map((s, idx) =>
      idx === state.activeSessionIndex ? { ...s, historyIndex: nextIdx } : s,
    );
    set(syncActiveSession(nextSessions, state.activeSessionIndex));
    return true;
  },

  navigateForward: () => {
    const state = get();
    if (state.activeSessionIndex < 0) {
      return false;
    }
    const active = state.sessions[state.activeSessionIndex];
    if (!active || active.historyIndex >= active.history.length - 1) {
      return false;
    }
    const nextIdx = active.historyIndex + 1;
    const nextSessions = state.sessions.map((s, idx) =>
      idx === state.activeSessionIndex ? { ...s, historyIndex: nextIdx } : s,
    );
    set(syncActiveSession(nextSessions, state.activeSessionIndex));
    return true;
  },

  jumpToHistoryIndex: (index) => {
    const state = get();
    if (state.activeSessionIndex < 0) {
      return false;
    }
    const active = state.sessions[state.activeSessionIndex];
    if (!active || index < 0 || index >= active.history.length) {
      return false;
    }
    if (index === active.historyIndex) {
      return false;
    }
    const nextSessions = state.sessions.map((s, idx) =>
      idx === state.activeSessionIndex ? { ...s, historyIndex: index } : s,
    );
    set({
      ...syncActiveSession(nextSessions, state.activeSessionIndex),
      mobileInspectorOpen: true,
    });
    return true;
  },

  restoreHistoryPoint: (sessionId, targetHistoryIndex) => {
    const state = get();
    const sIdx = state.sessions.findIndex((s) => s.id === sessionId);
    if (sIdx < 0) {
      return false;
    }
    const session = state.sessions[sIdx]!;
    if (targetHistoryIndex < 0 || targetHistoryIndex >= session.history.length) {
      return false;
    }
    const nextSessions = state.sessions.map((s, idx) =>
      idx === sIdx ? { ...s, historyIndex: targetHistoryIndex } : s,
    );
    set({
      ...syncActiveSession(nextSessions, sIdx),
      mobileInspectorOpen: true,
    });
    return true;
  },

  setActiveTab: (activeTab) =>
    set((state) => {
      if (state.activeSessionIndex < 0) {
        return { activeTab };
      }
      const nextSessions = state.sessions.map((s, idx) => {
        if (idx !== state.activeSessionIndex) return s;
        const nextHistory = s.history.map((item, hIdx) =>
          hIdx === s.historyIndex ? { ...item, activeTab } : item,
        );
        return { ...s, history: nextHistory };
      });
      return syncActiveSession(nextSessions, state.activeSessionIndex);
    }),

  getEntryScroll: (tab) => {
    const state = get();
    if (state.activeSessionIndex < 0) return 0;
    const active = state.sessions[state.activeSessionIndex];
    if (!active || active.historyIndex < 0) return 0;
    const key = entryScrollKey(active.id, active.historyIndex);
    return ENTRY_SCROLL_BY_TAB.get(key)?.[tab] ??
      active.history[active.historyIndex]?.scrollByTab[tab] ??
      0;
  },

  saveEntryScroll: (tab, scrollTop) => {
    const state = get();
    if (state.activeSessionIndex < 0) return;
    const active = state.sessions[state.activeSessionIndex];
    if (!active || active.historyIndex < 0) return;
    const current = active.history[active.historyIndex];
    if (!current) return;
    const rounded = Math.max(0, Math.round(scrollTop));
    const key = entryScrollKey(active.id, active.historyIndex);
    const offsets = ENTRY_SCROLL_BY_TAB.get(key) ?? {};
    if ((offsets[tab] ?? current.scrollByTab[tab] ?? 0) === rounded) return;
    ENTRY_SCROLL_BY_TAB.set(key, { ...offsets, [tab]: rounded });
  },

  saveEntryJsonState: (patch) =>
    set((state) => {
      if (state.activeSessionIndex < 0) return {};
      const active = state.sessions[state.activeSessionIndex];
      const current = active?.history[active.historyIndex];
      if (!active || !current) return {};

      const nextSessions = state.sessions.map((s, idx) => {
        if (idx !== state.activeSessionIndex) return s;
        const nextHistory = s.history.map((item, hIdx) =>
          hIdx === s.historyIndex
            ? {
                ...item,
                ...(patch.jsonFilter !== undefined ? { jsonFilter: patch.jsonFilter } : {}),
                ...(patch.jsonExpanded !== undefined
                  ? { jsonExpanded: patch.jsonExpanded }
                  : {}),
              }
            : item,
        );
        return { ...s, history: nextHistory };
      });
      return syncActiveSession(nextSessions, state.activeSessionIndex);
    }),

  updateEntryMeta: (table, hash, meta) =>
    set((state) => {
      const unsigned = hash >>> 0;
      const trimmedLabel = meta.label?.trim();
      let changed = false;

      const nextSessions = state.sessions.map((s) => {
        let sessionChanged = false;
        const nextHistory = s.history.map((item) => {
          if (item.table !== table || item.hash !== unsigned) return item;
          const nextLabel = trimmedLabel && trimmedLabel.length > 0 ? trimmedLabel : item.label;
          const nextIcon = meta.icon ?? item.icon;
          const nextCo = meta.hasCoTables ?? item.hasCoTables;
          if (
            nextLabel === item.label &&
            nextIcon === item.icon &&
            nextCo === item.hasCoTables
          ) {
            return item;
          }
          sessionChanged = true;
          changed = true;
          return {
            ...item,
            ...(nextLabel ? { label: nextLabel } : {}),
            ...(nextIcon ? { icon: nextIcon } : {}),
            ...(nextCo !== undefined ? { hasCoTables: nextCo } : {}),
          };
        });
        return sessionChanged ? { ...s, history: nextHistory } : s;
      });

      if (!changed) return {};
      return syncActiveSession(nextSessions, state.activeSessionIndex);
    }),

  hydrateEntrySummaries: (summaries) =>
    set((state) => {
      let changed = false;
      const nextSessions = state.sessions.map((s) => {
        let sessionChanged = false;
        const nextHistory = s.history.map((item) => {
          const summary = summaries[`${item.table}:${item.hash}`];
          if (!summary) return item;
          const nextLabel = summary.name?.trim() || item.label;
          const nextIcon = summary.icon ?? item.icon;
          const nextCo = summary.hasCoTables ?? item.hasCoTables;
          if (
            nextLabel === item.label &&
            nextIcon === item.icon &&
            nextCo === item.hasCoTables
          ) {
            return item;
          }
          sessionChanged = true;
          changed = true;
          return {
            ...item,
            ...(nextLabel ? { label: nextLabel } : {}),
            ...(nextIcon ? { icon: nextIcon } : {}),
            ...(nextCo !== undefined ? { hasCoTables: nextCo } : {}),
          };
        });
        return sessionChanged ? { ...s, history: nextHistory } : s;
      });

      if (!changed) return {};
      return syncActiveSession(nextSessions, state.activeSessionIndex);
    }),

  closeInspector: () => {
    clearAllEntryScroll();
    set({
      sessions: [],
      activeSessionIndex: -1,
      history: [],
      historyIndex: -1,
      activeTab: 'pretty',
      mobileInspectorOpen: false,
      inspectorMaximized: false,
    });
  },

  pinForDiff: (ref) =>
    set((state) => {
      if (state.activeSessionIndex < 0) {
        return { pinnedDiffRef: ref, activeTab: 'diff' };
      }
      const nextSessions = state.sessions.map((s, idx) => {
        if (idx !== state.activeSessionIndex) return s;
        const nextHistory = s.history.map((item, hIdx) =>
          hIdx === s.historyIndex ? { ...item, activeTab: 'diff' as const } : item,
        );
        return { ...s, history: nextHistory };
      });
      return {
        pinnedDiffRef: ref,
        ...syncActiveSession(nextSessions, state.activeSessionIndex),
      };
    }),

  clearPinnedDiff: () => set({ pinnedDiffRef: null }),

  setMobileInspectorOpen: (mobileInspectorOpen) => set({ mobileInspectorOpen }),

  pushNotice: (notice) => {
    const id = notice.id ?? createNoticeId();
    const entry: AppNotice = { ...notice, id };

    const existingTimer = NOTICE_TIMERS.get(id);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    set((state) => ({
      notices: [...state.notices.filter((item) => item.id !== id), entry],
    }));

    const timer = setTimeout(() => {
      NOTICE_TIMERS.delete(id);
      get().dismissNotice(id);
    }, NOTICE_TIMEOUTS[notice.tone]);

    NOTICE_TIMERS.set(id, timer);
  },

  dismissNotice: (id) => {
    const timer = NOTICE_TIMERS.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      NOTICE_TIMERS.delete(id);
    }
    set((state) => ({
      notices: state.notices.filter((notice) => notice.id !== id),
    }));
  },

  hydrateFromHashUrl: (hashPath) => {
    clearAllEntryScroll();
    const raw = stripHash(hashPath);
    const queryMarker = raw.indexOf('?');
    const pathPart = queryMarker >= 0 ? raw.slice(0, queryMarker) : raw;
    const queryPart = queryMarker >= 0 ? raw.slice(queryMarker + 1) : '';
    const params = new URLSearchParams(queryPart);

    const segments = pathPart.split('/').filter((segment) => segment.length > 0);
    const query = params.get('q') ?? '';
    const deepSearch = params.get('deep') === '1';
    const tableParam = params.get('table');
    const tableCandidate =
      tableParam && tableParam !== 'all' ? normalizeTableName(tableParam) : 'all';
    const table = isKnownTableName(tableCandidate) ? tableCandidate : 'all';
    const unnamedModeParam = params.get('unnamedMode');
    const unnamedMode: UnnamedMode =
      unnamedModeParam === 'always' || unnamedModeParam === 'never'
        ? unnamedModeParam
        : 'auto';

    let sessions: InspectorSession[] = [];
    let activeIdx = -1;

    if (segments[0] === 't' && segments[1]) {
      const rawRefs = segments[1].split(',').map(parseRefSegment);
      const validRefs = rawRefs.filter((r): r is DefinitionRef => r !== null);
      sessions = validRefs.map((ref) => ({
        id: createSessionId(),
        history: [createHistoryEntry(ref)],
        historyIndex: 0,
      }));
      const activeParam = Number.parseInt(params.get('active') ?? '0', 10);
      activeIdx =
        sessions.length > 0
          ? Math.max(0, Math.min(Number.isFinite(activeParam) ? activeParam : 0, sessions.length - 1))
          : -1;
    } else if (segments[0] === 'i') {
      const refs = segments.slice(1).map(parseRefSegment);
      const history = refs
        .filter((ref): ref is DefinitionRef => ref !== null)
        .map((ref) => createHistoryEntry(ref));
      if (history.length > 0) {
        sessions = [
          {
            id: createSessionId(),
            history,
            historyIndex: history.length - 1,
          },
        ];
        activeIdx = 0;
      }
    }

    set((state) => ({
      query,
      deepSearch,
      filters: {
        ...state.filters,
        table,
        unnamedMode,
        includeUnnamed: unnamedMode === 'always',
      },
      ...syncActiveSession(sessions, activeIdx),
      pinnedDiffRef: null,
      mobileInspectorOpen: sessions.length > 0,
      selectedResultIndex: 0,
    }));
  },

  buildHashUrl: () => {
    const { sessions, activeSessionIndex, query, deepSearch, filters } = get();
    const params = new URLSearchParams();
    if (query.length > 0) {
      params.set('q', query);
    }
    if (deepSearch) {
      params.set('deep', '1');
    }
    if (filters.table.length > 0 && filters.table !== 'all') {
      params.set('table', filters.table);
    }
    if (filters.unnamedMode && filters.unnamedMode !== 'auto') {
      params.set('unnamedMode', filters.unnamedMode);
    }

    let base = '#/';
    if (sessions.length > 1) {
      const tabTokens = sessions
        .map((s) => s.history[s.historyIndex])
        .filter((r): r is TabHistoryEntry => r !== undefined)
        .map((ref) => `${encodeURIComponent(shortTableName(ref.table))}:${ref.hash}`);
      if (tabTokens.length > 0) {
        base = `#/t/${tabTokens.join(',')}`;
        if (activeSessionIndex > 0) {
          params.set('active', String(activeSessionIndex));
        }
      }
    } else if (sessions.length === 1) {
      const s = sessions[0]!;
      const cur = s.history[s.historyIndex];
      if (cur) {
        base = `#/i/${encodeURIComponent(shortTableName(cur.table))}:${cur.hash}`;
      }
    }

    const queryString = params.toString();
    return queryString.length > 0 ? `${base}?${queryString}` : base;
  },

  buildTabGroupShareUrl: () => {
    const { sessions, activeSessionIndex } = get();
    const tabTokens = sessions
      .map((s) => s.history[s.historyIndex])
      .filter((r): r is TabHistoryEntry => r !== undefined)
      .map((ref) => `${encodeURIComponent(shortTableName(ref.table))}:${ref.hash}`);

    const origin =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : '';
    if (tabTokens.length === 0) {
      return `${origin}#/`;
    }
    const suffix = activeSessionIndex > 0 ? `?active=${activeSessionIndex}` : '';
    return `${origin}#/t/${tabTokens.join(',')}${suffix}`;
  },
}));
