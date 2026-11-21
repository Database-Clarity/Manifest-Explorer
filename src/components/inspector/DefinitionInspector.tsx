import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import type {
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  DefinitionRef,
  InspectorTab,
  ReverseReferenceResponse,
  VariantItem,
} from '../../types/manifest';
import { toSignedHash, toUnsignedHash } from '../../manifest/hash';
import { getShortTableName } from '../../manifest/tables';
import { useCollectorStore } from '../../stores/collector';
import { fallbackEntryLabel, useExplorerStore } from '../../stores/explorer';
import { useSettingsStore } from '../../stores/settings';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  DiffIcon,
  DownloadIcon,
  LinkIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlusIcon,
} from '../../ui/Icons';
import { getTierColorVar } from '../../ui/rarity';
import { Popover } from '../../ui/Popover';
import { Skeleton } from '../../ui/Skeleton';
import { BungieIcon } from '../BungieIcon';
import { DiffTab } from './DiffTab';
import { JsonTree } from './JsonTree';
import { OverviewTab } from './OverviewTab';
import { ReferencesTab } from './ReferencesTab';
import { VariantsTab } from './VariantsTab';
import styles from './DefinitionInspector.module.scss';

function isDefinitionEnhanced(data: Record<string, unknown> | undefined): boolean {
  if (!data) {
    return false;
  }
  const plug = data.plug as { plugCategoryIdentifier?: unknown } | undefined;
  if (
    typeof plug?.plugCategoryIdentifier === 'string' &&
    plug.plugCategoryIdentifier.toLowerCase().includes('enhanced')
  ) {
    return true;
  }
  if (
    typeof data.itemTypeAndTierDisplayName === 'string' &&
    /\benhanced\b/i.test(data.itemTypeAndTierDisplayName)
  ) {
    return true;
  }
  if (
    typeof data.itemTypeDisplayName === 'string' &&
    /\benhanced\b/i.test(data.itemTypeDisplayName)
  ) {
    return true;
  }
  const dp = data.displayProperties as { name?: unknown } | undefined;
  if (typeof dp?.name === 'string' && /^enhanced\s/i.test(dp.name)) {
    return true;
  }
  return false;
}

export interface DefinitionInspectorProps {
  width: number;
  onResize: (width: number) => void;
  currentRef: DefinitionRef | null;
  detail: DefinitionDetailPayload | null;
  loading: boolean;
  loadingFull: boolean;
  error: string | null;
  variants: VariantItem[];
  variantsLoading: boolean;
  references: ReverseReferenceResponse | null;
  referencesLoading: boolean;
  pinnedDetail: DefinitionDetailPayload | null;
  pinnedLoading: boolean;
  clarityEntry: ClarityDescriptionEntry | null;
  clarityLoading: boolean;
  showClarity: boolean;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onJumpToHistoryIndex: (index: number) => void;
  onSwitchSession: (index: number) => void;
  onLoadFullItem: () => void;
  onLoadPriorityTable: (table: string) => void;
  onRetry: () => void;
}

const TABS: ReadonlyArray<{ id: InspectorTab; label: string; shortLabel: string }> = [
  { id: 'pretty', label: 'Pretty', shortLabel: 'Pretty' },
  { id: 'overview', label: 'Overview', shortLabel: 'Info' },
  { id: 'variants', label: 'Variants', shortLabel: 'Vars' },
  { id: 'references', label: 'References', shortLabel: 'Refs' },
  { id: 'raw', label: 'Raw', shortLabel: 'Raw' },
  { id: 'diff', label: 'Diff', shortLabel: 'Diff' },
];

export function DefinitionInspector({
  width,
  onResize,
  currentRef,
  detail,
  loading,
  loadingFull,
  error,
  variants,
  variantsLoading,
  references,
  referencesLoading,
  pinnedDetail,
  pinnedLoading,
  clarityEntry,
  clarityLoading,
  showClarity,
  onNavigateRef,
  onNavigateBack,
  onNavigateForward,
  onJumpToHistoryIndex,
  onSwitchSession,
  onLoadFullItem,
  onLoadPriorityTable,
  onRetry,
}: DefinitionInspectorProps): ReactNode {
  const sessions = useExplorerStore((s) => s.sessions);
  const activeSessionIndex = useExplorerStore((s) => s.activeSessionIndex);
  const history = useExplorerStore((s) => s.history);
  const historyIndex = useExplorerStore((s) => s.historyIndex);
  const activeTab = useExplorerStore((s) => s.activeTab);
  const pinnedDiffRef = useExplorerStore((s) => s.pinnedDiffRef);
  const inspectorMaximized = useExplorerStore((s) => s.inspectorMaximized);
  const closeSession = useExplorerStore((s) => s.closeSession);
  const closeOtherSessions = useExplorerStore((s) => s.closeOtherSessions);
  const toggleInspectorMaximized = useExplorerStore((s) => s.toggleInspectorMaximized);
  const closeInspector = useExplorerStore((s) => s.closeInspector);
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);
  const saveEntryScroll = useExplorerStore((s) => s.saveEntryScroll);
  const saveEntryJsonState = useExplorerStore((s) => s.saveEntryJsonState);
  const pinForDiff = useExplorerStore((s) => s.pinForDiff);
  const clearPinnedDiff = useExplorerStore((s) => s.clearPinnedDiff);
  const pushNotice = useExplorerStore((s) => s.pushNotice);
  const buildTabGroupShareUrl = useExplorerStore((s) => s.buildTabGroupShareUrl);

  const imageScaling = useSettingsStore((s) => s.imageScaling);

  const collectedItems = useCollectorStore((s) => s.items);
  const toggleCollectItem = useCollectorStore((s) => s.toggleItem);

  const activeSession =
    activeSessionIndex >= 0 ? sessions[activeSessionIndex] : undefined;
  const activeEntry =
    historyIndex >= 0 ? history[historyIndex] : undefined;

  const dragStartRef = useRef<{ x: number; startWidth: number } | null>(null);
  const tabPanelRef = useRef<HTMLDivElement | null>(null);
  const sessionTabsScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeBannerItemRef = useRef<HTMLButtonElement | null>(null);
  const [tabsOverflowing, setTabsOverflowing] = useState(false);
  const [tabsMenuOpen, setTabsMenuOpen] = useState(false);
  const [tabsMenuFilter, setTabsMenuFilter] = useState('');
  const scrollTimerRef = useRef<number | null>(null);
  const liveScrollRef = useRef<{ tab: InspectorTab; top: number }>({
    tab: activeTab,
    top: 0,
  });

  useEffect(() => {
    const element = sessionTabsScrollRef.current;
    if (!element) {
      setTabsOverflowing(false);
      return;
    }

    const measureOverflow = (): void => {
      const overflowing = element.scrollWidth > element.clientWidth + 2;
      setTabsOverflowing((current) => (current === overflowing ? current : overflowing));
    };

    measureOverflow();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureOverflow);
      return () => window.removeEventListener('resize', measureOverflow);
    }

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sessions.length, width]);

  // Synchronously persist the current scroll container's scrollTop before leaving
  const flushScroll = useCallback(() => {
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    const panel = tabPanelRef.current;
    const scroller = panel?.querySelector<HTMLElement>('[data-inspector-scroll="true"]');
    if (scroller) {
      saveEntryScroll(activeTab, scroller.scrollTop);
    }
  }, [activeTab, saveEntryScroll]);

  const handlePanelScrollCapture = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.dataset.inspectorScroll !== 'true') {
        return;
      }
      const top = target.scrollTop;
      liveScrollRef.current = { tab: activeTab, top };

      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
      scrollTimerRef.current = window.setTimeout(() => {
        scrollTimerRef.current = null;
        saveEntryScroll(liveScrollRef.current.tab, liveScrollRef.current.top);
      }, 120);
    },
    [activeTab, saveEntryScroll],
  );

  useEffect(
    () => () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    },
    [],
  );

  // Restore saved scrollTop whenever switching tabs, stepping through history/future,
  // switching sub-tabs, or finishing a detail load.
  const targetScrollTop = activeEntry?.scrollByTab[activeTab] ?? 0;
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    const apply = (): void => {
      const scroller = tabPanelRef.current?.querySelector<HTMLElement>(
        '[data-inspector-scroll="true"]',
      );
      if (scroller) {
        scroller.scrollTop = targetScrollTop;
      }
    };

    raf1 = window.requestAnimationFrame(() => {
      apply();
      if (targetScrollTop > 0) {
        raf2 = window.requestAnimationFrame(apply);
      }
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [
    activeSession?.id,
    historyIndex,
    activeTab,
    detail?.table,
    detail?.hash,
    detail?.isLite,
    targetScrollTop,
  ]);

  // Keep the bolded current item scrolled into view inside the history/future banner
  useEffect(() => {
    activeBannerItemRef.current?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
    });
  }, [activeSession?.id, historyIndex, history.length]);

  const navigateWithFlush = useCallback(
    (ref: DefinitionRef, inNewTab = false) => {
      flushScroll();
      onNavigateRef(ref, inNewTab);
    },
    [flushScroll, onNavigateRef],
  );

  const handleSubTabChange = useCallback(
    (tab: InspectorTab) => {
      flushScroll();
      setActiveTab(tab);
    },
    [flushScroll, setActiveTab],
  );

  const handleBackClick = useCallback(() => {
    flushScroll();
    onNavigateBack();
  }, [flushScroll, onNavigateBack]);

  const handleForwardClick = useCallback(() => {
    flushScroll();
    onNavigateForward();
  }, [flushScroll, onNavigateForward]);

  const handleJumpClick = useCallback(
    (idx: number) => {
      flushScroll();
      onJumpToHistoryIndex(idx);
    },
    [flushScroll, onJumpToHistoryIndex],
  );

  const handleSessionSwitch = useCallback(
    (idx: number) => {
      flushScroll();
      onSwitchSession(idx);
    },
    [flushScroll, onSwitchSession],
  );

  const handleJsonFilterChange = useCallback(
    (nextFilter: string) => {
      saveEntryJsonState({ jsonFilter: nextFilter });
    },
    [saveEntryJsonState],
  );

  const handleJsonExpandedChange = useCallback(
    (nextExpanded: Record<string, boolean>) => {
      saveEntryJsonState({ jsonExpanded: nextExpanded });
    },
    [saveEntryJsonState],
  );

  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        pushNotice({ tone: 'info', message: label });
      } catch {
        pushNotice({ tone: 'warn', message: 'Clipboard unavailable in this browser context.' });
      }
    },
    [pushNotice],
  );

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      dragStartRef.current = { x: event.clientX, startWidth: width };
    },
    [width],
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) {
        return;
      }
      const delta = dragStartRef.current.x - event.clientX;
      onResize(dragStartRef.current.startWidth + delta);
    },
    [onResize],
  );

  const handleResizePointerUp = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  // Only disambiguate with category badge when the same hash appears in multiple categories
  const bannerMultiCategoryHashes = useMemo(() => {
    const tablesByHash = new Map<number, Set<string>>();
    for (const item of history) {
      let set = tablesByHash.get(item.hash);
      if (!set) {
        set = new Set();
        tablesByHash.set(item.hash, set);
      }
      set.add(item.table);
    }
    return tablesByHash;
  }, [history]);

  const displayProps = detail?.data.displayProperties as
    | { name?: string; icon?: string; description?: string }
    | undefined;
  const itemName =
    (typeof displayProps?.name === 'string' && displayProps.name.trim()) ||
    (typeof detail?.data.statName === 'string' && detail.data.statName.trim()) ||
    (typeof detail?.data.progressDescription === 'string' &&
      detail.data.progressDescription.trim()) ||
    activeEntry?.label ||
    (currentRef ? fallbackEntryLabel(currentRef) : '');
  const itemSubtitle =
    (typeof detail?.data.itemTypeAndTierDisplayName === 'string' &&
      detail.data.itemTypeAndTierDisplayName) ||
    (typeof detail?.data.itemTypeDisplayName === 'string' &&
      detail.data.itemTypeDisplayName) ||
    (currentRef ? getShortTableName(currentRef.table) : '');
  const iconPath =
    typeof displayProps?.icon === 'string'
      ? displayProps.icon
      : activeEntry?.icon;
  const watermarkPath =
    typeof detail?.data.iconWatermark === 'string'
      ? detail.data.iconWatermark
      : undefined;
  const tierType =
    typeof (detail?.data.inventory as { tierType?: unknown } | undefined)?.tierType ===
    'number'
      ? (detail?.data.inventory as { tierType: number }).tierType
      : undefined;
  const tierColor = getTierColorVar(tierType);
  const isEnhanced = isDefinitionEnhanced(detail?.data);

  const unsignedHash = currentRef ? toUnsignedHash(currentRef.hash) : 0;
  const signedHash = currentRef ? toSignedHash(currentRef.hash) : 0;

  const isCollected = currentRef
    ? collectedItems.some(
        (item) => item.table === currentRef.table && item.hash === unsignedHash,
      )
    : false;

  const rawJsonText = useMemo(() => {
    if (activeTab !== 'raw' || !detail) {
      return '';
    }
    return JSON.stringify(detail.data, null, 2);
  }, [activeTab, detail]);

  const handleDownloadJson = useCallback(() => {
    if (!detail) {
      return;
    }
    const blob = new Blob([JSON.stringify(detail.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getShortTableName(detail.table)}-${detail.hash}.json`;
    link.click();
    URL.revokeObjectURL(url);
    pushNotice({ tone: 'info', message: `Downloaded ${link.download}` });
  }, [detail, pushNotice]);

  if (!currentRef) {
    return null;
  }

  return (
    <aside
      className={`${styles.pane} ${inspectorMaximized ? styles.paneMaximized : ''}`}
      style={{ '--inspector-w': `${width}px` } as React.CSSProperties}
      aria-label="Definition inspector"
    >
      {!inspectorMaximized && (
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector pane"
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 32 : 8;
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              onResize(width + step);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              onResize(width - step);
            }
          }}
        />
      )}

      {/* Open-definitions tab strip with tab-group sharing */}
      {sessions.length >= 1 && (
        <div className={styles.sessionBar} role="tablist" aria-label="Open definitions">
          <div
            ref={sessionTabsScrollRef}
            className={styles.sessionTabsScroll}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {sessions.map((session, idx) => {
              const isActive = idx === activeSessionIndex;
              const cur = session.history[session.historyIndex];
              const tabLabel = cur
                ? cur.label || fallbackEntryLabel(cur)
                : 'Tab';
              return (
                <div
                  key={session.id}
                  className={`${styles.sessionTab} ${isActive ? styles.sessionTabActive : ''}`}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      closeSession(idx);
                    }
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={styles.sessionTabBtn}
                    onClick={() => handleSessionSwitch(idx)}
                    title={
                      cur
                        ? `${tabLabel} (${getShortTableName(cur.table)}:${cur.hash})`
                        : tabLabel
                    }
                  >
                    {cur?.icon && <BungieIcon icon={cur.icon} size={16} />}
                    <span className={styles.sessionTabLabel}>{tabLabel}</span>
                    {cur?.hasCoTables && cur.label && (
                      <span className={styles.sessionTabCat}>
                        {getShortTableName(cur.table)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.sessionCloseBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSession(idx);
                    }}
                    aria-label={`Close ${tabLabel}`}
                    title="Close tab"
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              );
            })}
          </div>
          {(tabsOverflowing || sessions.length >= 6) && (
            <button
              ref={sessionMenuTriggerRef}
              type="button"
              className={styles.sessionMenuTrigger}
              aria-label="Show all open tabs"
              aria-haspopup="dialog"
              aria-expanded={tabsMenuOpen}
              title="Show all open tabs"
              onClick={() => {
                setTabsMenuFilter('');
                setTabsMenuOpen((open) => !open);
              }}
            >
              <ChevronDownIcon size={12} />
              <span>{sessions.length}</span>
            </button>
          )}
          <button
            type="button"
            className={styles.sessionShareBtn}
            onClick={() =>
              copyText(
                buildTabGroupShareUrl(),
                sessions.length > 1
                  ? `Copied shareable link for ${sessions.length} open tabs`
                  : 'Copied shareable tab link',
              )
            }
            title={
              sessions.length > 1
                ? `Copy shareable link for all ${sessions.length} open tabs`
                : 'Copy shareable link for this tab'
            }
          >
            <LinkIcon size={12} />
            <span>{sessions.length > 1 ? `Share tabs (${sessions.length})` : 'Share'}</span>
          </button>
          {(tabsOverflowing || sessions.length >= 6) && (
            <Popover
              open={tabsMenuOpen}
              onClose={() => setTabsMenuOpen(false)}
              anchorRef={sessionMenuTriggerRef}
              align="end"
              label="All open tabs"
              width={sessions.length <= 8 ? '18rem' : sessions.length <= 18 ? '34rem' : '48rem'}
            >
              <div className={styles.sessionMenuBody}>
                <div className={styles.sessionMenuHeader}>
                  <span className={styles.sessionMenuTitle}>
                    Open tabs ({sessions.length})
                  </span>
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      className={styles.sessionMenuCloseOthers}
                      onClick={() => {
                        closeOtherSessions(activeSessionIndex);
                        setTabsMenuOpen(false);
                      }}
                    >
                      Close others
                    </button>
                  )}
                </div>
                {sessions.length > 10 && (
                  <input
                    type="search"
                    className={styles.sessionMenuFilter}
                    value={tabsMenuFilter}
                    onChange={(e) => setTabsMenuFilter(e.target.value)}
                    placeholder="Find by name, table, or hash…"
                    aria-label="Filter open tabs"
                  />
                )}
                <div
                  className={`${styles.sessionMenuGrid} ${
                    sessions.length >= 19
                      ? styles.sessionMenuGridThree
                      : sessions.length >= 9
                        ? styles.sessionMenuGridTwo
                        : ''
                  }`}
                >
                  {sessions.map((session, idx) => {
                    const cur = session.history[session.historyIndex];
                    const tabLabel = cur
                      ? cur.label || fallbackEntryLabel(cur)
                      : 'Tab';
                    const isActive = idx === activeSessionIndex;
                    const searchText = cur
                      ? `${tabLabel} ${cur.table} ${cur.hash}`.toLowerCase()
                      : tabLabel.toLowerCase();
                    if (
                      tabsMenuFilter.trim() &&
                      !searchText.includes(tabsMenuFilter.trim().toLowerCase())
                    ) {
                      return null;
                    }

                    return (
                      <div
                        key={session.id}
                        className={`${styles.sessionMenuItem} ${
                          isActive ? styles.sessionMenuItemActive : ''
                        }`}
                        onMouseDown={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            e.stopPropagation();
                            closeSession(idx);
                          }
                        }}
                      >
                        <button
                          type="button"
                          className={styles.sessionMenuItemMain}
                          title={
                            cur
                              ? `${tabLabel} (${getShortTableName(cur.table)}:${cur.hash})`
                              : tabLabel
                          }
                          onClick={() => {
                            handleSessionSwitch(idx);
                            setTabsMenuOpen(false);
                          }}
                        >
                          <BungieIcon icon={cur?.icon} size={16} />
                          <span className={styles.sessionMenuItemLabel}>{tabLabel}</span>
                          {cur?.hasCoTables && (
                            <span className={styles.sessionMenuItemCat}>
                              {getShortTableName(cur.table)}
                            </span>
                          )}
                          {isActive && (
                            <span className={styles.sessionMenuActiveIndicator}>
                              Current
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className={styles.sessionMenuClose}
                          aria-label={`Close ${tabLabel}`}
                          title="Close tab"
                          onClick={() => closeSession(idx)}
                        >
                          <CloseIcon size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {sessions.every((session) => {
                  const cur = session.history[session.historyIndex];
                  const tabLabel = cur
                    ? cur.label || fallbackEntryLabel(cur)
                    : 'Tab';
                  const searchText = cur
                    ? `${tabLabel} ${cur.table} ${cur.hash}`.toLowerCase()
                    : tabLabel.toLowerCase();
                  return (
                    !tabsMenuFilter.trim() ||
                    !searchText.includes(tabsMenuFilter.trim().toLowerCase())
                  );
                }) && tabsMenuFilter.trim() && (
                  <p className={styles.sessionMenuEmpty}>No open tabs match that filter.</p>
                )}
              </div>
            </Popover>
          )}
        </div>
      )}

      {/* Unified History / Current / Future timeline banner */}
      <div className={styles.navBar}>
        <div className={styles.navButtons}>
          <button
            type="button"
            className={styles.mobileBackBtn}
            onClick={closeInspector}
            aria-label="Back to results"
            title="Back to results"
          >
            <ArrowLeftIcon size={15} />
            <span>Results</span>
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleBackClick}
            disabled={historyIndex <= 0}
            aria-label="Back in tab history"
            title="Back in tab history (Alt+Left or Browser Back)"
          >
            <ArrowLeftIcon size={14} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleForwardClick}
            disabled={historyIndex < 0 || historyIndex >= history.length - 1}
            aria-label="Forward in tab history"
            title="Forward in tab history (Alt+Right or Browser Forward)"
          >
            <ArrowRightIcon size={14} />
          </button>
        </div>

        <nav className={styles.historyBanner} aria-label="Tab history and future">
          {history.map((entry, idx) => {
            const isPast = idx < historyIndex;
            const isCurrent = idx === historyIndex;
            const isFuture = idx > historyIndex;
            const displayLabel = entry.label || fallbackEntryLabel(entry);
            const hashHasMultipleCategories =
              Boolean(entry.hasCoTables) ||
              (bannerMultiCategoryHashes.get(entry.hash)?.size ?? 0) > 1;
            const showCategory = Boolean(entry.label) && hashHasMultipleCategories;
            const shortCat = getShortTableName(entry.table);
            const positionKind = isPast ? 'History' : isCurrent ? 'Current' : 'Forward';

            return (
              <span
                key={`${entry.table}:${entry.hash}:${idx}`}
                className={styles.historyItem}
              >
                {idx > 0 && (
                  <span
                    className={`${styles.historySep} ${isFuture ? styles.historySepFuture : ''}`}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                )}
                <button
                  ref={isCurrent ? activeBannerItemRef : undefined}
                  type="button"
                  className={`${styles.historyBtn} ${
                    isCurrent
                      ? styles.historyCurrent
                      : isFuture
                        ? styles.historyFuture
                        : styles.historyPast
                  }`}
                  onClick={() => handleJumpClick(idx)}
                  aria-current={isCurrent ? 'page' : undefined}
                  title={`${positionKind}: ${displayLabel} (${shortCat}:${entry.hash})`}
                >
                  <span className={styles.historyBtnLabel}>{displayLabel}</span>
                  {showCategory && (
                    <span className={styles.historyCat}>{shortCat}</span>
                  )}
                </button>
              </span>
            );
          })}
        </nav>

        <button
          type="button"
          className={`${styles.iconBtn} ${styles.desktopCloseBtn}`}
          onClick={toggleInspectorMaximized}
          aria-label={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
          title={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
        >
          {inspectorMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>

        <button
          type="button"
          className={`${styles.iconBtn} ${styles.desktopCloseBtn}`}
          onClick={() =>
            sessions.length > 1 ? closeSession(activeSessionIndex) : closeInspector()
          }
          aria-label={sessions.length > 1 ? 'Close tab' : 'Close inspector'}
          title={sessions.length > 1 ? 'Close tab (Alt+W)' : 'Close inspector (Esc)'}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* Entity header */}
      <div className={styles.entityHeader}>
        <div className={styles.entityIdentity}>
          <BungieIcon
            icon={iconPath}
            watermark={watermarkPath}
            isEnhanced={isEnhanced}
            size={44}
          />
          <div className={styles.entityTitleGroup}>
            <div className={styles.entityNameRow}>
              <h2 className={styles.entityTitle}>{itemName}</h2>
              {detail?.isLite && (
                <span className={styles.liteTag}>
                  {loadingFull ? 'Loading full…' : 'Lite'}
                </span>
              )}
            </div>
            <div className={styles.entityMetaRow}>
              <span className={styles.tableLabel}>{currentRef.table}</span>
              {itemSubtitle && itemSubtitle !== getShortTableName(currentRef.table) && (
                <span
                  className={styles.subLabel}
                  style={tierColor ? { color: tierColor } : undefined}
                >
                  {itemSubtitle}
                </span>
              )}
            </div>
            <div className={styles.hashRow}>
              <button
                type="button"
                className={styles.hashBtn}
                onClick={() => copyText(String(unsignedHash), `Copied hash ${unsignedHash}`)}
                title="Copy unsigned 32-bit hash (c)"
              >
                <span className="mono">{unsignedHash}</span>
                <CopyIcon size={11} />
              </button>
              {signedHash !== unsignedHash && (
                <button
                  type="button"
                  className={styles.hashBtnMuted}
                  onClick={() => copyText(String(signedHash), `Copied signed hash ${signedHash}`)}
                  title="Copy signed int32 SQLite hash"
                >
                  <span className="mono">{signedHash}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${isCollected ? styles.actionActive : ''}`}
            onClick={() => {
              toggleCollectItem({
                table: currentRef.table,
                hash: unsignedHash,
                name: itemName,
                subtitle: itemSubtitle,
                icon: iconPath,
              });
              pushNotice({
                tone: 'info',
                message: isCollected ? 'Removed from collector' : 'Added to collector',
              });
            }}
            title={isCollected ? 'Remove from collector (a)' : 'Add to collector (a)'}
          >
            {isCollected ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
            <span>{isCollected ? 'Collected' : 'Collect'}</span>
          </button>

          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              flushScroll();
              pinForDiff({
                table: currentRef.table,
                hash: unsignedHash,
                label: itemName,
                icon: iconPath,
              });
              pushNotice({ tone: 'info', message: `Pinned ${itemName} as diff baseline` });
            }}
            title="Pin as diff baseline"
          >
            <DiffIcon size={13} />
            <span>Diff</span>
          </button>

          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              if (detail) {
                copyText(JSON.stringify(detail.data, null, 2), 'Copied definition JSON');
              }
            }}
            disabled={!detail}
            title="Copy JSON (Shift+C)"
          >
            <CopyIcon size={13} />
            <span>JSON</span>
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => copyText(window.location.href, 'Copied direct link')}
            aria-label="Copy link"
            title="Copy shareable link"
          >
            <LinkIcon size={14} />
          </button>
        </div>

        {/* Same-hash cross-table switcher */}
        {detail && detail.coTables.length > 0 && (
          <div className={styles.coTableStrip} aria-label="Same hash in other tables">
            <span className={styles.coTableLabel}>Also in:</span>
            {detail.coTables.map((table) => (
              <button
                key={table}
                type="button"
                className={styles.coTableBtn}
                onClick={(e) =>
                  navigateWithFlush(
                    { table, hash: unsignedHash },
                    e.ctrlKey || e.metaKey || e.shiftKey,
                  )
                }
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    navigateWithFlush({ table, hash: unsignedHash }, true);
                  }
                }}
              >
                {getShortTableName(table)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Equal-width centered tabs on phones, compact left-aligned on desktop */}
      <div className={styles.tabBar} role="tablist" aria-label="Inspector views">
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          let countBadge = '';
          if (tab.id === 'variants' && variants.length > 1) {
            countBadge = ` (${variants.length})`;
          } else if (tab.id === 'references' && references) {
            countBadge = ` (${references.references.length})`;
          }
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`${styles.tabBtn} ${selected ? styles.tabActive : ''}`}
              onClick={() => handleSubTabChange(tab.id)}
            >
              <span className={styles.tabLabelFull}>
                {tab.label}
                {countBadge}
              </span>
              <span className={styles.tabLabelShort}>
                {tab.shortLabel}
                {countBadge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab panel (captures scroll across every tab for history state persistence) */}
      <div
        ref={tabPanelRef}
        className={styles.tabPanel}
        role="tabpanel"
        onScrollCapture={handlePanelScrollCapture}
      >
        {loading && !detail ? (
          <div className={styles.loadingState}>
            <Skeleton height="1.25rem" width="55%" />
            <Skeleton height="1rem" width="80%" />
            <Skeleton height="1rem" width="70%" />
            <Skeleton height="1rem" width="88%" />
            <Skeleton height="1rem" width="62%" />
          </div>
        ) : error ? (
          <div className={styles.errorState}>
            <p className={styles.errorMsg}>{error}</p>
            <button type="button" className={styles.actionBtn} onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : detail ? (
          <>
            {activeTab === 'pretty' && (
              <JsonTree
                key={`${activeSession?.id ?? ''}:${historyIndex}:${currentRef.table}:${currentRef.hash}`}
                data={detail.data}
                resolvedRefs={detail.resolvedRefs}
                initialFilter={activeEntry?.jsonFilter}
                onFilterChange={handleJsonFilterChange}
                initialExpanded={activeEntry?.jsonExpanded}
                onExpandedChange={handleJsonExpandedChange}
                imageScaling={imageScaling}
                onNavigateRef={(ref, inNewTab) => navigateWithFlush(ref, inNewTab)}
                onCopy={copyText}
              />
            )}
            {activeTab === 'overview' && (
              <OverviewTab
                detail={detail}
                loadingFull={loadingFull}
                clarityEntry={clarityEntry}
                clarityLoading={clarityLoading}
                showClarity={showClarity}
                onNavigateRef={(ref, inNewTab) => navigateWithFlush(ref, inNewTab)}
                onLoadFullItem={onLoadFullItem}
              />
            )}
            {activeTab === 'variants' && (
              <VariantsTab
                currentRef={currentRef}
                variants={variants}
                loading={variantsLoading}
                onNavigateRef={(ref, inNewTab) => navigateWithFlush(ref, inNewTab)}
                onDiffVariant={(variantRef) => {
                  flushScroll();
                  pinForDiff({
                    table: currentRef.table,
                    hash: unsignedHash,
                    label: itemName,
                    icon: iconPath,
                  });
                  onNavigateRef(variantRef, false);
                  setActiveTab('diff');
                }}
              />
            )}
            {activeTab === 'references' && (
              <ReferencesTab
                response={references}
                loading={referencesLoading}
                onNavigateRef={(ref, inNewTab) => navigateWithFlush(ref, inNewTab)}
                onLoadPriorityTable={onLoadPriorityTable}
              />
            )}
            {activeTab === 'raw' && (
              <div className={styles.rawWrap}>
                <div className={styles.rawToolbar}>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => copyText(rawJsonText, 'Copied raw JSON')}
                  >
                    <CopyIcon size={13} />
                    Copy JSON
                  </button>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={handleDownloadJson}
                  >
                    <DownloadIcon size={13} />
                    Download .json
                  </button>
                </div>
                <pre className={styles.rawPre} data-inspector-scroll="true">
                  {rawJsonText}
                </pre>
              </div>
            )}
            {activeTab === 'diff' && (
              <DiffTab
                current={detail}
                pinnedRef={pinnedDiffRef}
                pinnedDetail={pinnedDetail}
                pinnedLoading={pinnedLoading}
                onPinCurrent={() =>
                  pinForDiff({
                    table: currentRef.table,
                    hash: unsignedHash,
                    label: itemName,
                    icon: iconPath,
                  })
                }
                onClearPin={clearPinnedDiff}
                onNavigateRef={(ref) => navigateWithFlush(ref, false)}
              />
            )}
          </>
        ) : (
          <div className={styles.errorState}>
            <p className={styles.errorMsg}>
              Definition {currentRef.hash} was not found in {currentRef.table}.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
