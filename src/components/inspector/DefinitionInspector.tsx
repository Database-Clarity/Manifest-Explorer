import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
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
import { fallbackEntryLabel, useExplorerStore } from '../../stores/explorer';
import {
  RESULTS_WIDTH_MIN,
  clampResultsWidth,
  maxResultsWidth,
  useSettingsStore,
} from '../../stores/settings';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  CheckIcon,
  DiffIcon,
  DownloadIcon,
  LinkIcon,
  MaximizeIcon,
  MinimizeIcon,
} from '../../ui/Icons';
import { getTierColorVar } from '../../ui/rarity';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import { Popover } from '../../ui/Popover';
import { Skeleton } from '../../ui/Skeleton';
import { BungieIcon } from '../BungieIcon';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import { scrollTabIntoView } from '../../utils/scrollTabIntoView';
import { JsonTree } from './JsonTree';
import { DIFF_BUCKET_NOTICE_ID, useDiffBucketStore } from '../../stores/diffBucket';
import styles from './DefinitionInspector.module.scss';

const LazyOverviewTab = lazy(() =>
  import('./OverviewTab').then((module) => ({ default: module.OverviewTab })),
);
const LazyVariantsTab = lazy(() =>
  import('./VariantsTab').then((module) => ({ default: module.VariantsTab })),
);
const LazyReferencesTab = lazy(() =>
  import('./ReferencesTab').then((module) => ({ default: module.ReferencesTab })),
);
const LazyDiffTab = lazy(() =>
  import('./DiffTab').then((module) => ({ default: module.DiffTab })),
);
const LazyHistoryTab = lazy(() =>
  import('./HistoryTab').then((module) => ({ default: module.HistoryTab })),
);

function InspectorTabFallback(): ReactNode {
  return (
    <div className={styles.loadingState} aria-label="Loading inspector tab">
      <Skeleton height="1.25rem" width="55%" />
      <Skeleton height="1rem" width="80%" />
      <Skeleton height="1rem" width="70%" />
    </div>
  );
}
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
  /**
   * Live rendered width of the results pane. The separator drags this value
   * directly, so the inspector simply absorbs whatever space is left.
   */
  width: number;
  onResize: (width: number) => void;
  /** Upper bound for the results pane that keeps the inspector >= 384px. */
  resultsMaxWidth?: number;
  /** Ref to the live results pane, used to measure the rendered width. */
  resultsPaneRef?: RefObject<HTMLElement | null>;
  /** Measured width of the workspace flex row (0 while unmeasured). */
  workspaceWidth?: number;
  /** Effective width of the tables rail (collapsed rail is 1rem). */
  railWidth?: number;
  currentRef: DefinitionRef | null;
  detail: DefinitionDetailPayload | null;
  loading: boolean;
  loadingFull: boolean;
  error: string | null;
  variants: VariantItem[];
  variantsLoading: boolean;
  references: ReverseReferenceResponse | null;
  referencesLoading: boolean;
  baseDetail: DefinitionDetailPayload | null;
  targetDetail: DefinitionDetailPayload | null;
  baseLoading: boolean;
  targetLoading: boolean;
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

type InspectorViewTab = Exclude<InspectorTab, 'diff'> | 'history';

const TABS: ReadonlyArray<{ id: InspectorViewTab; label: string; shortLabel: string }> = [
  { id: 'pretty', label: 'Formatted', shortLabel: 'Formatted' },
  { id: 'overview', label: 'Overview', shortLabel: 'Info' },
  { id: 'variants', label: 'Variants', shortLabel: 'Vars' },
  { id: 'references', label: 'References', shortLabel: 'Refs' },
  { id: 'raw', label: 'Raw', shortLabel: 'Raw' },
  { id: 'history', label: 'History', shortLabel: 'Hist' },
];

function DefinitionInspectorImpl({
  width,
  onResize,
  resultsMaxWidth,
  resultsPaneRef,
  workspaceWidth = 0,
  railWidth = 0,
  currentRef,
  detail,
  loading,
  loadingFull,
  error,
  variants,
  variantsLoading,
  references,
  referencesLoading,
  baseDetail,
  targetDetail,
  baseLoading,
  targetLoading,
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
  const mobileInspectorOpen = useExplorerStore((s) => s.mobileInspectorOpen);
  const activeTab = useExplorerStore((s) => s.activeTab);
  const activeViewTab = activeTab as InspectorViewTab;
  const diffTabOpen = useDiffBucketStore((s) => s.diffTabOpen);
  const diffTabActive = useDiffBucketStore((s) => s.diffTabActive);
  const bucketItems = useDiffBucketStore((s) => s.items);
  const openDiffTab = useDiffBucketStore((s) => s.openDiffTab);
  const closeDiffTab = useDiffBucketStore((s) => s.closeDiffTab);
  const focusDiffTab = useDiffBucketStore((s) => s.focusDiffTab);
  const addDiffItem = useDiffBucketStore((s) => s.addItem);
  const removeDiffItem = useDiffBucketStore((s) => s.removeItem);
  const inspectorMaximized = useExplorerStore((s) => s.inspectorMaximized);
  const closeSession = useExplorerStore((s) => s.closeSession);
  const closeOtherSessions = useExplorerStore((s) => s.closeOtherSessions);
  const toggleInspectorMaximized = useExplorerStore((s) => s.toggleInspectorMaximized);
  const closeInspector = useExplorerStore((s) => s.closeInspector);
  const setMobileInspectorOpen = useExplorerStore((s) => s.setMobileInspectorOpen);
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);
  const getEntryScroll = useExplorerStore((s) => s.getEntryScroll);
  const saveEntryScroll = useExplorerStore((s) => s.saveEntryScroll);
  const saveEntryJsonState = useExplorerStore((s) => s.saveEntryJsonState);
  const pushNotice = useExplorerStore((s) => s.pushNotice);
  const buildTabGroupShareUrl = useExplorerStore((s) => s.buildTabGroupShareUrl);

  const imageScaling = useSettingsStore((s) => s.imageScaling);

  const activeSession =
    activeSessionIndex >= 0 ? sessions[activeSessionIndex] : undefined;
  const activeEntry =
    historyIndex >= 0 ? history[historyIndex] : undefined;

  const dragStartRef = useRef<{
    x: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const tabPanelRef = useRef<HTMLDivElement | null>(null);
  const sessionTabsScrollRef = useRef<HTMLDivElement | null>(null);
  const activeSessionTabRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const diffOpenTriggerRef = useRef<HTMLButtonElement | null>(null);
  const diffBucketTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [diffBucketPopoverOpen, setDiffBucketPopoverOpen] = useState(false);
  const activeBannerItemRef = useRef<HTMLButtonElement | null>(null);
  const [tabsOverflowing, setTabsOverflowing] = useState(false);
  const [tabsMenuOpen, setTabsMenuOpen] = useState(false);
  const [tabsMenuFilter, setTabsMenuFilter] = useState('');
  const definitionKey = detail ? `${detail.table}:${detail.hash}` : '';
  const [visitedTabState, setVisitedTabState] = useState<{
    definitionKey: string;
    tabs: Set<InspectorViewTab>;
  }>(() => ({ definitionKey, tabs: new Set([activeViewTab]) }));
  const visitedTabs = useMemo(() => {
    const tabs =
      visitedTabState.definitionKey === definitionKey
        ? new Set(visitedTabState.tabs)
        : new Set<InspectorViewTab>();
    tabs.add(activeViewTab);
    return tabs;
  }, [activeViewTab, definitionKey, visitedTabState]);
  const scrollTimerRef = useRef<number | null>(null);
  const liveScrollRef = useRef<{ tab: InspectorTab; top: number }>({
    tab: activeTab,
    top: 0,
  });

  useEffect(() => {
    setVisitedTabState((state) => {
      if (state.definitionKey !== definitionKey) {
        return { definitionKey, tabs: new Set([activeViewTab]) };
      }
      if (state.tabs.has(activeViewTab)) {
        return state;
      }
      const tabs = new Set(state.tabs);
      tabs.add(activeViewTab);
      return { definitionKey, tabs };
    });
  }, [activeViewTab, definitionKey]);

  useEffect(() => {
    if (!diffTabActive) setDiffBucketPopoverOpen(false);
  }, [diffTabActive]);

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

  useLayoutEffect(() => {
    const scrollActiveTab = (): void => {
      const container = sessionTabsScrollRef.current;
      const tab = activeSessionTabRef.current;
      if (container && tab) scrollTabIntoView(container, tab);
    };
    scrollActiveTab();

    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(scrollActiveTab);
      return () => window.cancelAnimationFrame(frame);
    }

    const timer = window.setTimeout(scrollActiveTab, 0);
    return () => window.clearTimeout(timer);
  }, [activeSessionIndex, sessions.length, mobileInspectorOpen, tabsOverflowing, width]);

  // Synchronously persist the current scroll container's scrollTop before leaving
  const flushScroll = useCallback(() => {
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    const panel = tabPanelRef.current;
    const scroller = panel?.querySelector<HTMLElement>(
      '[data-inspector-panel-active="true"] [data-inspector-scroll="true"]',
    );
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
  const targetScrollTop = getEntryScroll(activeTab);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    const apply = (): void => {
      const scroller = tabPanelRef.current?.querySelector<HTMLElement>(
        '[data-inspector-panel-active="true"] [data-inspector-scroll="true"]',
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
    (tab: InspectorViewTab) => {
      flushScroll();
      setActiveTab(tab as InspectorTab);
    },
    [flushScroll, setActiveTab],
  );

  const handleBackClick = useCallback(() => {
    flushScroll();
    onNavigateBack();
  }, [flushScroll, onNavigateBack]);

  const handleMobileBackToResults = useCallback(() => {
    flushScroll();
    const state = window.history.state as { mobileInspector?: boolean } | null;
    if (state?.mobileInspector === true) {
      window.history.back();
    } else {
      setMobileInspectorOpen(false);
    }
  }, [flushScroll, setMobileInspectorOpen]);

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

  const liveResultsMaxWidth = useMemo(
    () =>
      Math.max(
        RESULTS_WIDTH_MIN,
        resultsMaxWidth ?? maxResultsWidth(workspaceWidth, railWidth),
      ),
    [railWidth, resultsMaxWidth, workspaceWidth],
  );

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      // Start from the LIVE rendered width, not the persisted prop: CSS clamps
      // (or a narrowed window) can leave the stored value far above what the
      // user actually sees, which used to create a huge drag deadzone before
      // the pane started moving. Measuring the sibling DOM node guarantees the
      // first pixel of movement maps 1:1 onto the rendered pane.
      const previousSibling = paneRef.current?.previousElementSibling;
      const measured =
        resultsPaneRef?.current?.getBoundingClientRect().width ??
        (previousSibling instanceof HTMLElement
          ? previousSibling.getBoundingClientRect().width
          : 0);
      const startWidth =
        Number.isFinite(measured) && measured > 0
          ? Math.round(measured)
          : clampResultsWidth(width, liveResultsMaxWidth);
      dragStartRef.current = { x: event.clientX, startWidth, width: startWidth };
    },
    [liveResultsMaxWidth, resultsPaneRef, width],
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragStartRef.current;
      if (!drag) {
        return;
      }
      // Dragging right widens the results list (and narrows the inspector).
      const nextWidth = clampResultsWidth(
        drag.startWidth + (event.clientX - drag.x),
        liveResultsMaxWidth,
      );
      if (nextWidth === drag.width) {
        return;
      }
      drag.width = nextWidth;
      onResize(nextWidth);
    },
    [liveResultsMaxWidth, onResize],
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
  type ParentArtifact = { hash: number; name: string; icon?: string };
  type OverviewWithParentArtifact = NonNullable<DefinitionDetailPayload['overview']> & {
    parentArtifact?: ParentArtifact;
  };
  const parentArtifact = (detail?.overview as OverviewWithParentArtifact | undefined)
    ?.parentArtifact;
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

  const rawJsonText = useMemo(() => {
    return detail ? JSON.stringify(detail.data, null, 2) : '';
  }, [detail]);

  // Stable handlers for memoized child tabs: inline arrows here would defeat
  // `memo()` every time the inspector chrome (tabs, history banner, width)
  // re-renders.
  const currentBucketItemKey = currentRef
    ? `${currentRef.table}:${unsignedHash >>> 0}`
    : '';
  const currentInBucket = bucketItems.some((item) => item.key === currentBucketItemKey);
  const toggleCurrentDiffItem = useCallback(() => {
    if (!currentRef) return;
    if (currentInBucket) {
      removeDiffItem(currentBucketItemKey);
    } else {
      addDiffItem({
        table: currentRef.table,
        hash: unsignedHash,
        name: itemName,
        subtitle: itemSubtitle,
        icon: iconPath,
      });
    }
    // Toggle bucket membership only; never steal focus from the inspected
    // entry. The Diff tab is already open when this control is visible. The
    // stable notice id keeps repeated toggles to a single updating toast.
    pushNotice({
      id: DIFF_BUCKET_NOTICE_ID,
      tone: 'info',
      message: currentInBucket
        ? `Removed ${itemName || `#${unsignedHash}`} from Diff bucket`
        : `Added ${itemName || `#${unsignedHash}`} to Diff bucket`,
    });
  }, [
    addDiffItem,
    currentBucketItemKey,
    currentInBucket,
    currentRef,
    iconPath,
    itemName,
    itemSubtitle,
    pushNotice,
    removeDiffItem,
    unsignedHash,
  ]);

  const handleDiffVariant = useCallback(
    (variantRef: DefinitionRef) => {
      if (!currentRef || !detail) return;
      useDiffBucketStore.getState().openPairInDiff(
        {
          table: currentRef.table,
          hash: unsignedHash,
          name: itemName,
          subtitle: itemSubtitle,
          icon: iconPath,
        },
        {
          table: variantRef.table,
          hash: variantRef.hash,
          name: variantRef.label ?? '',
          subtitle: getShortTableName(variantRef.table),
          icon: variantRef.icon,
        },
      );
      setMobileInspectorOpen(true);
    },
    [currentRef, detail, iconPath, itemName, itemSubtitle, setMobileInspectorOpen, unsignedHash],
  );

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

  if (!currentRef && !diffTabOpen) {
    return null;
  }

  return (
    <aside
      ref={paneRef}
      className={`${styles.pane} ${inspectorMaximized ? styles.paneMaximized : ''}`}
      aria-label="Definition inspector"
    >
      {!inspectorMaximized && (
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize results pane"
          aria-valuemin={RESULTS_WIDTH_MIN}
          aria-valuemax={liveResultsMaxWidth}
          aria-valuenow={Math.round(width)}
          aria-valuetext={`${Math.round(width)} pixels wide`}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          onLostPointerCapture={handleResizePointerUp}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 32 : 8;
            // ArrowRight makes the results list wider and the inspector
            // narrower, matching the physical drag direction.
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              onResize(clampResultsWidth(width - step, liveResultsMaxWidth));
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              onResize(clampResultsWidth(width + step, liveResultsMaxWidth));
            } else if (e.key === 'Home') {
              e.preventDefault();
              onResize(RESULTS_WIDTH_MIN);
            } else if (e.key === 'End') {
              e.preventDefault();
              onResize(liveResultsMaxWidth);
            }
          }}
        />
      )}

      {/* Open-definitions tab strip with tab-group sharing */}
      {(sessions.length >= 1 || diffTabOpen) && (
        <div className={styles.sessionBar} role="tablist" aria-label="Open definitions">
          <button
            type="button"
            className={styles.sessionBackBtn}
            onClick={handleMobileBackToResults}
            aria-label="Back to results"
            title="Back to results"
          >
            <ArrowLeftIcon size={15} />
            <span>Results</span>
          </button>
          {diffTabOpen ? (
            <div
              className={`${styles.sessionTab} ${styles.pinnedDiffTab} ${
                diffTabActive ? styles.sessionTabActive : ''
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={diffTabActive}
                className={styles.sessionTabBtn}
                onClick={() => {
                  focusDiffTab();
                  setMobileInspectorOpen(true);
                }}
                title="Compare definitions in the Diff bucket"
              >
                <DiffIcon size={13} />
                <span className={styles.sessionTabLabel}>Diff</span>
                {bucketItems.length > 0 ? (
                  <span className={styles.diffCount}>{bucketItems.length}</span>
                ) : null}
              </button>
              <button
                type="button"
                className={styles.sessionCloseBtn}
                aria-label="Close Diff tab"
                title="Close Diff tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeDiffTab();
                  setDiffBucketPopoverOpen(false);
                  if (sessions.length === 0) setMobileInspectorOpen(false);
                }}
              >
                <CloseIcon size={11} />
              </button>
            </div>
          ) : null}
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
              const isActive = !diffTabActive && idx === activeSessionIndex;
              const cur = session.history[session.historyIndex];
              const tabLabel = cur
                ? cur.label || fallbackEntryLabel(cur)
                : 'Tab';
              return (
                <div
                  key={session.id}
                  ref={isActive ? activeSessionTabRef : undefined}
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
            <div className={styles.sessionOverflowWrap}>
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
            </div>
          )}
          {sessions.length > 0 ? <button
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
                ? `Share tabs (${sessions.length})`
                : 'Share tab'
            }
            aria-label={
              sessions.length > 1
                ? `Share tabs (${sessions.length})`
                : 'Share tab'
            }
          >
            <LinkIcon size={12} />
            <span className={styles.shareTabsLabel}>
              {sessions.length > 1 ? `Share tabs (${sessions.length})` : 'Share'}
            </span>
          </button>
          : null}
          {!diffTabOpen ? (
            <button
              ref={diffOpenTriggerRef}
              type="button"
              className={styles.openDiffButton}
              onClick={() => {
                openDiffTab(true);
                setMobileInspectorOpen(true);
              }}
              title={
                bucketItems.length > 0
                  ? `Open Diff tab (${bucketItems.length} in bucket)`
                  : 'Open Diff tab'
              }
              aria-label={
                bucketItems.length > 0
                  ? `Open Diff tab, ${bucketItems.length} in bucket`
                  : 'Open Diff tab'
              }
            >
              <DiffIcon size={14} />
              {bucketItems.length > 0 ? (
                <span className={styles.diffDot}>{bucketItems.length}</span>
              ) : null}
            </button>
          ) : null}
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
                  <ClearSearchInput
                    className={styles.sessionMenuFilter}
                    value={tabsMenuFilter}
                    onValueChange={setTabsMenuFilter}
                    placeholder="Find by name, table, or hash…"
                    aria-label="Filter open tabs"
                    clearLabel="Clear tab filter"
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
          {diffTabActive ? (
            <>
              <button
                type="button"
                className={styles.sessionBucketBtn}
                aria-haspopup="dialog"
                aria-expanded={diffBucketPopoverOpen}
                title="Manage or clear Diff bucket"
                onClick={(event) => {
                  diffBucketTriggerRef.current = event.currentTarget;
                  setDiffBucketPopoverOpen((open) => !open);
                }}
              >
                <DiffIcon size={13} />
                <span>Bucket ({bucketItems.length})</span>
              </button>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.sessionAction} ${styles.desktopCloseBtn}`}
                onClick={toggleInspectorMaximized}
                aria-label={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
                title={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
              >
                {inspectorMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
              </button>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.sessionAction} ${styles.desktopCloseBtn}`}
                onClick={() => {
                  closeDiffTab();
                  setDiffBucketPopoverOpen(false);
                  if (sessions.length === 0) setMobileInspectorOpen(false);
                }}
                aria-label="Close Diff tab"
                title="Close Diff tab"
              >
                <CloseIcon size={14} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.sessionAction} ${styles.desktopCloseBtn}`}
                onClick={toggleInspectorMaximized}
                aria-label={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
                title={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
              >
                {inspectorMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
              </button>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.sessionAction} ${styles.desktopCloseBtn}`}
                onClick={() =>
                  sessions.length > 1 ? closeSession(activeSessionIndex) : closeInspector()
                }
                aria-label={sessions.length > 1 ? 'Close tab' : 'Close inspector'}
                title={sessions.length > 1 ? 'Close tab (Alt+W)' : 'Close inspector (Esc)'}
              >
                <CloseIcon size={14} />
              </button>
            </>
          )}
        </div>
      )}

      {!diffTabActive && currentRef && history.length > 1 ? (
      <>
      {/* Unified History / Current / Future timeline banner */}
      <div className={styles.navBar}>
        <div className={styles.navButtons}>
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
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) {
                      navigateWithFlush(entry, true);
                      return;
                    }
                    handleJumpClick(idx);
                  }}
                  onMouseDown={preventMiddleClickAutoScroll}
                  onAuxClick={(event) =>
                    activateOnMiddleClick(event, () => navigateWithFlush(entry, true))
                  }
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
      </div>
      </>
      ) : null}

      {/* Entity header */}
      {!diffTabActive && currentRef ? (
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
              <span className={styles.tableLabel} title={currentRef.table}>
                {getShortTableName(currentRef.table)}
              </span>
              {itemSubtitle && itemSubtitle !== getShortTableName(currentRef.table) && (
                <span
                  className={styles.subLabel}
                  style={tierColor ? { color: tierColor } : undefined}
                >
                  {itemSubtitle}
                </span>
              )}
              {parentArtifact ? (
                <button
                  type="button"
                  className={styles.parentArtifactBtn}
                  title={`Open artifact: ${parentArtifact.name}`}
                  onClick={(event) =>
                    navigateWithFlush(
                      {
                        table: 'DestinyInventoryItemDefinition',
                        hash: parentArtifact.hash,
                        label: parentArtifact.name,
                        icon: parentArtifact.icon,
                      },
                      event.ctrlKey || event.metaKey,
                    )
                  }
                  onMouseDown={preventMiddleClickAutoScroll}
                  onAuxClick={(event) => {
                    activateOnMiddleClick(event, () =>
                      navigateWithFlush(
                        {
                          table: 'DestinyInventoryItemDefinition',
                          hash: parentArtifact.hash,
                          label: parentArtifact.name,
                          icon: parentArtifact.icon,
                        },
                        true,
                      ),
                    );
                  }}
                >
                  <BungieIcon icon={parentArtifact.icon} size={16} />
                  <span className={styles.parentArtifactLabel}>Artifact</span>
                  <span className={styles.parentArtifactName}>{parentArtifact.name}</span>
                </button>
              ) : null}
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
              {diffTabOpen ? (
                <button
                  type="button"
                  className={`${styles.diffEntityButton} ${currentInBucket ? styles.diffEntityButtonOn : ''}`}
                  aria-pressed={currentInBucket}
                  title={currentInBucket ? 'Remove from Diff bucket' : 'Add to Diff bucket'}
                  aria-label={currentInBucket ? 'Remove from Diff bucket' : 'Add to Diff bucket'}
                  onClick={toggleCurrentDiffItem}
                >
                  {currentInBucket ? <CheckIcon size={12} /> : <DiffIcon size={12} />}
                  <span>{currentInBucket ? 'In Diff' : 'Diff'}</span>
                </button>
              ) : null}
              {/* Same-hash cross-table switcher, folded inline to avoid a full row. */}
              {detail && detail.coTables.length > 0 && (
                <span
                  className={styles.coTableInline}
                  role="group"
                  aria-label="Same hash in other tables"
                >
                  <span className={styles.coTableLabel}>Also in:</span>
                  {detail.coTables.map((table) => (
                    <button
                      key={table}
                      type="button"
                      className={styles.coTableBtn}
                      title={table}
                      onClick={(e) =>
                        navigateWithFlush(
                          { table, hash: unsignedHash },
                          e.ctrlKey || e.metaKey || e.shiftKey,
                        )
                      }
                      onMouseDown={preventMiddleClickAutoScroll}
                      onAuxClick={(e) => {
                        activateOnMiddleClick(e, () =>
                          navigateWithFlush({ table, hash: unsignedHash }, true),
                        );
                      }}
                    >
                      {getShortTableName(table)}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {/* Equal-width centered tabs on phones, compact left-aligned on desktop */}
      {!diffTabActive && currentRef ? (
      <div className={styles.tabBar} role="tablist" aria-label="Inspector views">
        {TABS.map((tab) => {
          const selected = activeViewTab === tab.id;
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
        {detail && activeViewTab === 'raw' ? (
          <div className={styles.tabBarActions}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => copyText(rawJsonText, 'Copied raw JSON')}
              aria-label="Copy JSON"
              title="Copy JSON"
            >
              <CopyIcon size={13} />
              <span className={styles.actionLabel}>Copy JSON</span>
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleDownloadJson}
              aria-label="Download .json"
              title="Download .json"
            >
              <DownloadIcon size={13} />
              <span className={styles.actionLabel}>Download .json</span>
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {/* Tab panel (captures scroll across every tab for history state persistence) */}
      {diffTabOpen ? (
        <div className={styles.diffPanel} hidden={!diffTabActive}>
          <Suspense fallback={<InspectorTabFallback />}>
            <LazyDiffTab
              baseDetail={baseDetail}
              targetDetail={targetDetail}
              baseLoading={baseLoading}
              targetLoading={targetLoading}
              bucketOpen={diffBucketPopoverOpen}
              setBucketOpen={setDiffBucketPopoverOpen}
              bucketTriggerRef={diffBucketTriggerRef}
              activeItem={
                currentRef
                  ? {
                      table: currentRef.table,
                      hash: unsignedHash,
                      name: itemName,
                      subtitle: itemSubtitle,
                      icon: iconPath,
                    }
                  : null
              }
              onNavigateRef={navigateWithFlush}
              onCopy={copyText}
            />
          </Suspense>
        </div>
      ) : null}
      {!diffTabActive && currentRef ? (
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
            {visitedTabs.has('pretty') && (
              <div
                hidden={activeTab !== 'pretty'}
                className={styles.tabPanelSlot}
                data-inspector-panel-active={activeTab === 'pretty' ? 'true' : 'false'}
              >
                <JsonTree
                  key={`${activeSession?.id ?? ''}:${historyIndex}:${currentRef.table}:${currentRef.hash}`}
                  data={detail.data}
                  resolvedRefs={detail.resolvedRefs}
                  initialFilter={activeEntry?.jsonFilter}
                  onFilterChange={handleJsonFilterChange}
                  initialExpanded={activeEntry?.jsonExpanded}
                  onExpandedChange={handleJsonExpandedChange}
                  imageScaling={imageScaling}
                  onNavigateRef={navigateWithFlush}
                  onCopy={copyText}
                />
              </div>
            )}
            {visitedTabs.has('overview') && (
              <div
                hidden={activeTab !== 'overview'}
                className={styles.tabPanelSlot}
                data-inspector-panel-active={activeTab === 'overview' ? 'true' : 'false'}
              >
                <Suspense fallback={<InspectorTabFallback />}>
                  <LazyOverviewTab
                    detail={detail}
                    loadingFull={loadingFull}
                    clarityEntry={clarityEntry}
                    clarityLoading={clarityLoading}
                    showClarity={showClarity}
                    imageScaling={imageScaling}
                    onNavigateRef={navigateWithFlush}
                    onCopy={copyText}
                    onLoadFullItem={onLoadFullItem}
                  />
                </Suspense>
              </div>
            )}
            {visitedTabs.has('variants') && (
              <div
                hidden={activeTab !== 'variants'}
                className={styles.tabPanelSlot}
                data-inspector-panel-active={activeTab === 'variants' ? 'true' : 'false'}
              >
                <Suspense fallback={<InspectorTabFallback />}>
                  <LazyVariantsTab
                    currentRef={currentRef}
                    variants={variants}
                    loading={variantsLoading}
                    onNavigateRef={navigateWithFlush}
                    onDiffVariant={handleDiffVariant}
                  />
                </Suspense>
              </div>
            )}
            {visitedTabs.has('references') && (
              <div
                hidden={activeTab !== 'references'}
                className={styles.tabPanelSlot}
                data-inspector-panel-active={activeTab === 'references' ? 'true' : 'false'}
              >
                <Suspense fallback={<InspectorTabFallback />}>
                  <LazyReferencesTab
                    scopeKey={`${currentRef.table}:${currentRef.hash}`}
                    response={references}
                    loading={referencesLoading}
                    onNavigateRef={navigateWithFlush}
                    onLoadPriorityTable={onLoadPriorityTable}
                  />
                </Suspense>
              </div>
            )}
            {visitedTabs.has('raw') && (
              <div
                hidden={activeTab !== 'raw'}
                className={styles.tabPanelSlot}
                data-inspector-panel-active={activeTab === 'raw' ? 'true' : 'false'}
              >
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
              </div>
            )}
            {visitedTabs.has('history') && (
              <div
                hidden={activeViewTab !== 'history'}
                className={styles.tabPanelSlot}
                data-inspector-panel-active={activeViewTab === 'history' ? 'true' : 'false'}
              >
                <Suspense fallback={<InspectorTabFallback />}>
                  <LazyHistoryTab
                    key={`${detail.table}:${detail.hash}`}
                    table={currentRef.table}
                    hash={currentRef.hash}
                    currentData={detail.data}
                    resolvedRefs={detail.resolvedRefs}
                    imageScaling={imageScaling}
                    onNavigateRef={navigateWithFlush}
                    onCopy={copyText}
                  />
                </Suspense>
              </div>
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
      ) : null}
    </aside>
  );
}

export const DefinitionInspector = memo(DefinitionInspectorImpl);
