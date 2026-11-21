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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function App(): ReactNode {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const syncingHashRef = useRef(false);

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
  const filters = useExplorerStore((s) => s.filters);
  const manifestStatus = useExplorerStore((s) => s.manifestStatus);
  const results = useExplorerStore((s) => s.results);
  const selectedResultIndex = useExplorerStore((s) => s.selectedResultIndex);
  const stack = useExplorerStore((s) => s.stack);
  const stackIndex = useExplorerStore((s) => s.stackIndex);
  const activeTab = useExplorerStore((s) => s.activeTab);
  const pinnedDiffRef = useExplorerStore((s) => s.pinnedDiffRef);

  const setManifestStatus = useExplorerStore((s) => s.setManifestStatus);
  const setTables = useExplorerStore((s) => s.setTables);
  const setFilterCatalog = useExplorerStore((s) => s.setFilterCatalog);
  const setSearchResults = useExplorerStore((s) => s.setSearchResults);
  const setSearching = useExplorerStore((s) => s.setSearching);
  const setTableFilter = useExplorerStore((s) => s.setTableFilter);
  const setSelectedResultIndex = useExplorerStore((s) => s.setSelectedResultIndex);
  const openDefinition = useExplorerStore((s) => s.openDefinition);
  const openInNewTab = useExplorerStore((s) => s.openInNewTab);
  const closeSession = useExplorerStore((s) => s.closeSession);
  const updateActiveSessionLabel = useExplorerStore((s) => s.updateActiveSessionLabel);
  const inspectorMaximized = useExplorerStore((s) => s.inspectorMaximized);
  const activeSessionIndex = useExplorerStore((s) => s.activeSessionIndex);
  const sessionsCount = useExplorerStore((s) => s.sessions.length);
  const navigateBack = useExplorerStore((s) => s.navigateBack);
  const navigateForward = useExplorerStore((s) => s.navigateForward);
  const closeInspector = useExplorerStore((s) => s.closeInspector);
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);
  const pushNotice = useExplorerStore((s) => s.pushNotice);
  const hydrateFromHashUrl = useExplorerStore((s) => s.hydrateFromHashUrl);
  const buildHashUrl = useExplorerStore((s) => s.buildHashUrl);

  const currentRef: DefinitionRef | null =
    stackIndex >= 0 ? (stack[stackIndex] ?? null) : null;

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

  // Hydrate initial URL hash & listen to browser back/forward
  useEffect(() => {
    if (window.location.hash) {
      hydrateFromHashUrl(window.location.hash);
    }
    const onHashChange = (): void => {
      if (syncingHashRef.current) {
        return;
      }
      hydrateFromHashUrl(window.location.hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [hydrateFromHashUrl]);

  // Keep URL hash synchronized with inspector stack, query, and table filter
  useEffect(() => {
    const nextHash = buildHashUrl();
    if (window.location.hash !== nextHash) {
      syncingHashRef.current = true;
      window.history.replaceState(null, '', nextHash);
      window.queueMicrotask(() => {
        syncingHashRef.current = false;
      });
    }
  }, [stack, stackIndex, query, filters.table, buildHashUrl]);

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

  // Run search whenever query, filters, sort, or indexed entry count changes
  useEffect(() => {
    if (manifestStatus.indexedEntryCount === 0 && manifestStatus.phase !== 'ready') {
      return;
    }

    const seq = ++searchSeqRef.current;
    const delay = query.length > 0 ? 25 : 0;

    const timer = window.setTimeout(() => {
      setSearching(true);
      void manifestClient
        .search(query, filters, sortMode, 2500)
        .then((res) => {
          if (seq !== searchSeqRef.current) {
            return;
          }
          setSearchResults(res.items, res.totalMatches, res.durationMs);
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
    filters,
    sortMode,
    manifestStatus.indexedEntryCount,
    manifestStatus.phase,
    setSearchResults,
    setSearching,
  ]);

  // Load selected definition progressively (instant Lite/cached -> background full upgrade)
  const loadFullForCurrent = useCallback(
    (ref: DefinitionRef, seq: number) => {
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
    },
    [],
  );

  const manifestReady =
    manifestStatus.indexedEntryCount > 0 || manifestStatus.phase === 'ready';

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
        const dp = payload.data.displayProperties as { name?: string } | undefined;
        const resolvedName =
          (typeof dp?.name === 'string' && dp.name.trim()) ||
          (typeof payload.data.statName === 'string' && payload.data.statName.trim()) ||
          `${getShortTableName(payload.table)}:${payload.hash}`;
        updateActiveSessionLabel(resolvedName);
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
  ]);

  // Lazy reverse references scan when References tab is active
  useEffect(() => {
    if (!currentRef || activeTab !== 'references') {
      return;
    }
    let cancelled = false;
    setReferencesLoading(true);
    void manifestClient
      .getReverseReferences(currentRef.hash)
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
    (item: SearchResultItem, inNewTab = false) => {
      const collector = useCollectorStore.getState();
      if (collector.collectMode && !inNewTab) {
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
      if (inNewTab) {
        openInNewTab(
          { table: item.table, hash: item.hash },
          item.name || `${getShortTableName(item.table)}:${item.hash}`,
          true,
        );
      } else {
        openDefinition(
          { table: item.table, hash: item.hash },
          true,
          item.name || `${getShortTableName(item.table)}:${item.hash}`,
        );
      }
    },
    [openDefinition, openInNewTab, pushNotice],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateBack();
        return;
      }

      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        navigateForward();
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

      if (isEditableTarget(event.target)) {
        if (event.key === 'Escape') {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
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
        } else if (currentRef) {
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

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeSessionIndex,
    closeInspector,
    closeSession,
    currentRef,
    detail,
    handleOpenResult,
    helpOpen,
    navigateBack,
    navigateForward,
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
          onNavigateRef={(ref, push = true, inNewTab = false) =>
            inNewTab ? openInNewTab(ref, undefined, true) : openDefinition(ref, push)
          }
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
