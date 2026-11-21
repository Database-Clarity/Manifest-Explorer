import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  SearchFilters,
  SearchResultItem,
  SortMode,
  ViewMode,
} from '../types/manifest';
import { getFriendlyTableName, getShortTableName } from '../manifest/tables';
import { useCollectorStore } from '../stores/collector';
import { useExplorerStore } from '../stores/explorer';
import { useSettingsStore } from '../stores/settings';
import { CheckIcon, CloseIcon, GridIcon, ListIcon, PlusIcon } from '../ui/Icons';
import { getTierColorVar } from '../ui/rarity';
import { Skeleton } from '../ui/Skeleton';
import { BungieIcon } from './BungieIcon';
import styles from './ResultsPane.module.scss';

export interface ResultsPaneProps {
  onOpenItem: (item: SearchResultItem) => void;
  onRetryBoot: () => void;
}

const OVERSCAN_ROWS = 10;
const LIST_ROW_REM = 3;
const LIST_ROW_REM_COARSE = 3.375;
const LIST_ROW_DEEP_REM = 4;
const LIST_ROW_DEEP_REM_COARSE = 4.375;
const GRID_ROW_REM = 5;
const GRID_ROW_REM_COARSE = 5.5;
const GRID_ROW_DEEP_REM = 6;
const GRID_ROW_DEEP_REM_COARSE = 6.5;
const GRID_MIN_CELL_PX = 220;
const GRID_GUTTER_PX = 16;
const MOBILE_QUERY = '(max-width: 700px)';
const COARSE_QUERY = '(max-width: 700px), (pointer: coarse)';

const SORT_OPTIONS: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'hash-asc', label: 'Hash ↑' },
  { value: 'hash-desc', label: 'Hash ↓' },
  { value: 'index-desc', label: 'Index ↓' },
];

const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

function readRootRemPx(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 16;
  }
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(value) && value > 0 ? value : 16;
}

function mediaMatches(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  );
}

function formatCount(value: number): string {
  return COUNT_FORMAT.format(Number.isFinite(value) ? Math.max(0, value) : 0);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0 ms';
  }
  if (ms < 10) {
    return `${ms.toFixed(1)} ms`;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function resultKey(item: SearchResultItem): string {
  return `${item.table}:${item.hash}`;
}

function itemLabel(item: SearchResultItem): string {
  return item.name.length > 0 ? item.name : 'Unnamed definition';
}

function itemSubtitle(item: SearchResultItem): string {
  return item.subtitle.length > 0 ? item.subtitle : getFriendlyTableName(item.table);
}

function countAdvancedFilters(filters: SearchFilters): number {
  let count = 0;
  if (filters.tierTypes.length > 0) count += 1;
  if (filters.damageTypes.length > 0) count += 1;
  if (filters.classTypes.length > 0) count += 1;
  if (filters.itemTypes.length > 0) count += 1;
  if (filters.itemCategoryHashes.length > 0) count += 1;
  if (filters.includeUnnamed) count += 1;
  if (filters.onlyRedacted) count += 1;
  return count;
}

function stopActivationKeys(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.stopPropagation();
  }
}

function scrollElementTo(element: HTMLElement, top: number): void {
  const nextTop = Math.max(0, top);
  if (typeof element.scrollTo === 'function') {
    try {
      element.scrollTo({ top: nextTop, behavior: 'smooth' });
      return;
    } catch {
      // Fall back to an immediate scroll in non-browser environments.
    }
  }
  element.scrollTop = nextTop;
}

interface CollectButtonProps {
  item: SearchResultItem;
  collected: boolean;
  collectMode: boolean;
  onToggle: (item: SearchResultItem) => void;
}

const CollectButton = memo(function CollectButton({
  item,
  collected,
  collectMode,
  onToggle,
}: CollectButtonProps): ReactNode {
  const label = itemLabel(item);

  return (
    <button
      type="button"
      className={joinClasses(
        styles.collectToggle,
        collected || collectMode ? styles.alwaysOn : '',
        collected ? styles.collectedToggle : '',
      )}
      aria-label={collected ? `Remove ${label} from collector` : `Add ${label} to collector`}
      aria-pressed={collected}
      title={collected ? 'Remove from collector' : 'Add to collector'}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(item);
      }}
      onKeyDown={stopActivationKeys}
    >
      {collected ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
    </button>
  );
});

interface ResultRowProps {
  item: SearchResultItem;
  index: number;
  setSize: number;
  rowHeight: number;
  active: boolean;
  cursor: boolean;
  collected: boolean;
  collectMode: boolean;
  showTableColumn: boolean;
  onActivate: (item: SearchResultItem, index: number) => void;
  onToggleCollect: (item: SearchResultItem) => void;
  onCopyHash: (hash: number) => void;
}

const ListRow = memo(function ListRow({
  item,
  index,
  setSize,
  rowHeight,
  active,
  cursor,
  collected,
  collectMode,
  showTableColumn,
  onActivate,
  onToggleCollect,
  onCopyHash,
}: ResultRowProps): ReactNode {
  const tierColor = getTierColorVar(item.tierType);

  return (
    <div
      id={`results-option-${index}`}
      className={joinClasses(
        styles.listRow,
        cursor ? styles.isCursor : '',
        active ? styles.isActive : '',
      )}
      style={{ height: rowHeight }}
      role="option"
      aria-selected={cursor}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      title="Click to open in a new tab"
      onClick={() => onActivate(item, index)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onActivate(item, index);
        }
      }}
    >
      <BungieIcon
        icon={item.icon}
        watermark={item.iconWatermark}
        isEnhanced={item.isEnhanced}
        size={34}
      />
      <span className={styles.rowText}>
        <span className={styles.rowName}>{itemLabel(item)}</span>
        <span
          className={styles.rowSub}
          style={tierColor ? { color: tierColor } : undefined}
        >
          {itemSubtitle(item)}
        </span>
        {item.deepMatch && (
          <span
            className={styles.rowDeepMatch}
            title={`${item.deepMatch.path}: ${item.deepMatch.preview}`}
          >
            <span className={styles.rowDeepPath}>{item.deepMatch.path}</span>
            <span className={styles.rowDeepPreview}>{item.deepMatch.preview}</span>
          </span>
        )}
      </span>
      {showTableColumn && (
        <span className={styles.rowTable}>{getShortTableName(item.table)}</span>
      )}
      <button
        type="button"
        className={styles.rowHashBtn}
        onClick={(event) => {
          event.stopPropagation();
          onCopyHash(item.hash);
        }}
        onKeyDown={stopActivationKeys}
        title={`Copy hash ${item.hash}`}
      >
        {item.hash}
      </button>
      <CollectButton
        item={item}
        collected={collected}
        collectMode={collectMode}
        onToggle={onToggleCollect}
      />
    </div>
  );
});

const GridCell = memo(function GridCell({
  item,
  index,
  setSize,
  active,
  cursor,
  collected,
  collectMode,
  onActivate,
  onToggleCollect,
}: ResultRowProps): ReactNode {
  const tierColor = getTierColorVar(item.tierType);

  return (
    <div
      id={`results-option-${index}`}
      className={joinClasses(
        styles.gridCell,
        cursor ? styles.isCursor : '',
        active ? styles.isActive : '',
      )}
      role="option"
      aria-selected={cursor}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      title="Click to open in a new tab"
      onClick={() => onActivate(item, index)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onActivate(item, index);
        }
      }}
    >
      <BungieIcon
        icon={item.icon}
        watermark={item.iconWatermark}
        isEnhanced={item.isEnhanced}
        size={40}
      />
      <span className={styles.gridText}>
        <span className={styles.gridName}>{itemLabel(item)}</span>
        <span
          className={styles.gridSub}
          style={tierColor ? { color: tierColor } : undefined}
        >
          {itemSubtitle(item)}
        </span>
        {item.deepMatch ? (
          <span
            className={styles.gridDeepMatch}
            title={`${item.deepMatch.path}: ${item.deepMatch.preview}`}
          >
            {item.deepMatch.path}
          </span>
        ) : (
          <span className={styles.gridHash}>{item.hash}</span>
        )}
      </span>
      <CollectButton
        item={item}
        collected={collected}
        collectMode={collectMode}
        onToggle={onToggleCollect}
      />
    </div>
  );
});

/**
 * Dense, virtualized search results surface. Rows are windowed from the store
 * result array with a fixed rem-derived height so 38k+ definitions scroll
 * without layout work. Only the visible window (plus overscan) is mounted.
 */
export function ResultsPane({ onOpenItem, onRetryBoot }: ResultsPaneProps): ReactNode {
  const results = useExplorerStore((state) => state.results);
  const totalMatches = useExplorerStore((state) => state.totalMatches);
  const searchDurationMs = useExplorerStore((state) => state.searchDurationMs);
  const searching = useExplorerStore((state) => state.searching);
  const phase = useExplorerStore((state) => state.manifestStatus.phase);
  const manifestError = useExplorerStore((state) => state.manifestStatus.error);
  const query = useExplorerStore((state) => state.query);
  const deepSearch = useExplorerStore((state) => state.deepSearch);
  const setDeepSearch = useExplorerStore((state) => state.setDeepSearch);
  const filters = useExplorerStore((state) => state.filters);
  const selectedResultIndex = useExplorerStore((state) => state.selectedResultIndex);
  const setSelectedResultIndex = useExplorerStore((state) => state.setSelectedResultIndex);
  const setQuery = useExplorerStore((state) => state.setQuery);
  const setTableFilter = useExplorerStore((state) => state.setTableFilter);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const history = useExplorerStore((state) => state.history);
  const historyIndex = useExplorerStore((state) => state.historyIndex);

  const sortMode = useSettingsStore((state) => state.sortMode);
  const setSortMode = useSettingsStore((state) => state.setSortMode);
  const storedViewMode = useSettingsStore((state) => state.viewMode);
  const setStoredViewMode = useSettingsStore((state) => state.setViewMode);
  const uiScale = useSettingsStore((state) => state.uiScale);
  const touchSize = useSettingsStore((state) => state.touchSize);

  const collectMode = useCollectorStore((state) => state.collectMode);
  const toggleCollectMode = useCollectorStore((state) => state.toggleCollectMode);
  const collectedItems = useCollectorStore((state) => state.items);
  const toggleItem = useCollectorStore((state) => state.toggleItem);

  const [remPx, setRemPx] = useState(readRootRemPx);
  const [isNarrowPhone, setIsNarrowPhone] = useState(() => mediaMatches(MOBILE_QUERY));
  const [isCoarse, setIsCoarse] = useState(() => mediaMatches(COARSE_QUERY));
  const [narrowViewChoice, setNarrowViewChoice] = useState<ViewMode | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mobileMedia = window.matchMedia(MOBILE_QUERY);
    const coarseMedia = window.matchMedia(COARSE_QUERY);

    const update = (): void => {
      setRemPx(readRootRemPx());
      setIsNarrowPhone(mobileMedia.matches);
      setIsCoarse(coarseMedia.matches);
    };

    update();
    mobileMedia.addEventListener('change', update);
    coarseMedia.addEventListener('change', update);

    return () => {
      mobileMedia.removeEventListener('change', update);
      coarseMedia.removeEventListener('change', update);
    };
  }, [uiScale, touchSize]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const measure = (): void => {
      setViewportWidth(element.clientWidth);
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      const element = scrollRef.current;
      if (element) {
        setScrollTop(element.scrollTop);
      }
      return;
    }

    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = scrollRef.current;
      if (element) {
        setScrollTop(element.scrollTop);
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    },
    [],
  );

  const collectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of collectedItems) {
      keys.add(`${item.table}:${item.hash}`);
    }
    return keys;
  }, [collectedItems]);

  const viewMode: ViewMode = isNarrowPhone ? (narrowViewChoice ?? 'list') : storedViewMode;
  const hasDeepMatches = results.length > 0 && results[0]?.deepMatch !== undefined;
  const columns =
    viewMode === 'grid'
      ? Math.max(1, Math.floor((viewportWidth - GRID_GUTTER_PX) / GRID_MIN_CELL_PX))
      : 1;
  const rowHeight =
    remPx *
    (viewMode === 'grid'
      ? hasDeepMatches
        ? isCoarse
          ? GRID_ROW_DEEP_REM_COARSE
          : GRID_ROW_DEEP_REM
        : isCoarse
          ? GRID_ROW_REM_COARSE
          : GRID_ROW_REM
      : hasDeepMatches
        ? isCoarse
          ? LIST_ROW_DEEP_REM_COARSE
          : LIST_ROW_DEEP_REM
        : isCoarse
          ? LIST_ROW_REM_COARSE
          : LIST_ROW_REM);

  const trimmedQuery = query.trim();
  const advancedFilterCount = countAdvancedFilters(filters);
  const hasTableFilter = filters.table !== 'all' && filters.table.length > 0;
  const hasActiveFilters =
    trimmedQuery.length > 0 || deepSearch || hasTableFilter || advancedFilterCount > 0;
  const hasResults = results.length > 0;

  const showError = phase === 'error' && !hasResults;
  const isBooting = phase === 'idle' || phase === 'fetching-index' || phase === 'loading-core';
  const showBootSkeleton = !showError && !hasResults && (isBooting || searching);
  const showEmpty = !showError && !showBootSkeleton && !hasResults;

  const bootStatus =
    phase === 'fetching-index'
      ? 'Fetching Destiny 2 manifest index…'
      : phase === 'loading-core'
        ? 'Indexing core definitions…'
        : searching
          ? deepSearch
            ? 'Scanning raw JSON definitions…'
            : 'Searching definitions…'
          : 'Preparing Destiny 2 manifest…';

  const summaryText =
    searching && !hasResults
      ? deepSearch
        ? 'Scanning JSON…'
        : 'Searching…'
      : hasActiveFilters
        ? `${formatCount(totalMatches)} matches · ${formatDuration(searchDurationMs)}`
        : `${formatCount(totalMatches)} results`;

  const clampedSelectedIndex =
    results.length > 0
      ? Math.min(Math.max(selectedResultIndex, 0), results.length - 1)
      : 0;

  const totalRows = viewMode === 'grid' ? Math.ceil(results.length / columns) : results.length;
  const maxFirstRow = Math.max(0, totalRows - 1);
  const firstRow = Math.min(
    maxFirstRow,
    Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS),
  );
  const lastRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS,
  );
  const windowEnd = Math.min(lastRow, totalRows);
  const offsetY = firstRow * rowHeight;
  const virtualHeight = totalRows * rowHeight;

  const selectedRow =
    viewMode === 'grid'
      ? Math.floor(clampedSelectedIndex / columns)
      : clampedSelectedIndex;
  const selectedRendered =
    hasResults && selectedRow >= firstRow && selectedRow < windowEnd;
  const activeDescendant = selectedRendered
    ? `results-option-${clampedSelectedIndex}`
    : undefined;

  const activeRef = historyIndex >= 0 ? history[historyIndex] : undefined;

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      if (isNarrowPhone) {
        setNarrowViewChoice(mode);
      }
      setStoredViewMode(mode);
    },
    [isNarrowPhone, setStoredViewMode],
  );

  const handleSortChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const next = SORT_OPTIONS.find((option) => option.value === event.target.value);
      if (next) {
        setSortMode(next.value);
      }
    },
    [setSortMode],
  );

  const handleActivate = useCallback(
    (item: SearchResultItem, index: number) => {
      setSelectedResultIndex(index);
      onOpenItem(item);
    },
    [onOpenItem, setSelectedResultIndex],
  );

  const handleCopyHash = useCallback((hash: number) => {
    void navigator.clipboard
      .writeText(String(hash))
      .then(() => {
        useExplorerStore.getState().pushNotice({
          tone: 'info',
          message: `Copied hash ${hash}`,
        });
      })
      .catch(() => undefined);
  }, []);

  const handleToggleCollect = useCallback(
    (item: SearchResultItem) => {
      toggleItem({
        table: item.table,
        hash: item.hash,
        name: item.name,
        subtitle: item.subtitle,
        icon: item.icon,
      });
    },
    [toggleItem],
  );

  const clearQuery = useCallback(() => setQuery(''), [setQuery]);
  const clearTable = useCallback(() => setTableFilter('all'), [setTableFilter]);

  const resetSearch = useCallback(() => {
    setQuery('');
    resetFilters();
  }, [resetFilters, setQuery]);

  // Keep the keyboard-selected row in view when ↑/↓ (or j/k) changes it.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || results.length === 0 || viewportHeight <= 0 || rowHeight <= 0) {
      return;
    }

    const rowIndex =
      viewMode === 'grid'
        ? Math.floor(clampedSelectedIndex / columns)
        : clampedSelectedIndex;
    const rowTop = rowIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const currentTop = element.scrollTop;
    const currentBottom = currentTop + element.clientHeight;

    if (rowTop < currentTop) {
      scrollElementTo(element, rowTop);
    } else if (rowBottom > currentBottom) {
      scrollElementTo(element, rowBottom - element.clientHeight);
    }
  }, [
    clampedSelectedIndex,
    columns,
    results.length,
    rowHeight,
    viewMode,
    viewportHeight,
  ]);

  const rows: ReactNode[] = [];

  if (hasResults) {
    if (viewMode === 'list') {
      for (let index = firstRow; index < windowEnd; index += 1) {
        const item = results[index];
        if (!item) continue;
        rows.push(
          <ListRow
            key={resultKey(item)}
            item={item}
            index={index}
            setSize={results.length}
            rowHeight={rowHeight}
            active={
              activeRef !== undefined &&
              activeRef.table === item.table &&
              activeRef.hash === item.hash
            }
            cursor={index === clampedSelectedIndex}
            collected={collectedKeys.has(resultKey(item))}
            collectMode={collectMode}
            showTableColumn={filters.table === 'all' && viewportWidth >= 520}
            onActivate={handleActivate}
            onToggleCollect={handleToggleCollect}
            onCopyHash={handleCopyHash}
          />,
        );
      }
    } else {
      for (let rowIndex = firstRow; rowIndex < windowEnd; rowIndex += 1) {
        const start = rowIndex * columns;
        const cells: ReactNode[] = [];

        for (let column = 0; column < columns; column += 1) {
          const index = start + column;
          const item = results[index];
          if (!item) break;
          cells.push(
            <GridCell
              key={resultKey(item)}
              item={item}
              index={index}
              setSize={results.length}
              rowHeight={rowHeight}
              active={
                activeRef !== undefined &&
                activeRef.table === item.table &&
                activeRef.hash === item.hash
              }
              cursor={index === clampedSelectedIndex}
              collected={collectedKeys.has(resultKey(item))}
              collectMode={collectMode}
              showTableColumn={false}
              onActivate={handleActivate}
              onToggleCollect={handleToggleCollect}
              onCopyHash={handleCopyHash}
            />,
          );
        }

        if (cells.length === 0) continue;

        rows.push(
          <div
            key={`grid-row-${rowIndex}`}
            className={styles.gridRow}
            style={{
              height: rowHeight,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
            role="presentation"
          >
            {cells}
          </div>,
        );
      }
    }
  }

  return (
    <section className={styles.pane} aria-label="Search results">
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <span className={styles.summary}>{summaryText}</span>

          {hasActiveFilters ? (
            <div className={styles.chips} role="group" aria-label="Active filters">
              {deepSearch ? (
                <span className={styles.chip}>
                  <span className={styles.chipLabel}>Deep JSON</span>
                  <button
                    type="button"
                    className={styles.chipClear}
                    aria-label="Disable deep JSON search"
                    title="Disable deep JSON search"
                    onClick={() => setDeepSearch(false)}
                    onKeyDown={stopActivationKeys}
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              ) : null}

              {trimmedQuery.length > 0 ? (
                <span className={styles.chip}>
                  <span className={styles.chipLabel} title={trimmedQuery}>
                    {trimmedQuery}
                  </span>
                  <button
                    type="button"
                    className={styles.chipClear}
                    aria-label="Clear search query"
                    title="Clear search query"
                    onClick={clearQuery}
                    onKeyDown={stopActivationKeys}
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              ) : null}

              {hasTableFilter ? (
                <span className={styles.chip}>
                  <span className={styles.chipLabel} title={filters.table}>
                    {getFriendlyTableName(filters.table)}
                  </span>
                  <button
                    type="button"
                    className={styles.chipClear}
                    aria-label="Clear table filter"
                    title="Clear table filter"
                    onClick={clearTable}
                    onKeyDown={stopActivationKeys}
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              ) : null}

              {advancedFilterCount > 0 ? (
                <span className={styles.chip}>
                  <span className={styles.chipLabel}>
                    {advancedFilterCount} {advancedFilterCount === 1 ? 'filter' : 'filters'}
                  </span>
                  <button
                    type="button"
                    className={styles.chipClear}
                    aria-label="Clear all filters"
                    title="Clear all filters"
                    onClick={resetFilters}
                    onKeyDown={stopActivationKeys}
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.controls}>
          <select
            className={styles.sort}
            value={sortMode}
            aria-label="Sort results"
            title="Sort results"
            onChange={handleSortChange}
            onKeyDown={stopActivationKeys}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className={styles.segmented} role="group" aria-label="Result view">
            <button
              type="button"
              className={joinClasses(
                styles.segment,
                viewMode === 'list' ? styles.segmentActive : '',
              )}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              title="List view"
              onClick={() => handleViewModeChange('list')}
              onKeyDown={stopActivationKeys}
            >
              <ListIcon size={14} />
            </button>
            <button
              type="button"
              className={joinClasses(
                styles.segment,
                viewMode === 'grid' ? styles.segmentActive : '',
              )}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
              onClick={() => handleViewModeChange('grid')}
              onKeyDown={stopActivationKeys}
            >
              <GridIcon size={14} />
            </button>
          </div>
        </div>
      </header>

      {collectMode ? (
        <div className={styles.collectBanner} role="status">
          <span className={styles.bannerText}>
            Collect mode active — click results to add hashes
          </span>
          <button
            type="button"
            className={styles.bannerDone}
            onClick={toggleCollectMode}
            onKeyDown={stopActivationKeys}
          >
            Done
          </button>
        </div>
      ) : null}

      <div className={styles.body}>
        <div
          ref={scrollRef}
          className={styles.scroller}
          onScroll={handleScroll}
          tabIndex={hasResults ? 0 : -1}
          role={hasResults ? 'listbox' : undefined}
          aria-label="Search results"
          aria-activedescendant={activeDescendant}
          aria-busy={searching || showBootSkeleton || undefined}
        >
          {showBootSkeleton ? (
            <div className={styles.stateBody} role="status" aria-live="polite">
              <p className={styles.stateStatus}>{bootStatus}</p>
              <div className={styles.skeletonList} aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <div className={styles.skeletonRow} key={index}>
                    <Skeleton width={34} height={34} radius="0.1875rem" />
                    <span className={styles.skeletonText}>
                      <Skeleton width="42%" height="0.75rem" />
                      <Skeleton width="26%" height="0.625rem" />
                    </span>
                    <Skeleton width="4.5rem" height="0.625rem" />
                  </div>
                ))}
              </div>
            </div>
          ) : showError ? (
            <div className={styles.stateBlock} role="alert">
              <p className={styles.stateTitle}>Couldn't load the manifest.</p>
              <p className={styles.stateText}>
                {manifestError && manifestError.trim().length > 0
                  ? manifestError
                  : 'The manifest index or core definitions could not be loaded.'}{' '}
                Check your connection and retry.
              </p>
              <div className={styles.stateActions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={onRetryBoot}
                  onKeyDown={stopActivationKeys}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : showEmpty ? (
            <div className={styles.stateBlock} role="status">
              <p className={styles.stateTitle}>No definitions match this query.</p>
              <p className={styles.stateText}>
                {trimmedQuery.length > 0
                  ? 'Try a shorter term, or reset the search to browse the full manifest.'
                  : 'Clear the active filters to browse the full manifest.'}
              </p>
              <div className={styles.stateActions}>
                {trimmedQuery.length > 0 ? (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={resetSearch}
                    onKeyDown={stopActivationKeys}
                  >
                    Reset search
                  </button>
                ) : null}
                {hasTableFilter || advancedFilterCount > 0 ? (
                  <button
                    type="button"
                    className={trimmedQuery.length > 0 ? styles.secondaryBtn : styles.primaryBtn}
                    onClick={resetFilters}
                    onKeyDown={stopActivationKeys}
                  >
                    Clear filters
                  </button>
                ) : null}
                {trimmedQuery.length === 0 && !hasTableFilter && advancedFilterCount === 0 ? (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={resetFilters}
                    onKeyDown={stopActivationKeys}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className={styles.virtualSpace}
              style={{ height: virtualHeight }}
              role="presentation"
            >
              <div
                className={styles.virtualWindow}
                style={{ transform: `translateY(${offsetY}px)` }}
                role="presentation"
              >
                {rows}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
