import { create } from 'zustand';

export type HistoryChangeKind = 'a' | 'm' | 'r' | 'u' | 'c';
export type HistoryKindFilter = HistoryChangeKind | 'all';

export interface HistoryWorkspaceEntry {
  key: string;
  table: string;
  hash: number;
  name: string;
  subtitle: string;
  icon: string;
  tierType: number;
  changedFields?: number;
  kind: HistoryChangeKind;
  versionIndex: number;
  date: string;
  version?: string;
}

export interface HistoryOverviewWorkspace {
  kindFilter: HistoryKindFilter;
  search: string;
  manualBucketOverrides: Record<string, boolean>;
  searchBucketState: {
    query: string;
    overrides: Record<string, boolean>;
  };
  visibleCategoryCounts: Record<string, number>;
  scrollTop: number;
}

const EMPTY_OVERVIEW: HistoryOverviewWorkspace = {
  kindFilter: 'all',
  search: '',
  manualBucketOverrides: {},
  searchBucketState: { query: '', overrides: {} },
  visibleCategoryCounts: {},
  scrollTop: 0,
};

export function createHistoryOverviewWorkspace(): HistoryOverviewWorkspace {
  return {
    ...EMPTY_OVERVIEW,
    manualBucketOverrides: {},
    searchBucketState: { query: '', overrides: {} },
    visibleCategoryCounts: {},
  };
}

export interface HistoryWorkspaceValues {
  lastVersionIndex: number | null;
  tabs: HistoryWorkspaceEntry[];
  activeKey: string | null;
  overviews: Record<string, HistoryOverviewWorkspace>;
  overviewWidth: number | null;
  inspectorMaximized: boolean;
  mobileInspectorOpen: boolean;
}

export interface HistoryWorkspaceActions {
  setLastVersionIndex: (versionIndex: number | null) => void;
  setTabs: (tabs: HistoryWorkspaceEntry[], activeKey: string | null) => void;
  updateOverview: (
    versionIndex: number,
    update:
      | Partial<HistoryOverviewWorkspace>
      | ((current: HistoryOverviewWorkspace) => HistoryOverviewWorkspace),
  ) => void;
  setOverviewWidth: (width: number | null) => void;
  setInspectorMaximized: (maximized: boolean) => void;
  setMobileInspectorOpen: (open: boolean) => void;
  reset: () => void;
}

export type HistoryWorkspaceState = HistoryWorkspaceValues & HistoryWorkspaceActions;

const initialValues = (): HistoryWorkspaceValues => ({
  lastVersionIndex: null,
  tabs: [],
  activeKey: null,
  overviews: {},
  overviewWidth: null,
  inspectorMaximized: false,
  mobileInspectorOpen: false,
});

export const useHistoryWorkspaceStore = create<HistoryWorkspaceState>()((set) => ({
  ...initialValues(),
  setLastVersionIndex: (lastVersionIndex) => set({ lastVersionIndex }),
  setTabs: (tabs, activeKey) => set({ tabs, activeKey }),
  updateOverview: (versionIndex, update) =>
    set((state) => {
      const key = String(versionIndex);
      const current = state.overviews[key] ?? createHistoryOverviewWorkspace();
      const next =
        typeof update === 'function'
          ? update(current)
          : { ...current, ...update };
      return { overviews: { ...state.overviews, [key]: next } };
    }),
  setOverviewWidth: (overviewWidth) => set({ overviewWidth }),
  setInspectorMaximized: (inspectorMaximized) => set({ inspectorMaximized }),
  setMobileInspectorOpen: (mobileInspectorOpen) => set({ mobileInspectorOpen }),
  reset: () => set(initialValues()),
}));
