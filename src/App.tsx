import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  BungieLocale,
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  DefinitionRef,
  InspectorTab,
  ReverseReferenceResponse,
  SearchResultItem,
  UnnamedMode,
  VariantItem,
} from './types/manifest';
import * as manifestClient from './manifest/client';
import { getShortTableName } from './manifest/tables';
import { useCollectorStore } from './stores/collector';
import { useExplorerStore } from './stores/explorer';
import { useSettingsStore } from './stores/settings';
import { Header } from './components/Header';
import { HelpDialog } from './components/HelpDialog';
import { ChangelogDialog } from './components/ChangelogDialog';
import { ResultsPane } from './components/ResultsPane';
import { StatusBar } from './components/StatusBar';
import { TableRail } from './components/TableRail';
import { DefinitionInspector } from './components/inspector/DefinitionInspector';
import { ManifestHistoryPage } from './components/history/ManifestHistoryPage';
import { NoticeStrip } from './ui/NoticeStrip';
import {
  checkForAppUpdate,
  startAppUpdateWatcher,
} from './utils/appUpdate';
import {
  CHANGELOG,
  computeChangelogOpenState,
  getLatestChangelogVersion,
  readLastSeenChangelogVersion,
  writeLastSeenChangelogVersion,
} from './data/changelog';
import {
  cacheKey,
  clarityCache,
  clearInspectorCaches,
  detailCache,
  evictInspectorEntry,
  referencesCache,
  variantsCache,
} from './utils/inspectorCache';
import styles from './App.module.scss';

const TAB_KEYS: readonly InspectorTab[] = [
  'pretty',
  'overview',
  'variants',
  'references',
  'raw',
  'diff',
];

const DEFAULT_SEARCH_LIMIT = 2500;
const DEFAULT_DEEP_SEARCH_LIMIT = 400;

function initialResultLimit(isDeepSearch: boolean): number {
  return isDeepSearch ? DEFAULT_DEEP_SEARCH_LIMIT : DEFAULT_SEARCH_LIMIT;
}

interface HistoryTabState {
  manifestExplorer: true;
  sessionId: string;
  historyIndex: number;
  mobileInspector?: true;
}

function buildSearchHashUrl(
  query: string,
  deepSearch: boolean,
  table: string,
  unnamedMode: UnnamedMode | undefined,
): string {
  const params = new URLSearchParams();
  if (query.length > 0) {
    params.set('q', query);
  }
  if (deepSearch) {
    params.set('deep', '1');
  }
  if (table.length > 0 && table !== 'all') {
    params.set('table', table);
  }
  if (unnamedMode && unnamedMode !== 'auto') {
    params.set('unnamedMode', unnamedMode);
  }
  const queryString = params.toString();
  return queryString.length > 0 ? `#/?${queryString}` : '#/';
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || target.isContentEditable) {
    return true;
  }
  if (tag === 'INPUT') {
    const input = target as HTMLInputElement;
    const nonTextTypes = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range']);
    return !nonTextTypes.has(input.type);
  }
  return Boolean(target.closest('[contenteditable="true"]'));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (isTextInputTarget(target)) {
    return true;
  }
  return target instanceof HTMLElement && target.tagName === 'SELECT';
}

function getHistoryVersionFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/history\/(\d+)\/?$/);
  if (!match?.[1]) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function flushActiveInspectorDomScroll(): void {
  const scroller = document.querySelector<HTMLElement>(
    'aside[aria-label="Definition inspector"] [data-inspector-panel-active="true"] [data-inspector-scroll="true"]',
  );
  if (!scroller) return;
  const st = useExplorerStore.getState();
  st.saveEntryScroll(st.activeTab, scroller.scrollTop);
}

function cacheDefinition(payload: DefinitionDetailPayload): DefinitionDetailPayload {
  const key = cacheKey(payload.table, payload.hash);
  const cached = detailCache.get(key);
  if (cached && !cached.isLite && payload.isLite) {
    return cached;
  }
  detailCache.set(key, payload);
  return payload;
}

export function App(): ReactNode {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [pathname, setPathname] = useState(
    () => (typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  const searchSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const syncingHashRef = useRef(false);
  const applyingPopStateRef = useRef(false);
  const lastHandledHashRef = useRef('');
  const lastSearchKeyRef = useRef('');
  const lastBaseKeyRef = useRef('');
  const lastResultLimitRef = useRef<number | null>(null);
  const lastLimitSearchKeyRef = useRef('');
  const maxPushedBySessionRef = useRef(new Map<string, number>());

  const [helpOpen, setHelpOpen] = useState(false);
  const [changelogState, setChangelogState] = useState(() =>
    computeChangelogOpenState(readLastSeenChangelogVersion()),
  );
  const [changelogOpen, setChangelogOpen] = useState(
    () => changelogState.shouldAutoOpen,
  );
  const [appUpdateAvailable, setAppUpdateAvailable] = useState(false);
  const [appUpdateDismissed, setAppUpdateDismissed] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 900px)').matches,
  );
  const lastManifestVersionRef = useRef(
    useExplorerStore.getState().manifestStatus.versionSignature,
  );

  const markAppUpdateAvailable = useCallback((_latestBuildId: string) => {
    setAppUpdateAvailable(true);
    setAppUpdateDismissed(false);
  }, []);

  // Settings
  const locale = useSettingsStore((s) => s.locale);
  const bungieApiKey = useSettingsStore((s) => s.bungieApiKey);
  const showClarityDescriptions = useSettingsStore((s) => s.showClarityDescriptions);
  const sortMode = useSettingsStore((s) => s.sortMode);
  const railCollapsed = useSettingsStore((s) => s.railCollapsed);
  const railWidth = useSettingsStore((s) => s.railWidth);
  const inspectorWidth = useSettingsStore((s) => s.inspectorWidth);
  const fuzzySearch = useSettingsStore((s) => s.fuzzySearch);
  const fuzziness = useSettingsStore((s) => s.fuzziness);
  const queryPrecedence = useSettingsStore((s) => s.queryPrecedence);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const toggleRail = useSettingsStore((s) => s.toggleRail);
  const setRailWidth = useSettingsStore((s) => s.setRailWidth);
  const setInspectorWidth = useSettingsStore((s) => s.setInspectorWidth);

  // Explorer state
  const deepSearch = useExplorerStore((s) => s.deepSearch);
  const filters = useExplorerStore((s) => s.filters);
  const manifestStatus = useExplorerStore((s) => s.manifestStatus);
  const results = useExplorerStore((s) => s.results);
  const totalMatches = useExplorerStore((s) => s.totalMatches);
  const scopeEntryCount = useExplorerStore((s) => s.scopeEntryCount);
  const hiddenUnnamedCount = useExplorerStore((s) => s.hiddenUnnamedCount);
  const selectedResultIndex = useExplorerStore((s) => s.selectedResultIndex);
  const sessions = useExplorerStore((s) => s.sessions);
  const history = useExplorerStore((s) => s.history);
  const historyIndex = useExplorerStore((s) => s.historyIndex);
  const activeTab = useExplorerStore((s) => s.activeTab);
  const pinnedDiffRef = useExplorerStore((s) => s.pinnedDiffRef);
  const mobileInspectorOpen = useExplorerStore((s) => s.mobileInspectorOpen);

  const setManifestStatus = useExplorerStore((s) => s.setManifestStatus);
  const setTables = useExplorerStore((s) => s.setTables);
  const setFilterCatalog = useExplorerStore((s) => s.setFilterCatalog);
  const setSearchResults = useExplorerStore((s) => s.setSearchResults);
  const setSearching = useExplorerStore((s) => s.setSearching);
  const setTableFilter = useExplorerStore((s) => s.setTableFilter);
  const setSelectedResultIndex = useExplorerStore((s) => s.setSelectedResultIndex);
  const navigateInTab = useExplorerStore((s) => s.navigateInTab);
  const openInNewTab = useExplorerStore((s) => s.openInNewTab);
  const switchSession = useExplorerStore((s) => s.switchSession);
  const closeSession = useExplorerStore((s) => s.closeSession);
  const updateEntryMeta = useExplorerStore((s) => s.updateEntryMeta);
  const hydrateEntrySummaries = useExplorerStore((s) => s.hydrateEntrySummaries);
  const inspectorMaximized = useExplorerStore((s) => s.inspectorMaximized);
  const activeSessionIndex = useExplorerStore((s) => s.activeSessionIndex);
  const sessionsCount = sessions.length;
  const jumpToHistoryIndex = useExplorerStore((s) => s.jumpToHistoryIndex);
  const restoreHistoryPoint = useExplorerStore((s) => s.restoreHistoryPoint);
  const closeInspector = useExplorerStore((s) => s.closeInspector);
  const setMobileInspectorOpen = useExplorerStore((s) => s.setMobileInspectorOpen);
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);
  const pushNotice = useExplorerStore((s) => s.pushNotice);
  const hydrateFromHashUrl = useExplorerStore((s) => s.hydrateFromHashUrl);
  const buildHashUrl = useExplorerStore((s) => s.buildHashUrl);

  const [resultLimit, setResultLimit] = useState(() =>
    initialResultLimit(
      useExplorerStore.getState().deepSearch ||
        /^deep:/i.test(useExplorerStore.getState().query.trim()),
    ),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const isHistoryRoute = pathname === '/history' || pathname.startsWith('/history/');
  const historyVersionIndex = getHistoryVersionFromPath(pathname);

  const navigatePage = useCallback((path: '/' | '/history') => {
    const nextUrl =
      path === '/' && window.location.pathname.startsWith('/history')
        ? `/${useExplorerStore.getState().buildHashUrl()}`
        : path;
    if (window.location.pathname === path && window.location.href.endsWith(nextUrl)) return;
    window.history.pushState(null, '', nextUrl);
    setPathname(window.location.pathname);
  }, []);

  const selectHistoryVersion = useCallback((index: number, replace = false) => {
    const path = `/history/${index}`;
    if (window.location.pathname === path) return;
    if (replace) {
      window.history.replaceState(window.history.state, '', path);
    } else {
      window.history.pushState(window.history.state, '', path);
    }
    setPathname(window.location.pathname);
  }, []);

  const navigateExplorerDefinition = useCallback((table: string, hash: number) => {
    const hashPath = `#/i/${encodeURIComponent(getShortTableName(table))}:${hash >>> 0}`;
    useExplorerStore.getState().hydrateFromHashUrl(hashPath);
    window.history.pushState(null, '', `/${hashPath}`);
    setPathname('/');
  }, []);

  const activeEntry = historyIndex >= 0 ? (history[historyIndex] ?? null) : null;
  const currentRef: DefinitionRef | null = useMemo(
    () =>
      activeEntry
        ? {
            table: activeEntry.table,
            hash: activeEntry.hash,
            label: activeEntry.label,
            icon: activeEntry.icon,
          }
        : null,
    [
      activeEntry?.table,
      activeEntry?.hash,
      activeEntry?.label,
      activeEntry?.icon,
    ],
  );

  // Inspector detail states
  const [detail, setDetail] = useState<DefinitionDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadingFull, setLoadingFull] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);

  const [references, setReferences] = useState<ReverseReferenceResponse | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [refReloadCounter, setRefReloadCounter] = useState(0);

  const [pinnedDetail, setPinnedDetail] = useState<DefinitionDetailPayload | null>(null);
  const [pinnedLoading, setPinnedLoading] = useState(false);

  const [clarityEntry, setClarityEntry] = useState<ClarityDescriptionEntry | null>(null);
  const [clarityLoading, setClarityLoading] = useState(false);
  const [detailReloadCounter, setDetailReloadCounter] = useState(0);

  const syncBrowserHistory = useCallback((mode: 'replace' | 'push') => {
    if (
      window.location.pathname === '/history' ||
      window.location.pathname.startsWith('/history/')
    ) {
      return;
    }
    const st = useExplorerStore.getState();
    const nextHash =
      isNarrowLayout && !st.mobileInspectorOpen
        ? buildSearchHashUrl(
            st.query,
            st.deepSearch,
            st.filters.table,
            st.filters.unnamedMode,
          )
        : st.buildHashUrl();
    const active =
      st.activeSessionIndex >= 0 ? st.sessions[st.activeSessionIndex] : undefined;
    let historyState: HistoryTabState | null = active
      ? {
          manifestExplorer: true,
          sessionId: active.id,
          historyIndex: active.historyIndex,
        }
      : null;

    if (isNarrowLayout) {
      const existingState =
        window.history.state && typeof window.history.state === 'object'
          ? (window.history.state as Record<string, unknown>)
          : {};
      if (st.mobileInspectorOpen) {
        historyState = {
          ...existingState,
          ...(historyState ?? {}),
          mobileInspector: true,
        } as HistoryTabState;
      } else {
        const {
          manifestExplorer: _manifestExplorer,
          sessionId: _sessionId,
          historyIndex: _historyIndex,
          mobileInspector: _mobileInspector,
          ...otherState
        } = existingState;
        historyState = Object.keys(otherState).length > 0
          ? (otherState as unknown as HistoryTabState)
          : null;
      }
    }

    if (active) {
      if (isNarrowLayout && mode === 'replace') {
        // Mobile navigation stays on one inspector history entry, so those
        // replaced tab-history points are not browser-history destinations.
        maxPushedBySessionRef.current.delete(active.id);
      } else if (mode === 'push') {
        maxPushedBySessionRef.current.set(active.id, active.historyIndex);
      } else if (!maxPushedBySessionRef.current.has(active.id)) {
        maxPushedBySessionRef.current.set(active.id, active.historyIndex);
      }
    }

    syncingHashRef.current = true;
    lastHandledHashRef.current = nextHash;
    if (mode === 'push') {
      window.history.pushState(historyState, '', nextHash);
    } else {
      window.history.replaceState(historyState, '', nextHash);
    }
    window.setTimeout(() => {
      syncingHashRef.current = false;
    }, 0);
  }, [isNarrowLayout]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const updateLayout = (): void => setIsNarrowLayout(media.matches);
    updateLayout();
    media.addEventListener('change', updateLayout);
    return () => media.removeEventListener('change', updateLayout);
  }, []);

  // Hydrate initial URL hash & unify browser back/forward with the tab's history/future
  useEffect(() => {
    if (!isHistoryRoute && window.location.hash) {
      hydrateFromHashUrl(window.location.hash);
      syncBrowserHistory('replace');
    }

    let popTimer: number | null = null;

    const onPopState = (event: PopStateEvent): void => {
      setPathname(window.location.pathname);
      if (window.location.pathname === '/history' || window.location.pathname.startsWith('/history/')) {
        if (popTimer !== null) {
          window.clearTimeout(popTimer);
          popTimer = null;
        }
        applyingPopStateRef.current = false;
        return;
      }
      const isMobile = window.matchMedia('(max-width: 900px)').matches;
      if (syncingHashRef.current && !isMobile) {
        return;
      }
      flushActiveInspectorDomScroll();

      const currentHash = window.location.hash;
      lastHandledHashRef.current = currentHash;
      applyingPopStateRef.current = true;
      if (popTimer !== null) {
        window.clearTimeout(popTimer);
      }

      const state = event.state as
        | (Partial<HistoryTabState> & { mobileInspector?: boolean })
        | null;

      if (isMobile) {
        if (state?.mobileInspector !== true) {
          // The previous entry is the search screen. Keep every inspector tab
          // and its history in the store so Forward or another result can
          // reopen the inspector without rebuilding the tab group.
          setMobileInspectorOpen(false);
        } else {
          const current = useExplorerStore.getState();
          if (current.sessions.length > 0) {
            if (
              state.manifestExplorer === true &&
              typeof state.sessionId === 'string' &&
              typeof state.historyIndex === 'number'
            ) {
              restoreHistoryPoint(state.sessionId, state.historyIndex);
            }
            setMobileInspectorOpen(true);
          } else {
            hydrateFromHashUrl(currentHash);
          }
        }

        // Keep the popstate guard active past Chromium's trailing hashchange.
        popTimer = window.setTimeout(() => {
          popTimer = null;
          applyingPopStateRef.current = false;
        }, 50);
        return;
      }

      let restored = false;
      if (
        state &&
        state.manifestExplorer === true &&
        typeof state.sessionId === 'string' &&
        typeof state.historyIndex === 'number'
      ) {
        restored = restoreHistoryPoint(state.sessionId, state.historyIndex);
      }

      if (!restored) {
        hydrateFromHashUrl(currentHash);
      }

      // Keep popstate guard active past Chromium's trailing macrotask hashchange event.
      popTimer = window.setTimeout(() => {
        popTimer = null;
        applyingPopStateRef.current = false;
      }, 50);
    };

    const onHashChange = (): void => {
      if (
        window.location.pathname === '/history' ||
        window.location.pathname.startsWith('/history/') ||
        syncingHashRef.current ||
        applyingPopStateRef.current ||
        window.location.hash === lastHandledHashRef.current
      ) {
        return;
      }
      lastHandledHashRef.current = window.location.hash;
      hydrateFromHashUrl(window.location.hash);
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      if (popTimer !== null) {
        window.clearTimeout(popTimer);
      }
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [
    isHistoryRoute,
    hydrateFromHashUrl,
    restoreHistoryPoint,
    setMobileInspectorOpen,
    syncBrowserHistory,
  ]);

  // Keep URL hash synchronized without clobbering pushed tab history entries
  useEffect(() => {
    if (isHistoryRoute) return;
    if (applyingPopStateRef.current) {
      return;
    }
    const nextHash = buildHashUrl();
    if (window.location.hash !== nextHash) {
      syncBrowserHistory('replace');
    }
  }, [
    isHistoryRoute,
    sessions,
    activeSessionIndex,
    history,
    historyIndex,
    deepSearch,
    filters.table,
    filters.unnamedMode,
    isNarrowLayout,
    mobileInspectorOpen,
    buildHashUrl,
    syncBrowserHistory,
  ]);

  // Keep query keystrokes out of App's render cycle. Only publish a debounced
  // query to React; URL synchronization can use the store's latest snapshot.
  const [debouncedQuery, setDebouncedQuery] = useState(
    () => useExplorerStore.getState().query,
  );
  useEffect(() => {
    const initialQuery = useExplorerStore.getState().query;
    setDebouncedQuery((current) =>
      current === initialQuery ? current : initialQuery,
    );
    let timer: number | null = null;
    const unsubscribe = useExplorerStore.subscribe((state, previousState) => {
      if (
        state.query !== previousState.query ||
        state.deepSearch !== previousState.deepSearch
      ) {
        setResultLimit(
          initialResultLimit(
            state.deepSearch || /^deep:/i.test(state.query.trim()),
          ),
        );
        setLoadingMore(false);
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        const trimmed = state.query.trim();
        if (state.query.length === 0) {
          setDebouncedQuery(state.query);
        } else {
          const isDeepQuery = state.deepSearch || /^deep:/i.test(trimmed);
          timer = window.setTimeout(
            () => setDebouncedQuery(state.query),
            isDeepQuery ? 450 : 280,
          );
        }
      }
      if (state.query !== previousState.query) {
        syncBrowserHistory('replace');
      }
    });
    return () => {
      unsubscribe();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [syncBrowserHistory]);

  // Worker subscriptions + boot
  const bootManifest = useCallback(
    (targetLocale: BungieLocale, apiKey: string, forceRefresh = false) => {
      void manifestClient
        .init(targetLocale, apiKey.trim() || undefined, forceRefresh)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Failed to load manifest.';
          setManifestStatus({ phase: 'error', error: msg });
          pushNotice({ tone: 'danger', message: msg });
        });
    },
    [pushNotice, setManifestStatus],
  );

  useEffect(() => {
    const unsubStatus = manifestClient.onStatus((status) => {
      if (lastManifestVersionRef.current !== status.versionSignature) {
        lastManifestVersionRef.current = status.versionSignature;
        clearInspectorCaches();
      }
      setManifestStatus(status);
    });
    const unsubTables = manifestClient.onTables((tables) => {
      setTables(tables);
    });
    const unsubCatalog = manifestClient.onCatalog((catalog) => {
      setFilterCatalog(catalog);
    });
    return () => {
      unsubStatus();
      unsubTables();
      unsubCatalog();
    };
  }, [setManifestStatus, setTables, setFilterCatalog]);

  useEffect(() => {
    bootManifest(locale, bungieApiKey, false);
  }, [locale, bungieApiKey, bootManifest]);

  useEffect(
    () => startAppUpdateWatcher(markAppUpdateAvailable),
    [markAppUpdateAvailable],
  );

  const manifestReady =
    manifestStatus.locale === locale &&
    (manifestStatus.indexedEntryCount > 0 || manifestStatus.phase === 'ready');

  useLayoutEffect(() => {
    if (lastManifestVersionRef.current === manifestStatus.versionSignature) {
      return;
    }
    lastManifestVersionRef.current = manifestStatus.versionSignature;
    clearInspectorCaches();
  }, [manifestStatus.versionSignature]);

  // Background-resolve display names, icons & co-table flags for EVERY open tab
  // and EVERY history/future entry (including inactive tabs and hydrated URLs).
  // Re-runs when new tables finish loading so co-table disambiguation stays accurate.
  const sessionRefSignature = sessions
    .map((s) => s.history.map((e) => `${e.table}:${e.hash}`).join(','))
    .join('|');

  useEffect(() => {
    if (!manifestReady || !sessionRefSignature) {
      return;
    }
    const currentSessions = useExplorerStore.getState().sessions;
    const refsMap = new Map<string, { table: string; hash: number }>();
    for (const session of currentSessions) {
      for (const entry of session.history) {
        const key = `${entry.table}:${entry.hash}`;
        if (!refsMap.has(key)) {
          refsMap.set(key, { table: entry.table, hash: entry.hash });
        }
      }
    }
    if (refsMap.size === 0) {
      return;
    }
    let cancelled = false;
    void manifestClient
      .resolveSummaries([...refsMap.values()])
      .then((summaries) => {
        if (!cancelled && Object.keys(summaries).length > 0) {
          hydrateEntrySummaries(summaries);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    sessionRefSignature,
    manifestReady,
    manifestStatus.loadedTableCount,
    hydrateEntrySummaries,
  ]);

  // Run search whenever debouncedQuery, deepSearch, filters, sort, fuzzy
  // settings, query logic, or indexed entry count changes
  useEffect(() => {
    const baseSearchKey = `${debouncedQuery}|${deepSearch ? '1' : '0'}|${sortMode}|${JSON.stringify(filters)}|${fuzzySearch ? '1' : '0'}|${queryPrecedence}`;
    const searchKey = `${baseSearchKey}|${fuzziness}`;
    const baseChanged = baseSearchKey !== lastBaseKeyRef.current;
    lastBaseKeyRef.current = baseSearchKey;
    const trimmed = debouncedQuery.trim();
    const hasDeepPrefix = /^deep:/i.test(trimmed);
    const useDeep = (deepSearch || hasDeepPrefix) && trimmed.length > 0;
    const initialLimit = initialResultLimit(useDeep);
    const limitSearchKeyChanged = searchKey !== lastLimitSearchKeyRef.current;
    const seq = ++searchSeqRef.current;

    if (limitSearchKeyChanged) {
      lastLimitSearchKeyRef.current = searchKey;
      if (resultLimit !== initialLimit) {
        setResultLimit(initialLimit);
        setLoadingMore(false);
        return;
      }
      setLoadingMore(false);
    }

    const limitChanged = resultLimit !== lastResultLimitRef.current;
    lastResultLimitRef.current = resultLimit;

    if (
      manifestStatus.locale !== locale ||
      (manifestStatus.indexedEntryCount === 0 && manifestStatus.phase !== 'ready')
    ) {
      return;
    }

    // The raw query can be ahead of its debounced search value. Do not issue a
    // second search for the previous query just because its result limit reset.
    if (useExplorerStore.getState().query !== debouncedQuery) {
      return;
    }

    const isLimitExpansion = resultLimit > initialLimit;
    const isBackgroundIndexRefresh =
      !limitChanged && searchKey === lastSearchKeyRef.current;
    const effectiveDeepQuery = hasDeepPrefix
      ? trimmed.replace(/^deep:\s*/i, '').trim()
      : trimmed;

    // Debounce only fuzziness-slider drags (~120ms) so it feels smooth; toggle
    // and every other change (query/filters/sort) runs immediately.
    const delay = isLimitExpansion
      ? 0
      : isBackgroundIndexRefresh
        ? 500
        : baseChanged || limitChanged
          ? 0
          : 120;

    const timer = window.setTimeout(() => {
      lastSearchKeyRef.current = searchKey;
      if (!isLimitExpansion && !isBackgroundIndexRefresh) {
        setSearching(true);
      }

      const activeLimit = limitSearchKeyChanged ? initialLimit : resultLimit;
      const promise =
        useDeep && effectiveDeepQuery.length > 0
          ? manifestClient.deepSearch(effectiveDeepQuery, filters, activeLimit)
          : manifestClient.search(
              debouncedQuery,
              filters,
              sortMode,
              activeLimit,
              fuzzySearch ? { enabled: true, threshold: fuzziness } : undefined,
              queryPrecedence,
            );

      void promise
        .then((res) => {
          if (seq !== searchSeqRef.current) {
            return;
          }
          setSearchResults(
            res.items,
            res.totalMatches,
            res.durationMs,
            isBackgroundIndexRefresh || isLimitExpansion,
            res.hiddenUnnamedCount,
            res.scopeEntryCount,
          );
          setLoadingMore(false);
        })
        .catch(() => {
          if (seq === searchSeqRef.current) {
            setSearching(false);
            setLoadingMore(false);
          }
        });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    debouncedQuery,
    deepSearch,
    filters,
    sortMode,
    fuzzySearch,
    fuzziness,
    queryPrecedence,
    resultLimit,
    locale,
    manifestStatus.indexedEntryCount,
    manifestStatus.phase,
    setSearchResults,
    setSearching,
  ]);

  const isDeepSearchActive =
    deepSearch || /^deep:/i.test(debouncedQuery.trim());
  const loadMoreStep = isDeepSearchActive ? 1000 : 10_000;

  const handleLoadMore = useCallback(() => {
    if (
      loadingMore ||
      useExplorerStore.getState().searching ||
      useExplorerStore.getState().query !== debouncedQuery ||
      resultLimit >= totalMatches
    ) {
      return;
    }
    const nextLimit = Math.min(totalMatches, resultLimit + loadMoreStep);
    if (nextLimit <= resultLimit) return;
    setLoadingMore(true);
    setResultLimit(nextLimit);
  }, [debouncedQuery, loadMoreStep, loadingMore, resultLimit, totalMatches]);

  const handleLoadAll = useCallback(() => {
    if (
      loadingMore ||
      useExplorerStore.getState().searching ||
      useExplorerStore.getState().query !== debouncedQuery ||
      resultLimit >= totalMatches
    ) {
      return;
    }
    setLoadingMore(true);
    setResultLimit(totalMatches);
  }, [debouncedQuery, loadingMore, resultLimit, totalMatches]);

  // Load selected definition progressively (instant cached/Lite -> full upgrade).
  const loadFullForCurrent = useCallback(
    (ref: DefinitionRef, seq: number) => {
      const cached = detailCache.get(cacheKey(ref.table, ref.hash));
      if (cached && !cached.isLite) {
        if (seq === detailSeqRef.current) {
          setDetail(cached);
          setDetailLoading(false);
          setLoadingFull(false);
        }
        return;
      }

      setLoadingFull(true);
      void manifestClient
        .getDefinition(ref.table, ref.hash, true)
        .then(async (payload) => {
          let full = cacheDefinition(payload);
          if (full.isLite) {
            // A preferred-full lookup can return its Lite fallback while the
            // item table is still streaming in the manifest worker. Wait for
            // that shared table load, then re-read the definition so this
            // inspector does not stay in a permanent “Loading full…” state.
            await manifestClient.loadTable(ref.table);
            full = cacheDefinition(
              await manifestClient.getDefinition(ref.table, ref.hash, true),
            );
          }
          if (seq !== detailSeqRef.current) {
            return;
          }
          setDetail(full);
          setDetailLoading(false);
          setLoadingFull(Boolean(full.isLite));
        })
        .catch(() => {
          if (seq === detailSeqRef.current) {
            setLoadingFull(false);
          }
        });
    },
    [],
  );

  useLayoutEffect(() => {
    const seq = ++detailSeqRef.current;
    if (!currentRef) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setLoadingFull(false);
      setReferences(null);
      setReferencesLoading(false);
      setClarityEntry(null);
      setClarityLoading(false);
      return;
    }

    const key = cacheKey(currentRef.table, currentRef.hash);
    const cached = detailCache.get(key);
    setDetailError(null);
    setReferences(null);
    setReferencesLoading(false);

    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      setLoadingFull(Boolean(cached.isLite && manifestReady));
      const dp = cached.data.displayProperties as
        | { name?: string; icon?: string }
        | undefined;
      const resolvedName =
        (typeof dp?.name === 'string' && dp.name.trim()) ||
        (typeof cached.data.statName === 'string' && cached.data.statName.trim()) ||
        (typeof cached.data.progressDescription === 'string' &&
          cached.data.progressDescription.trim()) ||
        '';
      updateEntryMeta(cached.table, cached.hash, {
        ...(resolvedName ? { label: resolvedName } : {}),
        ...(typeof dp?.icon === 'string' ? { icon: dp.icon } : {}),
        hasCoTables: cached.coTables.length > 0,
      });
      if (cached.isLite && manifestReady) {
        loadFullForCurrent(currentRef, seq);
      }
    } else {
      setDetail(null);
      setDetailLoading(true);
      setLoadingFull(false);
    }

    const clarityRelevant =
      currentRef.table === 'DestinyInventoryItemDefinition' ||
      currentRef.table === 'DestinySandboxPerkDefinition';
    if (showClarityDescriptions && clarityRelevant) {
      const cachedClarity = clarityCache.get(key);
      if (cachedClarity !== undefined) {
        setClarityEntry(cachedClarity);
        setClarityLoading(false);
      } else if (manifestReady) {
        setClarityEntry(null);
        setClarityLoading(true);
        void manifestClient
          .getClarityDescription(currentRef.hash)
          .then((entry) => {
            const value = entry ?? null;
            clarityCache.set(key, value);
            if (seq === detailSeqRef.current) {
              setClarityEntry(value);
              setClarityLoading(false);
            }
          })
          .catch(() => {
            if (seq === detailSeqRef.current) {
              setClarityLoading(false);
            }
          });
      } else {
        setClarityEntry(null);
        setClarityLoading(false);
      }
    } else {
      setClarityEntry(null);
      setClarityLoading(false);
    }

    if (cached || !manifestReady) {
      return;
    }

    void manifestClient
      .getDefinition(currentRef.table, currentRef.hash, false)
      .then((payload) => {
        const resolved = cacheDefinition(payload);
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetail(resolved);
        setDetailLoading(false);
        const dp = resolved.data.displayProperties as
          | { name?: string; icon?: string }
          | undefined;
        const resolvedName =
          (typeof dp?.name === 'string' && dp.name.trim()) ||
          (typeof resolved.data.statName === 'string' &&
            resolved.data.statName.trim()) ||
          (typeof resolved.data.progressDescription === 'string' &&
            resolved.data.progressDescription.trim()) ||
          '';
        updateEntryMeta(resolved.table, resolved.hash, {
          ...(resolvedName ? { label: resolvedName } : {}),
          ...(typeof dp?.icon === 'string' ? { icon: dp.icon } : {}),
          hasCoTables: resolved.coTables.length > 0,
        });
        if (resolved.isLite) {
          loadFullForCurrent(currentRef, seq);
        }
      })
      .catch((err: unknown) => {
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetail(null);
        setDetailLoading(false);
        setDetailError(
          err instanceof Error ? err.message : 'Unable to load this definition.',
        );
      });
  }, [
    currentRef?.table,
    currentRef?.hash,
    locale,
    manifestReady,
    manifestStatus.versionSignature,
    showClarityDescriptions,
    detailReloadCounter,
    loadFullForCurrent,
    updateEntryMeta,
  ]);

  // Variants are deliberately scanned only when their sub-tab is selected.
  useLayoutEffect(() => {
    if (!currentRef) {
      setVariants([]);
      setVariantsLoading(false);
      return;
    }

    const key = cacheKey(currentRef.table, currentRef.hash);
    const cached = variantsCache.get(key);
    if (cached !== undefined) {
      setVariants(cached);
      setVariantsLoading(false);
      return;
    }

    setVariants([]);
    if (activeTab !== 'variants' || !manifestReady) {
      setVariantsLoading(false);
      return;
    }

    let cancelled = false;
    setVariantsLoading(true);
    void manifestClient
      .getVariants(currentRef.table, currentRef.hash)
      .then((list) => {
        variantsCache.set(key, list);
        if (!cancelled) {
          setVariants(list);
          setVariantsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVariants([]);
          setVariantsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentRef?.table,
    currentRef?.hash,
    locale,
    activeTab,
    manifestReady,
    manifestStatus.versionSignature,
    detailReloadCounter,
  ]);

  // Reverse references use stale-while-revalidate as additional tables load.
  useLayoutEffect(() => {
    if (!currentRef) {
      setReferences(null);
      setReferencesLoading(false);
      return;
    }
    if (activeTab !== 'references') {
      setReferences(null);
      setReferencesLoading(false);
      return;
    }

    const key = cacheKey(currentRef.table, currentRef.hash);
    const cached = referencesCache.get(key);
    if (cached) {
      setReferences(cached.data);
      setReferencesLoading(false);
      if (
        cached.loadedTableCount === manifestStatus.loadedTableCount ||
        !manifestReady
      ) {
        return;
      }
    } else {
      setReferences(null);
      if (!manifestReady) {
        setReferencesLoading(false);
        return;
      }
      setReferencesLoading(true);
    }

    let cancelled = false;
    const loadedTableCount = manifestStatus.loadedTableCount;
    void manifestClient
      .getReverseReferences(currentRef.hash, currentRef.table)
      .then((data) => {
        referencesCache.set(key, { data, loadedTableCount });
        if (!cancelled) {
          setReferences(data);
          setReferencesLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReferencesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentRef?.table,
    currentRef?.hash,
    locale,
    activeTab,
    manifestStatus.loadedTableCount,
    manifestStatus.versionSignature,
    manifestReady,
    refReloadCounter,
    detailReloadCounter,
  ]);

  // A pinned baseline reuses full details from the same bounded detail cache.
  useLayoutEffect(() => {
    if (!pinnedDiffRef) {
      setPinnedDetail(null);
      setPinnedLoading(false);
      return;
    }
    const key = cacheKey(pinnedDiffRef.table, pinnedDiffRef.hash);
    const cached = detailCache.get(key);
    if (cached && !cached.isLite) {
      setPinnedDetail(cached);
      setPinnedLoading(false);
      return;
    }
    if (!manifestReady) {
      setPinnedDetail(cached ?? null);
      setPinnedLoading(false);
      return;
    }

    let cancelled = false;
    setPinnedDetail(cached ?? null);
    setPinnedLoading(true);
    void manifestClient
      .getDefinition(pinnedDiffRef.table, pinnedDiffRef.hash, true)
      .then((payload) => {
        const full = cacheDefinition(payload);
        if (!cancelled) {
          setPinnedDetail(full);
          setPinnedLoading(Boolean(full.isLite));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPinnedLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    pinnedDiffRef?.table,
    pinnedDiffRef?.hash,
    locale,
    manifestReady,
    manifestStatus.versionSignature,
  ]);

  // Actions
  const handleSelectTable = useCallback(
    (table: string) => {
      setTableFilter(table);
      if (table !== 'all') {
        const status = useExplorerStore
          .getState()
          .tables.find((t) => t.name === table);
        if (status && !status.loaded && !status.loading) {
          void manifestClient.loadTable(table).catch((err: unknown) => {
            pushNotice({
              tone: 'danger',
              message:
                err instanceof Error
                  ? err.message
                  : `Failed to load ${getShortTableName(table)}.`,
            });
          });
        }
      }
    },
    [pushNotice, setTableFilter],
  );

  const handleLoadTable = useCallback(
    (table: string) => {
      void manifestClient
        .loadTable(table)
        .then(() => {
          setRefReloadCounter((c) => c + 1);
          pushNotice({
            tone: 'info',
            message: `Loaded ${getShortTableName(table)}`,
          });
        })
        .catch((err: unknown) => {
          pushNotice({
            tone: 'danger',
            message:
              err instanceof Error
                ? err.message
                : `Failed to load ${getShortTableName(table)}.`,
          });
        });
    },
    [pushNotice],
  );

  const handleLoadAllTables = useCallback(() => {
    pushNotice({ tone: 'info', message: 'Loading remaining manifest tables…' });
    void manifestClient
      .loadAllTables()
      .then(() => {
        setRefReloadCounter((c) => c + 1);
        pushNotice({ tone: 'info', message: 'Loaded all manifest tables' });
      })
      .catch((err: unknown) => {
        pushNotice({
          tone: 'danger',
          message:
            err instanceof Error ? err.message : 'Failed loading all manifest tables.',
        });
      });
  }, [pushNotice]);

  const handleCheckUpdates = useCallback(() => {
    void checkForAppUpdate().then((result) => {
      if (result.updateAvailable && result.latestBuildId) {
        markAppUpdateAvailable(result.latestBuildId);
      }
    });

    void manifestClient
      .checkForUpdates()
      .then((res) => {
        if (res.error) {
          pushNotice({ tone: 'warn', message: res.error });
        } else if (res.hasUpdate) {
          pushNotice({
            tone: 'info',
            message: 'New Destiny 2 manifest version available',
            actionLabel: 'Update now',
            onAction: () => bootManifest(locale, bungieApiKey, true),
          });
        } else {
          const currentVer = useExplorerStore.getState().manifestStatus.version;
          pushNotice({
            tone: 'info',
            message: `Manifest is up to date${currentVer ? ` (${currentVer})` : ''}`,
          });
        }
      })
      .catch((err: unknown) => {
        pushNotice({
          tone: 'warn',
          message: err instanceof Error ? err.message : 'Update check failed.',
        });
      });
  }, [bootManifest, bungieApiKey, locale, markAppUpdateAvailable, pushNotice]);

  const handleReloadApp = useCallback(() => {
    // Reloading the current document naturally retains its URL hash.
    window.location.reload();
  }, []);

  const handleOpenChangelog = useCallback(() => {
    const latestVersion = getLatestChangelogVersion();
    setChangelogState({
      shouldAutoOpen: false,
      expandedVersions: latestVersion ? [latestVersion] : [],
      unseenVersions: [],
    });
    setChangelogOpen(true);
  }, []);

  const handleCloseChangelog = useCallback(() => {
    const latestVersion = getLatestChangelogVersion();
    if (latestVersion) {
      writeLastSeenChangelogVersion(latestVersion);
    }
    setChangelogState((state) => ({ ...state, unseenVersions: [] }));
    setChangelogOpen(false);
  }, []);

  const handleClearCache = useCallback(() => {
    clearInspectorCaches();
    void manifestClient
      .clearCache()
      .then(() => {
        pushNotice({ tone: 'info', message: 'Cleared manifest cache' });
        bootManifest(locale, bungieApiKey, true);
      })
      .catch(() => {
        pushNotice({ tone: 'danger', message: 'Failed to clear cache.' });
      });
  }, [bootManifest, bungieApiKey, locale, pushNotice]);

  const handleLocaleChange = useCallback(
    (nextLocale: BungieLocale) => {
      clearInspectorCaches();
      setLocale(nextLocale);
      pushNotice({ tone: 'info', message: `Switched language to ${nextLocale}` });
    },
    [pushNotice, setLocale],
  );

  const handleOpenResult = useCallback(
    (item: SearchResultItem) => {
      const collector = useCollectorStore.getState();
      if (collector.collectMode) {
        const existed = collector.hasItem(item.table, item.hash);
        collector.toggleItem({
          table: item.table,
          hash: item.hash,
          name: item.name,
          subtitle: item.subtitle,
          icon: item.icon,
        });
        pushNotice({
          tone: 'info',
          message: existed
            ? `Removed ${item.name || item.hash}`
            : `Collected ${item.name || item.hash}`,
        });
        return;
      }

      const wasMobileInspectorOpen = useExplorerStore.getState().mobileInspectorOpen;
      flushActiveInspectorDomScroll();
      const rawFilter = item.deepMatch
        ? useExplorerStore.getState().query.trim().replace(/^deep:\s*/i, '').trim()
        : undefined;

      // Clicking any entry in the searchable results pane always opens a new tab on Pretty.
      openInNewTab(
        {
          table: item.table,
          hash: item.hash,
          label: item.name || undefined,
          icon: item.icon,
        },
        true,
        rawFilter && rawFilter.length > 0 ? rawFilter : undefined,
      );
      syncBrowserHistory(
        isNarrowLayout && !wasMobileInspectorOpen ? 'push' : 'replace',
      );
    },
    [isNarrowLayout, openInNewTab, pushNotice, syncBrowserHistory],
  );

  const handleNavigateRef = useCallback(
    (ref: DefinitionRef, inNewTab = false) => {
      flushActiveInspectorDomScroll();

      if (inNewTab) {
        openInNewTab(ref, true);
        syncBrowserHistory('replace');
        return;
      }

      const prevState = useExplorerStore.getState();
      const prevActive =
        prevState.activeSessionIndex >= 0
          ? prevState.sessions[prevState.activeSessionIndex]
          : undefined;
      const prevHistoryIndex = prevActive?.historyIndex ?? -1;

      if (prevActive) {
        const curHist = window.history.state as Partial<HistoryTabState> | null;
        if (
          !curHist?.manifestExplorer ||
          curHist.sessionId !== prevActive.id ||
          curHist.historyIndex !== prevActive.historyIndex
        ) {
          syncBrowserHistory('replace');
        }
      }

      navigateInTab(ref);

      const nextState = useExplorerStore.getState();
      const nextActive =
        nextState.activeSessionIndex >= 0
          ? nextState.sessions[nextState.activeSessionIndex]
          : undefined;

      if (
        !isNarrowLayout &&
        nextActive &&
        prevActive &&
        nextActive.id === prevActive.id &&
        nextActive.historyIndex !== prevHistoryIndex
      ) {
        syncBrowserHistory('push');
      } else {
        syncBrowserHistory('replace');
      }
    },
    [isNarrowLayout, navigateInTab, openInNewTab, syncBrowserHistory],
  );

  // Unified Back / Forward / Timeline Jump — keeps browser history cursor in lockstep
  const handleJumpToHistoryIndex = useCallback(
    (targetIdx: number) => {
      const st = useExplorerStore.getState();
      const active =
        st.activeSessionIndex >= 0 ? st.sessions[st.activeSessionIndex] : undefined;
      if (
        !active ||
        targetIdx < 0 ||
        targetIdx >= active.history.length ||
        targetIdx === active.historyIndex
      ) {
        return;
      }

      flushActiveInspectorDomScroll();

      if (isNarrowLayout) {
        if (jumpToHistoryIndex(targetIdx)) {
          syncBrowserHistory('replace');
        }
        return;
      }

      const curHist = window.history.state as Partial<HistoryTabState> | null;
      const maxPushed = maxPushedBySessionRef.current.get(active.id) ?? -1;
      if (
        curHist?.manifestExplorer &&
        curHist.sessionId === active.id &&
        curHist.historyIndex === active.historyIndex &&
        targetIdx <= maxPushed
      ) {
        window.history.go(targetIdx - active.historyIndex);
        return;
      }

      if (jumpToHistoryIndex(targetIdx)) {
        syncBrowserHistory('replace');
      }
    },
    [isNarrowLayout, jumpToHistoryIndex, syncBrowserHistory],
  );

  const handleNavigateBack = useCallback(() => {
    const st = useExplorerStore.getState();
    const active =
      st.activeSessionIndex >= 0 ? st.sessions[st.activeSessionIndex] : undefined;
    if (!active || active.historyIndex <= 0) {
      return;
    }
    handleJumpToHistoryIndex(active.historyIndex - 1);
  }, [handleJumpToHistoryIndex]);

  const handleNavigateForward = useCallback(() => {
    const st = useExplorerStore.getState();
    const active =
      st.activeSessionIndex >= 0 ? st.sessions[st.activeSessionIndex] : undefined;
    if (!active || active.historyIndex >= active.history.length - 1) {
      return;
    }
    handleJumpToHistoryIndex(active.historyIndex + 1);
  }, [handleJumpToHistoryIndex]);

  const handleOpenHelp = useCallback(() => setHelpOpen(true), []);
  const handleRetryBoot = useCallback(
    () => bootManifest(locale, bungieApiKey, true),
    [bootManifest, bungieApiKey, locale],
  );
  const handleLoadFullItem = useCallback(() => {
    if (currentRef) {
      loadFullForCurrent(currentRef, detailSeqRef.current);
    }
  }, [currentRef, loadFullForCurrent]);
  const handleRetryDetail = useCallback(() => {
    if (currentRef) {
      evictInspectorEntry(currentRef.table, currentRef.hash);
    }
    setDetailReloadCounter((count) => count + 1);
  }, [currentRef]);
  const handleToggleRail = useCallback(() => toggleRail(), [toggleRail]);
  const handleRailResize = useCallback((width: number) => setRailWidth(width), [setRailWidth]);
  const handleInspectorResize = useCallback(
    (width: number) => setInspectorWidth(width),
    [setInspectorWidth],
  );

  const handleSwitchSession = useCallback(
    (index: number) => {
      flushActiveInspectorDomScroll();
      switchSession(index);
      syncBrowserHistory('replace');
    },
    [switchSession, syncBrowserHistory],
  );

  // Global keyboard shortcuts (capture phase so '/' reliably jumps to search without typing '/')
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        handleNavigateBack();
        return;
      }

      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        handleNavigateForward();
        return;
      }

      if (event.altKey && event.key.toLowerCase() === 'w' && currentRef) {
        event.preventDefault();
        if (sessionsCount > 1) {
          closeSession(activeSessionIndex);
        } else {
          closeInspector();
        }
        return;
      }

      if (
        (event.key === '/' || event.code === 'NumpadDivide') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isTextInputTarget(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        // Focus on the next frame so the browser never delivers '/' as text input.
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      if (isEditableTarget(event.target)) {
        if (event.key === 'Escape') {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      if (event.key === '?' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setHelpOpen((prev) => !prev);
        return;
      }

      if (event.key === 'Escape') {
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (document.querySelector('[role="dialog"]')) {
          return;
        }
        if (currentRef) {
          closeInspector();
        }
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'j') {
        if (results.length > 0) {
          event.preventDefault();
          setSelectedResultIndex(selectedResultIndex + 1);
        }
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'k') {
        if (results.length > 0) {
          event.preventDefault();
          setSelectedResultIndex(selectedResultIndex - 1);
        }
        return;
      }

      if (event.key === 'Enter' && results[selectedResultIndex]) {
        event.preventDefault();
        handleOpenResult(results[selectedResultIndex]!);
        return;
      }

      if (currentRef && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const digit = Number(event.key);
        if (digit >= 1 && digit <= TAB_KEYS.length) {
          const tab = TAB_KEYS[digit - 1];
          if (tab) {
            event.preventDefault();
            flushActiveInspectorDomScroll();
            setActiveTab(tab);
            return;
          }
        }

        if (event.key === 'c') {
          event.preventDefault();
          void navigator.clipboard
            .writeText(String(currentRef.hash))
            .then(() =>
              pushNotice({ tone: 'info', message: `Copied hash ${currentRef.hash}` }),
            );
          return;
        }

        if (event.key === 'C' && detail) {
          event.preventDefault();
          void navigator.clipboard
            .writeText(JSON.stringify(detail.data, null, 2))
            .then(() => pushNotice({ tone: 'info', message: 'Copied definition JSON' }));
          return;
        }

        if (event.key === 'a' && detail) {
          event.preventDefault();
          const dp = detail.data.displayProperties as
            | { name?: string; icon?: string }
            | undefined;
          const name = dp?.name || `${getShortTableName(currentRef.table)} ${currentRef.hash}`;
          const col = useCollectorStore.getState();
          const existed = col.hasItem(currentRef.table, currentRef.hash);
          col.toggleItem({
            table: currentRef.table,
            hash: currentRef.hash,
            name,
            subtitle: getShortTableName(currentRef.table),
            icon: dp?.icon,
          });
          pushNotice({
            tone: 'info',
            message: existed ? 'Removed from collector' : 'Added to collector',
          });
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    activeSessionIndex,
    closeInspector,
    closeSession,
    currentRef,
    detail,
    handleNavigateBack,
    handleNavigateForward,
    handleOpenResult,
    helpOpen,
    pushNotice,
    results,
    selectedResultIndex,
    sessionsCount,
    setActiveTab,
    setSelectedResultIndex,
  ]);

  return (
    <div className={styles.shell}>
      <Header
        searchInputRef={searchInputRef}
        activePage={isHistoryRoute ? 'history' : 'explorer'}
        onNavigatePage={navigatePage}
        onCheckUpdates={handleCheckUpdates}
        onClearCache={handleClearCache}
        onLoadAllTables={handleLoadAllTables}
        onOpenHelp={handleOpenHelp}
        onOpenChangelog={handleOpenChangelog}
        onLocaleChange={handleLocaleChange}
        onSelectTable={handleSelectTable}
      />

      {appUpdateAvailable && !appUpdateDismissed && (
        <section className={styles.updateNotice} role="status" aria-live="polite">
          <p className={styles.updateNoticeMessage}>
            A new version of Manifest Explorer is available.
          </p>
          <button
            type="button"
            className={styles.updateReload}
            onClick={handleReloadApp}
          >
            Reload now
          </button>
          <button
            type="button"
            className={styles.updateDismiss}
            onClick={() => setAppUpdateDismissed(true)}
            aria-label="Dismiss update notice"
          >
            Dismiss
          </button>
        </section>
      )}

      <main className={styles.workspace}>
        {isHistoryRoute ? (
          <ManifestHistoryPage
            versionIndex={historyVersionIndex}
            onSelectVersion={selectHistoryVersion}
            onNavigateExplorer={navigateExplorerDefinition}
          />
        ) : (
          <>
            <TableRail
              width={railWidth}
              collapsed={railCollapsed}
              onToggleCollapse={handleToggleRail}
              onResize={handleRailResize}
              onSelectTable={handleSelectTable}
              onLoadTable={handleLoadTable}
              onLoadAllTables={handleLoadAllTables}
            />

            {(isNarrowLayout
              ? !mobileInspectorOpen
              : !inspectorMaximized) && (
              <ResultsPane
                onOpenItem={handleOpenResult}
                onRetryBoot={handleRetryBoot}
                onLoadMore={handleLoadMore}
                onLoadAll={handleLoadAll}
                loadMoreStep={loadMoreStep}
                loadingMore={loadingMore}
                hiddenUnnamedCount={hiddenUnnamedCount}
                scopeEntryCount={scopeEntryCount}
              />
            )}

            {currentRef && (!isNarrowLayout || mobileInspectorOpen) && (
              <DefinitionInspector
                width={inspectorWidth}
                onResize={handleInspectorResize}
                currentRef={currentRef}
                detail={detail}
                loading={detailLoading}
                loadingFull={loadingFull}
                error={detailError}
                variants={variants}
                variantsLoading={variantsLoading}
                references={references}
                referencesLoading={referencesLoading}
                pinnedDetail={pinnedDetail}
                pinnedLoading={pinnedLoading}
                clarityEntry={clarityEntry}
                clarityLoading={clarityLoading}
                showClarity={showClarityDescriptions}
                onNavigateRef={handleNavigateRef}
                onNavigateBack={handleNavigateBack}
                onNavigateForward={handleNavigateForward}
                onJumpToHistoryIndex={handleJumpToHistoryIndex}
                onSwitchSession={handleSwitchSession}
                onLoadFullItem={handleLoadFullItem}
                onLoadPriorityTable={handleLoadTable}
                onRetry={handleRetryDetail}
              />
            )}
          </>
        )}
      </main>

      <StatusBar
        onCheckUpdates={handleCheckUpdates}
        onOpenHelp={handleOpenHelp}
        appUpdateAvailable={appUpdateAvailable}
        onReloadApp={handleReloadApp}
        onOpenChangelog={handleOpenChangelog}
        hasUnseenChangelog={changelogState.unseenVersions.length > 0}
      />

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ChangelogDialog
        open={changelogOpen}
        onClose={handleCloseChangelog}
        entries={CHANGELOG}
        expandedVersions={changelogState.expandedVersions}
        unseenVersions={changelogState.unseenVersions}
      />
      <NoticeStrip />
    </div>
  );
}
