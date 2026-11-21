import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  BungieLocale,
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  DefinitionRef,
  InspectorTab,
  ReverseReferenceResponse,
  SearchResultItem,
  VariantItem,
} from './types/manifest';
import * as manifestClient from './manifest/client';
import { getShortTableName } from './manifest/tables';
import { useCollectorStore } from './stores/collector';
import { useExplorerStore } from './stores/explorer';
import { useSettingsStore } from './stores/settings';
import { Header } from './components/Header';
import { HelpDialog } from './components/HelpDialog';
import { ResultsPane } from './components/ResultsPane';
import { StatusBar } from './components/StatusBar';
import { TableRail } from './components/TableRail';
import { DefinitionInspector } from './components/inspector/DefinitionInspector';
import { NoticeStrip } from './ui/NoticeStrip';
import styles from './App.module.scss';

const TAB_KEYS: readonly InspectorTab[] = [
  'pretty',
  'overview',
  'variants',
  'references',
  'raw',
  'diff',
];

interface HistoryTabState {
  manifestExplorer: true;
  sessionId: string;
  historyIndex: number;
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

function flushActiveInspectorDomScroll(): void {
  const scroller = document.querySelector<HTMLElement>(
    'aside[aria-label="Definition inspector"] [data-inspector-scroll="true"]',
  );
  if (!scroller) return;
  const st = useExplorerStore.getState();
  st.saveEntryScroll(st.activeTab, scroller.scrollTop);
}

export function App(): ReactNode {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const syncingHashRef = useRef(false);
  const applyingPopStateRef = useRef(false);
  const lastHandledHashRef = useRef('');
  const lastSearchKeyRef = useRef('');
  const maxPushedBySessionRef = useRef(new Map<string, number>());

  const [helpOpen, setHelpOpen] = useState(false);

  // Settings
  const locale = useSettingsStore((s) => s.locale);
  const bungieApiKey = useSettingsStore((s) => s.bungieApiKey);
  const showClarityDescriptions = useSettingsStore((s) => s.showClarityDescriptions);
  const sortMode = useSettingsStore((s) => s.sortMode);
  const railCollapsed = useSettingsStore((s) => s.railCollapsed);
  const railWidth = useSettingsStore((s) => s.railWidth);
  const inspectorWidth = useSettingsStore((s) => s.inspectorWidth);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const toggleRail = useSettingsStore((s) => s.toggleRail);
  const setRailWidth = useSettingsStore((s) => s.setRailWidth);
  const setInspectorWidth = useSettingsStore((s) => s.setInspectorWidth);

  // Explorer state
  const query = useExplorerStore((s) => s.query);
  const deepSearch = useExplorerStore((s) => s.deepSearch);
  const filters = useExplorerStore((s) => s.filters);
  const manifestStatus = useExplorerStore((s) => s.manifestStatus);
  const results = useExplorerStore((s) => s.results);
  const selectedResultIndex = useExplorerStore((s) => s.selectedResultIndex);
  const sessions = useExplorerStore((s) => s.sessions);
  const history = useExplorerStore((s) => s.history);
  const historyIndex = useExplorerStore((s) => s.historyIndex);
  const activeTab = useExplorerStore((s) => s.activeTab);
  const pinnedDiffRef = useExplorerStore((s) => s.pinnedDiffRef);

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
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);
  const pushNotice = useExplorerStore((s) => s.pushNotice);
  const hydrateFromHashUrl = useExplorerStore((s) => s.hydrateFromHashUrl);
  const buildHashUrl = useExplorerStore((s) => s.buildHashUrl);

  const activeEntry = historyIndex >= 0 ? (history[historyIndex] ?? null) : null;
  const currentRef: DefinitionRef | null = activeEntry
    ? {
        table: activeEntry.table,
        hash: activeEntry.hash,
        label: activeEntry.label,
        icon: activeEntry.icon,
      }
    : null;

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
    const st = useExplorerStore.getState();
    const nextHash = st.buildHashUrl();
    const active =
      st.activeSessionIndex >= 0 ? st.sessions[st.activeSessionIndex] : undefined;
    const historyState: HistoryTabState | null = active
      ? {
          manifestExplorer: true,
          sessionId: active.id,
          historyIndex: active.historyIndex,
        }
      : null;

    if (active) {
      if (mode === 'push') {
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
  }, []);

  // Hydrate initial URL hash & unify browser back/forward with the tab's history/future
  useEffect(() => {
    if (window.location.hash) {
      hydrateFromHashUrl(window.location.hash);
      syncBrowserHistory('replace');
    }

    let popTimer: number | null = null;

    const onPopState = (event: PopStateEvent): void => {
      if (syncingHashRef.current) {
        return;
      }
      flushActiveInspectorDomScroll();

      const currentHash = window.location.hash;
      lastHandledHashRef.current = currentHash;
      applyingPopStateRef.current = true;
      if (popTimer !== null) {
        window.clearTimeout(popTimer);
      }

      const state = event.state as Partial<HistoryTabState> | null;
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
  }, [hydrateFromHashUrl, restoreHistoryPoint, syncBrowserHistory]);

  // Keep URL hash synchronized without clobbering pushed tab history entries
  useEffect(() => {
    if (applyingPopStateRef.current) {
      return;
    }
    const nextHash = buildHashUrl();
    if (window.location.hash !== nextHash) {
      syncBrowserHistory('replace');
    }
  }, [
    sessions,
    activeSessionIndex,
    history,
    historyIndex,
    query,
    deepSearch,
    filters.table,
    buildHashUrl,
    syncBrowserHistory,
  ]);

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

  const manifestReady =
    manifestStatus.indexedEntryCount > 0 || manifestStatus.phase === 'ready';

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

  // Run search whenever query, deepSearch, filters, sort, or indexed entry count changes
  useEffect(() => {
    if (manifestStatus.indexedEntryCount === 0 && manifestStatus.phase !== 'ready') {
      return;
    }

    const searchKey = `${query}|${deepSearch ? '1' : '0'}|${sortMode}|${JSON.stringify(filters)}`;
    const isBackgroundIndexRefresh = searchKey === lastSearchKeyRef.current;
    lastSearchKeyRef.current = searchKey;

    const trimmed = query.trim();
    const hasDeepPrefix = /^deep:/i.test(trimmed);
    const useDeep = (deepSearch || hasDeepPrefix) && trimmed.length > 0;
    const effectiveDeepQuery = hasDeepPrefix
      ? trimmed.replace(/^deep:\s*/i, '').trim()
      : trimmed;

    const seq = ++searchSeqRef.current;
    const delay = isBackgroundIndexRefresh
      ? 450
      : useDeep
        ? 140
        : query.length > 0
          ? 25
          : 0;

    const timer = window.setTimeout(() => {
      const hasExistingResults = useExplorerStore.getState().results.length > 0;
      if (!isBackgroundIndexRefresh && (useDeep || !hasExistingResults)) {
        setSearching(true);
      }

      const promise =
        useDeep && effectiveDeepQuery.length > 0
          ? manifestClient.deepSearch(effectiveDeepQuery, filters, 400)
          : manifestClient.search(query, filters, sortMode, 2500);

      void promise
        .then((res) => {
          if (seq !== searchSeqRef.current) {
            return;
          }
          setSearchResults(
            res.items,
            res.totalMatches,
            res.durationMs,
            isBackgroundIndexRefresh,
          );
        })
        .catch(() => {
          if (seq === searchSeqRef.current) {
            setSearching(false);
          }
        });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    query,
    deepSearch,
    filters,
    sortMode,
    manifestStatus.indexedEntryCount,
    manifestStatus.phase,
    setSearchResults,
    setSearching,
  ]);

  // Load selected definition progressively (instant Lite/cached -> background full upgrade)
  const loadFullForCurrent = useCallback((ref: DefinitionRef, seq: number) => {
    setLoadingFull(true);
    void manifestClient
      .getDefinition(ref.table, ref.hash, true)
      .then((full) => {
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetail(full);
        setLoadingFull(false);
      })
      .catch(() => {
        if (seq === detailSeqRef.current) {
          setLoadingFull(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!currentRef) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setLoadingFull(false);
      setVariants([]);
      setReferences(null);
      setClarityEntry(null);
      return;
    }

    if (!manifestReady) {
      setDetailLoading(true);
      return;
    }

    const seq = ++detailSeqRef.current;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    setLoadingFull(false);
    setReferences(null);
    setClarityEntry(null);

    void manifestClient
      .getDefinition(currentRef.table, currentRef.hash, false)
      .then((payload) => {
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetail(payload);
        setDetailLoading(false);
        const dp = payload.data.displayProperties as
          | { name?: string; icon?: string }
          | undefined;
        const resolvedName =
          (typeof dp?.name === 'string' && dp.name.trim()) ||
          (typeof payload.data.statName === 'string' && payload.data.statName.trim()) ||
          (typeof payload.data.progressDescription === 'string' &&
            payload.data.progressDescription.trim()) ||
          '';
        updateEntryMeta(payload.table, payload.hash, {
          ...(resolvedName ? { label: resolvedName } : {}),
          ...(typeof dp?.icon === 'string' ? { icon: dp.icon } : {}),
          hasCoTables: payload.coTables.length > 0,
        });
        if (payload.isLite) {
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

    // Fetch variants in parallel (fast in-memory worker scan)
    setVariantsLoading(true);
    void manifestClient
      .getVariants(currentRef.table, currentRef.hash)
      .then((list) => {
        if (seq === detailSeqRef.current) {
          setVariants(list);
          setVariantsLoading(false);
        }
      })
      .catch(() => {
        if (seq === detailSeqRef.current) {
          setVariants([]);
          setVariantsLoading(false);
        }
      });

    // Fetch Clarity community note if enabled and relevant
    if (
      showClarityDescriptions &&
      (currentRef.table === 'DestinyInventoryItemDefinition' ||
        currentRef.table === 'DestinySandboxPerkDefinition')
    ) {
      setClarityLoading(true);
      void manifestClient
        .getClarityDescription(currentRef.hash)
        .then((entry) => {
          if (seq === detailSeqRef.current) {
            setClarityEntry(entry ?? null);
            setClarityLoading(false);
          }
        })
        .catch(() => {
          if (seq === detailSeqRef.current) {
            setClarityEntry(null);
            setClarityLoading(false);
          }
        });
    } else {
      setClarityLoading(false);
    }
  }, [
    currentRef?.table,
    currentRef?.hash,
    manifestReady,
    showClarityDescriptions,
    detailReloadCounter,
    loadFullForCurrent,
    updateEntryMeta,
  ]);

  // Lazy reverse references scan when References tab is active
  useEffect(() => {
    if (!currentRef || activeTab !== 'references') {
      return;
    }
    let cancelled = false;
    setReferencesLoading(true);
    void manifestClient
      .getReverseReferences(currentRef.hash, currentRef.table)
      .then((res) => {
        if (!cancelled) {
          setReferences(res);
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
  }, [currentRef?.table, currentRef?.hash, activeTab, refReloadCounter]);

  // Fetch pinned diff baseline when needed
  useEffect(() => {
    if (!pinnedDiffRef) {
      setPinnedDetail(null);
      setPinnedLoading(false);
      return;
    }
    let cancelled = false;
    setPinnedLoading(true);
    void manifestClient
      .getDefinition(pinnedDiffRef.table, pinnedDiffRef.hash, true)
      .then((res) => {
        if (!cancelled) {
          setPinnedDetail(res);
          setPinnedLoading(false);
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
  }, [pinnedDiffRef?.table, pinnedDiffRef?.hash]);

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
  }, [bootManifest, bungieApiKey, locale, pushNotice]);

  const handleClearCache = useCallback(() => {
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
      syncBrowserHistory('replace');
    },
    [openInNewTab, pushNotice, syncBrowserHistory],
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
    [navigateInTab, openInNewTab, syncBrowserHistory],
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
    [jumpToHistoryIndex, syncBrowserHistory],
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
        onCheckUpdates={handleCheckUpdates}
        onClearCache={handleClearCache}
        onLoadAllTables={handleLoadAllTables}
        onOpenHelp={() => setHelpOpen(true)}
        onLocaleChange={handleLocaleChange}
        onSelectTable={handleSelectTable}
      />

      <main className={styles.workspace}>
        <TableRail
          width={railWidth}
          collapsed={railCollapsed}
          onToggleCollapse={toggleRail}
          onResize={setRailWidth}
          onSelectTable={handleSelectTable}
          onLoadTable={handleLoadTable}
          onLoadAllTables={handleLoadAllTables}
        />

        {!inspectorMaximized && (
          <ResultsPane
            onOpenItem={handleOpenResult}
            onRetryBoot={() => bootManifest(locale, bungieApiKey, true)}
          />
        )}

        <DefinitionInspector
          width={inspectorWidth}
          onResize={setInspectorWidth}
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
          onLoadFullItem={() => {
            if (currentRef) {
              loadFullForCurrent(currentRef, detailSeqRef.current);
            }
          }}
          onLoadPriorityTable={handleLoadTable}
          onRetry={() => setDetailReloadCounter((c) => c + 1)}
        />
      </main>

      <StatusBar
        onCheckUpdates={handleCheckUpdates}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <NoticeStrip />
    </div>
  );
}
