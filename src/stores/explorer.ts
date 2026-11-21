import { create } from 'zustand';
import type {
  DefinitionRef,
  FilterCatalog,
  InspectorTab,
  ManifestStatus,
  SearchFilters,
  SearchResultItem,
  TableStatus,
} from '../types/manifest';

export type NoticeTone = 'info' | 'warn' | 'danger';

export interface AppNotice {
  id: string;
  tone: NoticeTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export type NoticeInput = Omit<AppNotice, 'id'> & { id?: string };

export interface InspectorSession {
  id: string;
  stack: DefinitionRef[];
  stackIndex: number;
  label: string;
}

export interface ExplorerState {
  query: string;
  filters: SearchFilters;
  manifestStatus: ManifestStatus;
  tables: TableStatus[];
  filterCatalog: FilterCatalog;
  results: SearchResultItem[];
  totalMatches: number;
  searchDurationMs: number;
  searching: boolean;
  selectedResultIndex: number;

  sessions: InspectorSession[];
  activeSessionIndex: number;
  stack: DefinitionRef[];
  stackIndex: number;
  activeTab: InspectorTab;
  pinnedDiffRef: DefinitionRef | null;
  mobileInspectorOpen: boolean;
  inspectorMaximized: boolean;

  notices: AppNotice[];

  setQuery: (query: string) => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  resetFilters: () => void;
  setTableFilter: (table: string) => void;
  setSearchResults: (items: SearchResultItem[], totalMatches: number, durationMs: number) => void;
  setSearching: (searching: boolean) => void;
  setManifestStatus: (status: Partial<ManifestStatus>) => void;
  setTables: (tables: TableStatus[]) => void;
  setFilterCatalog: (catalog: FilterCatalog) => void;
  setSelectedResultIndex: (index: number) => void;

  openDefinition: (ref: DefinitionRef, pushToStack?: boolean, label?: string) => void;
  openInNewTab: (ref: DefinitionRef, label?: string, focus?: boolean) => void;
  switchSession: (index: number) => void;
  closeSession: (index: number) => void;
  closeOtherSessions: (index: number) => void;
  updateActiveSessionLabel: (label: string) => void;
  toggleInspectorMaximized: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
  jumpToStackIndex: (index: number) => void;
  closeInspector: () => void;
  setActiveTab: (tab: InspectorTab) => void;
  pinForDiff: (ref: DefinitionRef) => void;
  clearPinnedDiff: () => void;
  setMobileInspectorOpen: (open: boolean) => void;

  pushNotice: (notice: NoticeInput) => void;
  dismissNotice: (id: string) => void;

  hydrateFromHashUrl: (hashPath: string) => void;
  buildHashUrl: () => string;
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

function createNoticeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  noticeCounter += 1;
  return `notice-${Date.now()}-${noticeCounter}`;
}

/**
 * Converts a short table name (`InventoryItem`) to its full Bungie table name
 * (`DestinyInventoryItemDefinition`). Full names pass through untouched.
 */
export function normalizeTableName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.startsWith('Destiny')) {
    return trimmed;
  }
  if (trimmed.endsWith('Definition')) {
    return `Destiny${trimmed}`;
  }
  return `Destiny${trimmed}Definition`;
}

/** Converts `DestinyInventoryItemDefinition` to `InventoryItem` for URL output. */
export function shortTableName(name: string): string {
  if (!name.startsWith('Destiny')) {
    return name;
  }
  const rest = name.slice('Destiny'.length);
  return rest.endsWith('Definition') ? rest.slice(0, -'Definition'.length) : rest;
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

  return { table, hash };
}

function stripHash(hashPath: string): string {
  const marker = hashPath.indexOf('#');
  return marker >= 0 ? hashPath.slice(marker + 1) : hashPath;
}

let sessionCounter = 0;

function createSessionId(): string {
  sessionCounter += 1;
  return `tab-${Date.now()}-${sessionCounter}`;
}

function defaultSessionLabel(ref: DefinitionRef): string {
  return `${shortTableName(ref.table)}:${ref.hash}`;
}

function syncActiveSession(
  sessions: InspectorSession[],
  activeSessionIndex: number,
): {
  sessions: InspectorSession[];
  activeSessionIndex: number;
  stack: DefinitionRef[];
  stackIndex: number;
} {
  if (sessions.length === 0 || activeSessionIndex < 0) {
    return { sessions, activeSessionIndex: -1, stack: [], stackIndex: -1 };
  }
  const clamped = Math.max(0, Math.min(activeSessionIndex, sessions.length - 1));
  const active = sessions[clamped]!;
  return {
    sessions,
    activeSessionIndex: clamped,
    stack: active.stack,
    stackIndex: active.stackIndex,
  };
}

export const useExplorerStore = create<ExplorerState>()((set, get) => ({
  query: '',
  filters: createDefaultFilters(),
  manifestStatus: DEFAULT_MANIFEST_STATUS,
  tables: [],
  filterCatalog: { categories: [] },
  results: [],
  totalMatches: 0,
  searchDurationMs: 0,
  searching: false,
  selectedResultIndex: 0,

  sessions: [],
  activeSessionIndex: -1,
  stack: [],
  stackIndex: -1,
  activeTab: 'pretty',
  pinnedDiffRef: null,
  mobileInspectorOpen: false,
  inspectorMaximized: false,

  notices: [],

  setQuery: (query) => set({ query, selectedResultIndex: 0 }),

  setFilters: (filters) =>
    set((state) => ({
      filters: { ...state.filters, ...filters },
      selectedResultIndex: 0,
    })),

  resetFilters: () =>
    set({
      filters: createDefaultFilters(),
      selectedResultIndex: 0,
    }),

  setTableFilter: (table) =>
    set((state) => ({
      filters: { ...state.filters, table },
      selectedResultIndex: 0,
    })),

  setSearchResults: (items, totalMatches, durationMs) =>
    set({
      results: items,
      totalMatches: Math.max(0, totalMatches),
      searchDurationMs: Math.max(0, durationMs),
      searching: false,
      selectedResultIndex: 0,
    }),

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

  openDefinition: (ref, pushToStack = true, label) => {
    const state = get();
    const resolvedLabel = label?.trim() || defaultSessionLabel(ref);

    // If no active session exists yet, create the first inspector tab.
    if (state.activeSessionIndex < 0 || state.sessions.length === 0) {
      const session: InspectorSession = {
        id: createSessionId(),
        stack: [ref],
        stackIndex: 0,
        label: resolvedLabel,
      };
      set({
        ...syncActiveSession([session], 0),
        mobileInspectorOpen: true,
      });
      return;
    }

    const active = state.sessions[state.activeSessionIndex]!;
    const current = active.stackIndex >= 0 ? active.stack[active.stackIndex] : undefined;

    if (!pushToStack) {
      const nextStack = [...active.stack];
      if (active.stackIndex >= 0 && nextStack.length > 0) {
        nextStack[active.stackIndex] = ref;
      } else {
        nextStack.push(ref);
      }
      const nextSessions = state.sessions.map((s, idx) =>
        idx === state.activeSessionIndex
          ? { ...s, stack: nextStack, stackIndex: Math.max(0, active.stackIndex), label: resolvedLabel }
          : s,
      );
      set({
        ...syncActiveSession(nextSessions, state.activeSessionIndex),
        mobileInspectorOpen: true,
      });
      return;
    }

    if (current && current.table === ref.table && current.hash === ref.hash) {
      set({ mobileInspectorOpen: true });
      return;
    }

    const nextStack = [...active.stack.slice(0, active.stackIndex + 1), ref];
    const nextSessions = state.sessions.map((s, idx) =>
      idx === state.activeSessionIndex
        ? { ...s, stack: nextStack, stackIndex: nextStack.length - 1, label: resolvedLabel }
        : s,
    );
    set({
      ...syncActiveSession(nextSessions, state.activeSessionIndex),
      mobileInspectorOpen: true,
    });
  },

  openInNewTab: (ref, label, focus = true) => {
    const state = get();
    // If an existing tab is already focused on this exact definition, focus it.
    const existingIdx = state.sessions.findIndex((s) => {
      const cur = s.stack[s.stackIndex];
      return cur !== undefined && cur.table === ref.table && cur.hash === ref.hash;
    });
    if (existingIdx >= 0) {
      if (focus) {
        set({
          ...syncActiveSession(state.sessions, existingIdx),
          mobileInspectorOpen: true,
        });
      }
      return;
    }

    const session: InspectorSession = {
      id: createSessionId(),
      stack: [ref],
      stackIndex: 0,
      label: label?.trim() || defaultSessionLabel(ref),
    };
    const nextSessions = [...state.sessions, session];
    const nextIndex = focus || state.activeSessionIndex < 0 ? nextSessions.length - 1 : state.activeSessionIndex;
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
      return syncActiveSession([keep], 0);
    }),

  updateActiveSessionLabel: (label) =>
    set((state) => {
      const trimmed = label.trim();
      if (!trimmed || state.activeSessionIndex < 0) {
        return {};
      }
      const active = state.sessions[state.activeSessionIndex];
      if (!active || active.label === trimmed) {
        return {};
      }
      const nextSessions = state.sessions.map((s, idx) =>
        idx === state.activeSessionIndex ? { ...s, label: trimmed } : s,
      );
      return { sessions: nextSessions };
    }),

  toggleInspectorMaximized: () =>
    set((state) => ({ inspectorMaximized: !state.inspectorMaximized })),

  navigateBack: () =>
    set((state) => {
      if (state.activeSessionIndex < 0) {
        return {};
      }
      const active = state.sessions[state.activeSessionIndex];
      if (!active || active.stackIndex <= 0) {
        return {};
      }
      const nextIdx = active.stackIndex - 1;
      const target = active.stack[nextIdx];
      const nextSessions = state.sessions.map((s, idx) =>
        idx === state.activeSessionIndex
          ? {
              ...s,
              stackIndex: nextIdx,
              label: target ? defaultSessionLabel(target) : s.label,
            }
          : s,
      );
      return syncActiveSession(nextSessions, state.activeSessionIndex);
    }),

  navigateForward: () =>
    set((state) => {
      if (state.activeSessionIndex < 0) {
        return {};
      }
      const active = state.sessions[state.activeSessionIndex];
      if (!active || active.stackIndex >= active.stack.length - 1) {
        return {};
      }
      const nextIdx = active.stackIndex + 1;
      const target = active.stack[nextIdx];
      const nextSessions = state.sessions.map((s, idx) =>
        idx === state.activeSessionIndex
          ? {
              ...s,
              stackIndex: nextIdx,
              label: target ? defaultSessionLabel(target) : s.label,
            }
          : s,
      );
      return syncActiveSession(nextSessions, state.activeSessionIndex);
    }),

  jumpToStackIndex: (index) =>
    set((state) => {
      if (state.activeSessionIndex < 0) {
        return {};
      }
      const active = state.sessions[state.activeSessionIndex];
      if (!active || active.stack.length === 0) {
        return {};
      }
      const clamped = Math.max(0, Math.min(index, active.stack.length - 1));
      const target = active.stack[clamped];
      const nextSessions = state.sessions.map((s, idx) =>
        idx === state.activeSessionIndex
          ? {
              ...s,
              stackIndex: clamped,
              label: target ? defaultSessionLabel(target) : s.label,
            }
          : s,
      );
      return {
        ...syncActiveSession(nextSessions, state.activeSessionIndex),
        mobileInspectorOpen: true,
      };
    }),

  closeInspector: () =>
    set({
      sessions: [],
      activeSessionIndex: -1,
      stack: [],
      stackIndex: -1,
      mobileInspectorOpen: false,
      inspectorMaximized: false,
    }),

  setActiveTab: (activeTab) => set({ activeTab }),

  pinForDiff: (ref) => set({ pinnedDiffRef: ref, activeTab: 'diff' }),

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
    const raw = stripHash(hashPath);
    const queryMarker = raw.indexOf('?');
    const pathPart = queryMarker >= 0 ? raw.slice(0, queryMarker) : raw;
    const queryPart = queryMarker >= 0 ? raw.slice(queryMarker + 1) : '';

    const segments = pathPart.split('/').filter((segment) => segment.length > 0);
    const refs = segments[0] === 'i' ? segments.slice(1).map(parseRefSegment) : [];
    const stack = refs.filter((ref): ref is DefinitionRef => ref !== null);

    const params = new URLSearchParams(queryPart);
    const query = params.get('q') ?? '';
    const tableParam = params.get('table');
    const table = tableParam && tableParam !== 'all' ? normalizeTableName(tableParam) : 'all';

    const session: InspectorSession | null =
      stack.length > 0
        ? {
            id: createSessionId(),
            stack,
            stackIndex: stack.length - 1,
            label: defaultSessionLabel(stack[stack.length - 1]!),
          }
        : null;

    set((state) => ({
      query,
      filters: { ...state.filters, table },
      ...(session ? syncActiveSession([session], 0) : syncActiveSession([], -1)),
      activeTab: 'pretty',
      pinnedDiffRef: null,
      mobileInspectorOpen: stack.length > 0,
      selectedResultIndex: 0,
    }));
  },

  buildHashUrl: () => {
    const { stack, stackIndex, query, filters } = get();
    const active = stackIndex >= 0 ? stack[stackIndex] : undefined;

    const base =
      active !== undefined
        ? `#/i/${stack
            .slice(0, stackIndex + 1)
            .map((ref) => `${encodeURIComponent(shortTableName(ref.table))}:${ref.hash}`)
            .join('/')}`
        : '#/';

    const params = new URLSearchParams();
    if (query.length > 0) {
      params.set('q', query);
    }
    if (filters.table.length > 0 && filters.table !== 'all') {
      params.set('table', filters.table);
    }

    const queryString = params.toString();
    return queryString.length > 0 ? `${base}?${queryString}` : base;
  },
}));
