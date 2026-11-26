import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  SearchFilters,
  SearchResultGroup,
  SearchResultItem,
  SortMode,
  ViewMode,
} from '../types/manifest';
import { hasPositiveTableScopeInQuery } from '../manifest/query';
import {
  ARTIFACT_PERKS_TABLE,
  getFriendlyTableName,
  getShortTableName,
} from '../manifest/tables';
import { useCollectorStore } from '../stores/collector';
import {
  DIFF_BUCKET_BULK_CAP,
  useDiffBucketStore,
  type NewDiffBucketItem,
} from '../stores/diffBucket';
import { useExplorerStore } from '../stores/explorer';
import { useSettingsStore } from '../stores/settings';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  DiffIcon,
  GridIcon,
  LayersIcon,
  ListIcon,
} from '../ui/Icons';
import { getTierColorVar } from '../ui/rarity';
import { Skeleton } from '../ui/Skeleton';
import { Select, type SelectSection } from '../ui/Select';
import { BungieIcon } from './BungieIcon';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from './middleClick';
import styles from './ResultsPane.module.scss';

export interface ResultsPaneProps {
  onOpenItem: (item: SearchResultItem) => void;
  onRetryBoot: () => void;
  onLoadMore: () => void;
  onLoadAll: () => void;
  loadMoreStep: number;
  loadingMore: boolean;
  /** Unnamed definitions hidden by the current unnamed mode in this scope. */
  hiddenUnnamedCount?: number;
  /** Entries in the active table/query scope before unnamed filtering. */
  scopeEntryCount?: number;
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
const GRID_MIN_CELL_PX = 280;
const GRID_SIDE_PAD_REM = 0.5;
const GRID_GUTTER_REM = 0.5;
const GRID_TOP_PAD_REM = 0.5;
const GRID_GROUP_GAP_PX = 8;
const GROUP_HEADER_REM = 2;
const GROUP_HEADER_COARSE_REM = 2.25;
const MAX_VIRTUAL_HEIGHT = 10_000_000;
const LOAD_MORE_FOOTER_FALLBACK_HEIGHT = 88;
const MOBILE_QUERY = '(max-width: 700px)';
const COARSE_QUERY = '(max-width: 700px), (pointer: coarse)';
/** Below this scroller width the table column is replaced by an inline badge. */
const NARROW_TABLE_BADGE_PX = 560;

let savedResultsScroll: { scopeKey: string; top: number } | null = null;

export function resetSavedResultsScroll(): void {
  savedResultsScroll = null;
}

type SortField = 'relevance' | 'name' | 'hash' | 'index' | 'release' | 'update';

const GENERAL_SORT_OPTIONS: ReadonlyArray<{ value: SortField; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'name', label: 'Name' },
  { value: 'hash', label: 'Hash' },
  { value: 'index', label: 'Index' },
];

const DATE_SORT_OPTIONS: ReadonlyArray<{ value: SortField; label: string }> = [
  { value: 'release', label: 'Released' },
  { value: 'update', label: 'Updated' },
];

const DEFAULT_SORT_MODES: Record<SortField, SortMode> = {
  relevance: 'relevance',
  name: 'name-asc',
  hash: 'hash-asc',
  index: 'index-desc',
  release: 'release-desc',
  update: 'update-desc',
};

const SORT_ORDER_LABELS: Record<Exclude<SortMode, 'relevance'>, string> = {
  'name-asc': 'A–Z',
  'name-desc': 'Z–A',
  'hash-asc': 'lowest hash first',
  'hash-desc': 'highest hash first',
  'index-asc': 'oldest first',
  'index-desc': 'newest first',
  'release-asc': 'oldest release first',
  'release-desc': 'newest release first',
  'update-asc': 'least recently updated first',
  'update-desc': 'recently updated first',
};

function sortFieldForMode(sortMode: SortMode): SortField {
  if (sortMode === 'relevance') return 'relevance';
  return sortMode.slice(0, sortMode.lastIndexOf('-')) as SortField;
}

function reverseSortMode(sortMode: SortMode): SortMode {
  if (sortMode === 'relevance') return sortMode;
  const field = sortMode.slice(0, sortMode.lastIndexOf('-'));
  const direction = sortMode.endsWith('-asc') ? 'desc' : 'asc';
  return `${field}-${direction}` as SortMode;
}

function sortOrderLabel(sortMode: Exclude<SortMode, 'relevance'>): string {
  return `Sort order: ${SORT_ORDER_LABELS[sortMode]} — click to reverse`;
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const UTC_MONTH_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const UTC_MONTH_LABEL_CACHE = new Map<number, string>();

interface ResultSection {
  group: SearchResultGroup;
  startIndex: number;
  loaded: number;
  itemRows: number;
  visibleCount: number;
  top: number;
  itemTop: number;
  height: number;
  end: number;
}

interface ResultDateDisplay {
  label: string;
  dateTime?: string;
  title: string;
}

function isDateSort(sortMode: SortMode): boolean {
  return (
    sortMode === 'release-desc' ||
    sortMode === 'release-asc' ||
    sortMode === 'update-desc' ||
    sortMode === 'update-asc'
  );
}

function formatUtcMonth(epochMs: number): string {
  const cached = UTC_MONTH_LABEL_CACHE.get(epochMs);
  if (cached !== undefined) return cached;
  const label = UTC_MONTH_FORMAT.format(epochMs);
  UTC_MONTH_LABEL_CACHE.set(epochMs, label);
  return label;
}

function resultDateDisplay(
  item: SearchResultItem,
  sortMode: SortMode,
  versionDates: readonly number[],
): ResultDateDisplay | null {
  if (!isDateSort(sortMode)) return null;
  const isRelease = sortMode === 'release-desc' || sortMode === 'release-asc';
  const versionIndex = isRelease ? item.firstVersionIndex : item.lastVersionIndex;
  const timestamp =
    versionIndex !== undefined && Number.isInteger(versionIndex) && versionIndex >= 0
      ? versionDates[versionIndex]
      : undefined;
  const date = timestamp !== undefined ? new Date(timestamp) : null;

  if (
    timestamp === undefined ||
    !Number.isFinite(timestamp) ||
    !date ||
    !Number.isFinite(date.getTime())
  ) {
    return {
      label: '—',
      title: 'Date not recorded in manifest archive',
    };
  }

  const month = formatUtcMonth(timestamp);
  const inferred = isRelease && item.firstDateInferred === true;
  const label = `${inferred ? '≤ ' : ''}${month}`;
  return {
    label,
    dateTime: date.toISOString(),
    title: `${isRelease ? 'Released' : 'Updated'}${inferred ? ' on or before' : ''} ${month} (UTC)`,
  };
}

function sectionIndexAt(sections: readonly ResultSection[], offset: number): number {
  let low = 0;
  let high = sections.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sections[middle]?.top ?? Number.POSITIVE_INFINITY) <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function sectionForResult(
  sections: readonly ResultSection[],
  resultIndex: number,
): ResultSection | undefined {
  let low = 0;
  let high = sections.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const section = sections[middle];
    if (section && section.startIndex + section.loaded <= resultIndex) low = middle + 1;
    else high = middle;
  }
  const section = sections[low];
  return section && resultIndex >= section.startIndex ? section : undefined;
}

function sectionCountLabel(section: ResultSection): string {
  return section.loaded < section.group.count
    ? `${formatCount(section.loaded)} of ${formatCount(section.group.count)}`
    : formatCount(section.group.count);
}

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

// Result keys are looked up for every mounted row on every scroll frame, so
// cache the joined string on the (stable) result object instead of rebuilding
// it hundreds of times per second while the virtual window slides.
const RESULT_KEY_CACHE = new WeakMap<SearchResultItem, string>();

function resultKey(item: SearchResultItem): string {
  const cached = RESULT_KEY_CACHE.get(item);
  if (cached !== undefined) {
    return cached;
  }
  const key = `${item.table}:${item.hash}`;
  RESULT_KEY_CACHE.set(item, key);
  return key;
}

function itemLabel(item: SearchResultItem): string {
  return item.name.trim().length > 0
    ? item.name
    : `${getShortTableName(item.table)} #${item.hash}`;
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

function scrollElementTo(
  element: HTMLElement,
  logicalTop: number,
  mapLogicalToPhysical: (top: number) => number = (top) => top,
): void {
  const nextTop = Math.max(0, mapLogicalToPhysical(logicalTop));
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

const CollectedBadge = memo(function CollectedBadge(): ReactNode {
  return (
    <span className={styles.collectBadge} role="img" aria-label="Collected">
      <CheckIcon size={12} />
    </span>
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
  inDiffBucket: boolean;
  collectMode: boolean;
  showTableColumn: boolean;
  showInlineTable: boolean;
  showGridTable?: boolean;
  dateDisplay: ResultDateDisplay | null;
  positionStyle?: CSSProperties;
  onActivate: (item: SearchResultItem, index: number) => void;
  onCopyHash: (hash: number) => void;
  onToggleDiff: (item: SearchResultItem) => void;
  artifactPerksCategory: boolean;
}

const ListRow = memo(function ListRow({
  item,
  index,
  setSize,
  rowHeight,
  active,
  cursor,
  collected,
  inDiffBucket,
  collectMode,
  showTableColumn,
  showInlineTable,
  dateDisplay,
  positionStyle,
  artifactPerksCategory,
  onActivate,
  onCopyHash,
  onToggleDiff,
}: ResultRowProps): ReactNode {
  const tierColor = getTierColorVar(item.tierType);
  const parentArtifactName = item.parentArtifactName;
  const isArtifactPerk = item.isArtifactPerk === true || parentArtifactName !== undefined;
  const parentArtifactTitle = parentArtifactName
    ? `Legendary Artifact Perk · ${parentArtifactName}`
    : undefined;
  const showArtifactOnlySubtitle =
    parentArtifactName !== undefined &&
    (artifactPerksCategory || (isArtifactPerk && (showTableColumn || showInlineTable)));
  const tableBadgeLabel = isArtifactPerk ? 'Artifact Perk' : getShortTableName(item.table);
  return (
    <div
      id={`results-option-${index}`}
      className={joinClasses(
        styles.listRow,
        collectMode ? styles.collectMode : '',
        cursor ? styles.isCursor : '',
        active ? styles.isActive : '',
      )}
      style={{ ...positionStyle, height: rowHeight }}
      role="option"
      aria-selected={cursor}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      title={
        collectMode
          ? collected
            ? 'Click to remove from collector'
            : 'Click to add to collector'
          : 'Click to open in a new tab'
      }
      onClick={() => onActivate(item, index)}
      onMouseDown={preventMiddleClickAutoScroll}
      onAuxClick={(event) => {
        activateOnMiddleClick(event, () => onActivate(item, index));
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
        <span className={styles.rowSubLine} title={parentArtifactTitle}>
          {isArtifactPerk ? (
            parentArtifactName ? (
              <>
                {showArtifactOnlySubtitle ? null : (
                  <>
                    <span className={styles.artifactPerkPrefix}>Artifact Perk</span>
                    <span className={styles.artifactPerkSeparator} aria-hidden="true">
                      ·
                    </span>
                  </>
                )}
                {item.parentArtifactIcon ? (
                  <BungieIcon
                    icon={item.parentArtifactIcon}
                    size={showArtifactOnlySubtitle ? 14 : 13}
                    className={styles.artifactParentIcon}
                  />
                ) : null}
                <span
                  className={joinClasses(
                    styles.artifactParentName,
                    showArtifactOnlySubtitle ? styles.artifactParentNameLegendary : '',
                  )}
                  title={parentArtifactTitle}
                >
                  {parentArtifactName}
                </span>
              </>
            ) : artifactPerksCategory ? null : (
              <span className={styles.artifactPerkPrefix}>Artifact Perk</span>
            )
          ) : (
            <span
              className={styles.rowSub}
              style={tierColor ? { color: tierColor } : undefined}
            >
              {itemSubtitle(item)}
            </span>
          )}
          {showInlineTable ? (
            <span
              className={styles.rowTableInline}
              title={
                isArtifactPerk ? 'Legendary Artifact Perk' : getFriendlyTableName(item.table)
              }
            >
              {tableBadgeLabel}
            </span>
          ) : null}
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
        <span className={styles.rowTable}>{tableBadgeLabel}</span>
      )}
      {dateDisplay ? (
        <time
          className={styles.rowDate}
          dateTime={dateDisplay.dateTime}
          title={dateDisplay.title}
        >
          {dateDisplay.label}
        </time>
      ) : null}
      <button
        type="button"
        className={styles.rowHashBtn}
        onClick={(event) => {
          event.stopPropagation();
          onCopyHash(item.hash);
        }}
        onKeyDown={stopActivationKeys}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        title={`Copy hash ${item.hash}`}
      >
        {item.hash}
      </button>
      {collectMode && collected ? <CollectedBadge /> : null}
      <button
        type="button"
        className={styles.diffAction}
        aria-label={
          inDiffBucket
            ? `Remove ${itemLabel(item)} from Diff bucket`
            : `Add ${itemLabel(item)} to Diff bucket`
        }
        aria-pressed={inDiffBucket}
        title={inDiffBucket ? 'Remove from Diff bucket' : 'Add to Diff bucket'}
        onClick={(event) => {
          event.stopPropagation();
          onToggleDiff(item);
        }}
        onKeyDown={stopActivationKeys}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {inDiffBucket ? <CheckIcon size={13} /> : <DiffIcon size={13} />}
      </button>
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
  inDiffBucket,
  collectMode,
  showGridTable = false,
  dateDisplay,
  artifactPerksCategory,
  onActivate,
  onToggleDiff,
}: ResultRowProps): ReactNode {
  const tierColor = getTierColorVar(item.tierType);
  const parentArtifactName = item.parentArtifactName;
  const isArtifactPerk = item.isArtifactPerk === true || parentArtifactName !== undefined;
  const parentArtifactTitle = parentArtifactName
    ? `Legendary Artifact Perk · ${parentArtifactName}`
    : undefined;

  return (
    <div
      id={`results-option-${index}`}
      className={joinClasses(
        styles.gridCell,
        collectMode ? styles.collectMode : '',
        cursor ? styles.isCursor : '',
        active ? styles.isActive : '',
      )}
      role="option"
      aria-selected={cursor}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      title={`${collectMode
          ? collected
            ? 'Click to remove from collector'
            : 'Click to add to collector'
          : 'Click to open in a new tab'} · Hash ${item.hash}`}
      onClick={() => onActivate(item, index)}
      onMouseDown={preventMiddleClickAutoScroll}
      onAuxClick={(event) => {
        activateOnMiddleClick(event, () => onActivate(item, index));
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
        <span className={styles.gridSubLine} title={parentArtifactTitle}>
          {parentArtifactName && isArtifactPerk ? (
            <>
              {item.parentArtifactIcon ? (
                <BungieIcon
                  icon={item.parentArtifactIcon}
                  size={14}
                  className={styles.artifactParentIcon}
                />
              ) : null}
              <span
                className={joinClasses(
                  styles.artifactParentName,
                  styles.artifactParentNameLegendary,
                )}
                title={parentArtifactTitle}
              >
                {parentArtifactName}
              </span>
            </>
          ) : isArtifactPerk && artifactPerksCategory ? null : (
            <span
              className={styles.gridSub}
              style={tierColor ? { color: tierColor } : undefined}
            >
              {itemSubtitle(item)}
            </span>
          )}
        </span>
        <span className={styles.gridMeta}>
          {item.deepMatch ? (
            <span
              className={styles.gridDeepMatch}
              title={`${item.deepMatch.path}: ${item.deepMatch.preview}`}
            >
              {item.deepMatch.path}
            </span>
          ) : (
            <span className={styles.gridHash}>
              {dateDisplay ? (
                <time dateTime={dateDisplay.dateTime} title={dateDisplay.title}>
                  {dateDisplay.label}
                </time>
              ) : (
                item.hash
              )}
            </span>
          )}
          {showGridTable ? (
            <span
              className={styles.gridTableName}
              title={getFriendlyTableName(item.table)}
            >
              {getFriendlyTableName(item.table)}
            </span>
          ) : null}
        </span>
      </span>
      {collectMode && collected ? <CollectedBadge /> : null}
      <button
        type="button"
        className={styles.diffAction}
        aria-label={
          inDiffBucket
            ? `Remove ${itemLabel(item)} from Diff bucket`
            : `Add ${itemLabel(item)} to Diff bucket`
        }
        aria-pressed={inDiffBucket}
        title={inDiffBucket ? 'Remove from Diff bucket' : 'Add to Diff bucket'}
        onClick={(event) => {
          event.stopPropagation();
          onToggleDiff(item);
        }}
        onKeyDown={stopActivationKeys}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {inDiffBucket ? <CheckIcon size={13} /> : <DiffIcon size={13} />}
      </button>
    </div>
  );
});

/**
 * Dense, virtualized search results surface. Rows are windowed from the store
 * result array with a fixed rem-derived height so 38k+ definitions scroll
 * without layout work. Only the visible window (plus overscan) is mounted.
 */
export const ResultsPane = memo(function ResultsPane({
  onOpenItem,
  onRetryBoot,
  onLoadMore,
  onLoadAll,
  loadMoreStep,
  loadingMore,
  hiddenUnnamedCount = 0,
  scopeEntryCount = 0,
}: ResultsPaneProps): ReactNode {
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
  const tables = useExplorerStore((state) => state.tables);
  const selectedResultIndex = useExplorerStore((state) => state.selectedResultIndex);
  const setSelectedResultIndex = useExplorerStore((state) => state.setSelectedResultIndex);
  const resultGroups = useExplorerStore((state) => state.resultGroups);
  const collapsedResultGroups = useExplorerStore((state) => state.collapsedResultGroups);
  const toggleResultGroup = useExplorerStore((state) => state.toggleResultGroup);
  const setCollapsedResultGroups = useExplorerStore(
    (state) => state.setCollapsedResultGroups,
  );
  const clearCollapsedResultGroups = useExplorerStore(
    (state) => state.clearCollapsedResultGroups,
  );
  const versionDates = useExplorerStore((state) => state.versionDates);
  const entryDatesStatus = useExplorerStore((state) => state.entryDatesStatus);
  const setQuery = useExplorerStore((state) => state.setQuery);
  const setTableFilter = useExplorerStore((state) => state.setTableFilter);
  const setFilters = useExplorerStore((state) => state.setFilters);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const sessionCount = useExplorerStore((state) => state.sessions.length);
  const setMobileInspectorOpen = useExplorerStore((state) => state.setMobileInspectorOpen);
  // Primitive view of the active inspector tab. Subscribing to the whole
  // `history` array would re-render this pane on every scroll-position or
  // expanded-node save the inspector writes back into the current entry; the
  // string identity only changes when the open `table:hash` itself changes.
  const activeEntryKey = useExplorerStore((state) => {
    const entry = state.history[state.historyIndex];
    return entry ? `${entry.table}:${entry.hash}` : '';
  });

  const sortMode = useSettingsStore((state) => state.sortMode);
  const setSortMode = useSettingsStore((state) => state.setSortMode);
  const storedViewMode = useSettingsStore((state) => state.viewMode);
  const setStoredViewMode = useSettingsStore((state) => state.setViewMode);
  const groupBy = useSettingsStore((state) => state.groupBy);
  const setGroupBy = useSettingsStore((state) => state.setGroupBy);
  const uiScale = useSettingsStore((state) => state.uiScale);
  const touchSize = useSettingsStore((state) => state.touchSize);

  const collectMode = useCollectorStore((state) => state.collectMode);
  const toggleCollectMode = useCollectorStore((state) => state.toggleCollectMode);
  const collectedItems = useCollectorStore((state) => state.items);
  const diffItems = useDiffBucketStore((state) => state.items);
  const diffTabOpen = useDiffBucketStore((state) => state.diffTabOpen);
  const openTabCount = sessionCount + (diffTabOpen ? 1 : 0);

  const [remPx, setRemPx] = useState(readRootRemPx);
  const [isNarrowPhone, setIsNarrowPhone] = useState(() => mediaMatches(MOBILE_QUERY));
  const [isCoarse, setIsCoarse] = useState(() => mediaMatches(COARSE_QUERY));
  const [narrowViewChoice, setNarrowViewChoice] = useState<ViewMode | null>(null);
  const viewMode: ViewMode = isNarrowPhone ? (narrowViewChoice ?? 'list') : storedViewMode;
  const scrollScopeKey = JSON.stringify([query, deepSearch, sortMode, viewMode, groupBy, filters]);
  const [scrollTop, setScrollTop] = useState(
    () => (savedResultsScroll?.scopeKey === scrollScopeKey ? savedResultsScroll.top : 0),
  );
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(LOAD_MORE_FOOTER_FALLBACK_HEIGHT);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreFooterRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scopeKeyRef = useRef(scrollScopeKey);
  scopeKeyRef.current = scrollScopeKey;
  const prevScopeKeyRef = useRef(scrollScopeKey);
  const pendingScrollRestoreRef = useRef(
    savedResultsScroll?.scopeKey === scrollScopeKey && savedResultsScroll.top > 0,
  );

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
    // Coalesce every scroll event in a frame into a single rAF state commit so
    // fast wheel/trackpad bursts (and 277k-item flings) never queue redundant
    // renders. The scroll offset is read at frame time, not at event time, so
    // the window stays glued to the latest position.
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      const element = scrollRef.current;
      if (element) {
        pendingScrollRestoreRef.current = false;
        savedResultsScroll = {
          scopeKey: scopeKeyRef.current,
          top: element.scrollTop,
        };
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
        pendingScrollRestoreRef.current = false;
        savedResultsScroll = {
          scopeKey: scopeKeyRef.current,
          top: element.scrollTop,
        };
        setScrollTop(element.scrollTop);
      }
    });
  }, []);

  useLayoutEffect(
    () => () => {
      const element = scrollRef.current;
      // During cold hydration the browser can clamp a cached offset to zero
      // while there are no result rows. Preserve that cache until restoration
      // has a scrollable result surface to work with.
      if (
        element &&
        !(
          pendingScrollRestoreRef.current &&
          savedResultsScroll?.scopeKey === scopeKeyRef.current
        )
      ) {
        savedResultsScroll = {
          scopeKey: scopeKeyRef.current,
          top: element.scrollTop,
        };
      }
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
  const diffKeys = useMemo(() => new Set(diffItems.map((item) => item.key)), [diffItems]);

  const toggleDiffItem = useCallback((item: SearchResultItem) => {
    const diffStore = useDiffBucketStore.getState();
    const key = `${item.table}:${item.hash >>> 0}`;
    if (diffStore.items.some((entry) => entry.key === key)) {
      diffStore.removeItem(key);
      useExplorerStore.getState().pushNotice({
        tone: 'info',
        message: `Removed ${item.name || item.hash} from Diff bucket`,
      });
      return;
    }
    diffStore.addItem({
      table: item.table,
      hash: item.hash,
      name: item.name,
      subtitle: item.subtitle,
      ...(item.icon ? { icon: item.icon } : {}),
    });
    const focus = useExplorerStore.getState().sessions.length === 0;
    diffStore.openDiffTab(focus);
    if (focus) {
      useExplorerStore.getState().setMobileInspectorOpen(true);
    }
    useExplorerStore.getState().pushNotice({
      tone: 'info',
      message: `Added ${item.name || item.hash} to Diff bucket`,
    });
  }, []);

  const addCurrentResultsToDiff = useCallback(() => {
    const bucketItems: NewDiffBucketItem[] = results.map((item) => ({
      table: item.table,
      hash: item.hash,
      name: item.name,
      subtitle: item.subtitle,
      ...(item.icon ? { icon: item.icon } : {}),
    }));
    const result = useDiffBucketStore.getState().addItems(bucketItems, { cap: 100 });
    useDiffBucketStore.getState().openDiffTab(true);
    useExplorerStore.getState().setMobileInspectorOpen(true);
    useExplorerStore.getState().pushNotice({
      tone: 'info',
      message:
        result.addedCount === 0
          ? 'All matching results are already in the Diff bucket'
          : result.truncated || results.length > 100
            ? `Added ${result.addedCount} of first 100 results to Diff bucket`
            : `Added ${result.addedCount} ${result.addedCount === 1 ? 'result' : 'results'} to Diff bucket`,
    });
  }, [results]);

  const hasDeepMatches = results.length > 0 && results[0]?.deepMatch !== undefined;
  const gridSidePad = remPx * GRID_SIDE_PAD_REM;
  const gridGutter = remPx * GRID_GUTTER_REM;
  const columns =
    viewMode === 'grid'
      ? Math.max(
          1,
          Math.floor(
            (viewportWidth - 2 * gridSidePad + gridGutter) /
              (GRID_MIN_CELL_PX + gridGutter),
          ),
        )
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
  const selectedTableStatus = hasTableFilter
    ? tables.find((table) => table.name === filters.table)
    : undefined;
  const emptySelectedTable =
    hasTableFilter && selectedTableStatus?.loaded === true && selectedTableStatus.count === 0;
  const hiddenUnnamed = Math.max(0, Math.floor(hiddenUnnamedCount));
  const scopedEntryCount = Math.max(0, Math.floor(scopeEntryCount));
  const allScopeEntriesHidden = scopedEntryCount > 0 && hiddenUnnamed >= scopedEntryCount;
  const hiddenUnnamedText = `${formatCount(hiddenUnnamed)} unnamed ${
    hiddenUnnamed === 1 ? 'definition in this scope is' : 'definitions in this scope are'
  } hidden.`;
  const activeTableLabel = hasTableFilter
    ? filters.table === ARTIFACT_PERKS_TABLE
      ? 'Artifact Perks'
      : getFriendlyTableName(filters.table)
    : '';
  const hasActiveFilters =
    trimmedQuery.length > 0 || deepSearch || hasTableFilter || advancedFilterCount > 0;
  const hasResults = results.length > 0;
  const hasMoreResults = hasResults && results.length < totalMatches;
  const remaining = Math.max(0, totalMatches - results.length);
  const groupingActive = groupBy === 'table' && resultGroups.length > 0 && !deepSearch;
  const groupingBlocked =
    hasTableFilter || hasPositiveTableScopeInQuery(query) || deepSearch;
  const showTableColumn =
    filters.table === 'all' && viewportWidth > NARROW_TABLE_BADGE_PX;
  const showInlineTable =
    viewportWidth > 0 &&
    viewportWidth <= NARROW_TABLE_BADGE_PX &&
    (filters.table === 'all' || filters.table === ARTIFACT_PERKS_TABLE);
  const showGridTable =
    viewMode === 'grid' &&
    !groupingActive &&
    filters.table === 'all' &&
    !hasPositiveTableScopeInQuery(query);

  useEffect(() => {
    if (groupBy !== 'table' && Object.keys(collapsedResultGroups).length > 0) {
      clearCollapsedResultGroups();
    }
  }, [clearCollapsedResultGroups, collapsedResultGroups, groupBy]);

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

  const baseSummaryText =
    searching && !hasResults
      ? deepSearch
        ? 'Scanning JSON…'
        : 'Searching…'
      : hasActiveFilters
        ? `${formatCount(totalMatches)} matches · ${formatDuration(searchDurationMs)}`
        : `${formatCount(totalMatches)} results`;
  const dateStatusNote =
    isDateSort(sortMode) && entryDatesStatus === 'loading'
      ? 'Loading dates…'
      : isDateSort(sortMode) && entryDatesStatus === 'unavailable'
        ? 'Dates unavailable'
        : '';
  const summaryText = dateStatusNote
    ? `${baseSummaryText} · ${dateStatusNote}`
    : baseSummaryText;

  // Mobile keeps the header on one row: the full matches · duration summary is
  // too wide, so show just the compact tabular count.
  const headerSummaryText =
    isNarrowPhone && !(searching && !hasResults)
      ? dateStatusNote
        ? `${formatCount(totalMatches)} · ${dateStatusNote}`
        : formatCount(totalMatches)
      : summaryText;

  const sortSections = useMemo<readonly SelectSection<SortField>[]>(
    () => [
      { label: 'General', options: GENERAL_SORT_OPTIONS },
      {
        label: 'Dates',
        options: DATE_SORT_OPTIONS.map((option) => ({
          ...option,
          disabled: deepSearch,
        })),
      },
    ],
    [deepSearch],
  );
  const handleSortFieldChange = useCallback(
    (field: SortField) => {
      if (field !== sortFieldForMode(sortMode)) {
        setSortMode(DEFAULT_SORT_MODES[field]);
      }
    },
    [setSortMode, sortMode],
  );
  const handleSortDirectionToggle = useCallback(() => {
    if (sortMode !== 'relevance') {
      setSortMode(reverseSortMode(sortMode));
    }
  }, [setSortMode, sortMode]);

  const clampedSelectedIndex =
    results.length > 0
      ? Math.min(Math.max(selectedResultIndex, 0), results.length - 1)
      : 0;

  useEffect(() => {
    const footer = loadMoreFooterRef.current;
    if (!hasMoreResults || !footer) {
      setFooterHeight(0);
      return;
    }

    const measure = (): void => {
      const nextHeight = footer.getBoundingClientRect().height;
      if (nextHeight > 0) setFooterHeight(nextHeight);
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(footer);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [
    hasMoreResults,
    isCoarse,
    isNarrowPhone,
    loadMoreStep,
    loadingMore,
    results.length,
    totalMatches,
  ]);

  const totalRows = viewMode === 'grid' ? Math.ceil(results.length / columns) : results.length;
  const gridTopPad = viewMode === 'grid' ? remPx * GRID_TOP_PAD_REM : 0;
  const groupHeaderHeight = remPx * (isCoarse ? GROUP_HEADER_COARSE_REM : GROUP_HEADER_REM);
  const groupSections = useMemo<ResultSection[]>(() => {
    let startIndex = 0;
    let top = 0;
    return resultGroups.map((group) => {
      const loaded = Math.min(
        Math.max(0, Math.floor(group.loaded)),
        Math.max(0, results.length - startIndex),
      );
      const itemRows = viewMode === 'grid' ? Math.ceil(loaded / columns) : loaded;
      const visibleCount = collapsedResultGroups[group.key] ? 0 : itemRows;
      const itemGap =
        viewMode === 'grid' && visibleCount > 0 ? GRID_GROUP_GAP_PX : 0;
      const itemTop = top + groupHeaderHeight + itemGap;
      const height = groupHeaderHeight + itemGap + visibleCount * rowHeight;
      const end = top + height;
      const section: ResultSection = {
        group,
        startIndex,
        loaded,
        itemRows,
        visibleCount,
        top,
        itemTop,
        height,
        end,
      };
      startIndex += loaded;
      top = end;
      return section;
    });
  }, [
    columns,
    collapsedResultGroups,
    groupHeaderHeight,
    resultGroups,
    results.length,
    rowHeight,
    viewMode,
  ]);
  const groupedRowsHeight =
    groupSections.length > 0
      ? (groupSections[groupSections.length - 1]?.end ?? 0)
      : 0;
  const rawRowsHeight = groupingActive
    ? groupedRowsHeight
    : totalRows * rowHeight + gridTopPad;
  const virtualRowsHeight = Math.min(rawRowsHeight, MAX_VIRTUAL_HEIGHT);
  const isVirtualHeightCompressed = rawRowsHeight > MAX_VIRTUAL_HEIGHT;
  const effectiveFooterHeight = hasMoreResults
    ? footerHeight || LOAD_MORE_FOOTER_FALLBACK_HEIGHT
    : 0;
  const virtualHeight = virtualRowsHeight + effectiveFooterHeight;

  useLayoutEffect(() => {
    if (prevScopeKeyRef.current === scrollScopeKey) {
      return;
    }

    prevScopeKeyRef.current = scrollScopeKey;
    pendingScrollRestoreRef.current = false;
    savedResultsScroll = { scopeKey: scrollScopeKey, top: 0 };
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    setScrollTop(0);
  }, [scrollScopeKey]);

  useLayoutEffect(() => {
    const saved = savedResultsScroll;
    const element = scrollRef.current;
    if (
      !pendingScrollRestoreRef.current ||
      !element ||
      !saved ||
      saved.scopeKey !== scrollScopeKey ||
      saved.top <= 0 ||
      results.length === 0 ||
      virtualRowsHeight <= 0
    ) {
      return;
    }

    // Resolve the pending restore before writing scrollTop, so any resulting
    // scroll event cannot be mistaken for a user scroll before hydration.
    pendingScrollRestoreRef.current = false;
    element.scrollTop = saved.top;
    setScrollTop(element.scrollTop);
  }, [results.length, scrollScopeKey, virtualRowsHeight]);

  const maxPhysicalScroll = Math.max(0, virtualHeight - viewportHeight);
  const maxLogicalScroll = Math.max(0, rawRowsHeight + effectiveFooterHeight - viewportHeight);
  const logicalScrollTop = isVirtualHeightCompressed
    ? maxPhysicalScroll > 0
      ? Math.min(maxLogicalScroll, (scrollTop / maxPhysicalScroll) * maxLogicalScroll)
      : 0
    : scrollTop;
  const maxFirstRow = Math.max(0, totalRows - 1);
  const firstRow = Math.min(
    maxFirstRow,
    Math.max(0, Math.floor((logicalScrollTop - gridTopPad) / rowHeight) - OVERSCAN_ROWS),
  );
  const lastRow = Math.min(
    totalRows,
    Math.ceil((logicalScrollTop + viewportHeight - gridTopPad) / rowHeight) + OVERSCAN_ROWS,
  );
  const windowEnd = Math.min(lastRow, totalRows);
  const offsetY = isVirtualHeightCompressed
    ? scrollTop - (logicalScrollTop - firstRow * rowHeight)
    : firstRow * rowHeight;
  const groupWindowStart = Math.max(
    0,
    logicalScrollTop - OVERSCAN_ROWS * rowHeight - groupHeaderHeight,
  );
  const groupWindowEnd =
    logicalScrollTop + viewportHeight + OVERSCAN_ROWS * rowHeight + groupHeaderHeight;
  const firstGroupSectionIndex =
    groupingActive && groupSections.length > 0
      ? sectionIndexAt(groupSections, groupWindowStart)
      : 0;
  const lastGroupSectionIndex =
    groupingActive && groupSections.length > 0
      ? Math.min(
          groupSections.length - 1,
          sectionIndexAt(groupSections, groupWindowEnd),
        )
      : -1;
  const groupOffsetY = isVirtualHeightCompressed
    ? scrollTop - (logicalScrollTop - groupWindowStart)
    : groupWindowStart;
  const footerTopY = isVirtualHeightCompressed
    ? scrollTop + (rawRowsHeight - logicalScrollTop)
    : virtualRowsHeight;

  const mapLogicalToPhysical = useCallback(
    (logicalTop: number): number => {
      if (!isVirtualHeightCompressed || maxLogicalScroll <= 0) {
        return Math.max(0, logicalTop);
      }
      return (
        (Math.min(maxLogicalScroll, Math.max(0, logicalTop)) / maxLogicalScroll) *
        maxPhysicalScroll
      );
    },
    [isVirtualHeightCompressed, maxLogicalScroll, maxPhysicalScroll],
  );

  const selectedRow =
    viewMode === 'grid'
      ? Math.floor(clampedSelectedIndex / columns)
      : clampedSelectedIndex;
  const selectedSection = groupingActive
    ? sectionForResult(groupSections, clampedSelectedIndex)
    : undefined;
  const selectedGroupedTop = selectedSection
    ? selectedSection.visibleCount === 0
      ? selectedSection.top
      : selectedSection.itemTop +
        Math.floor((clampedSelectedIndex - selectedSection.startIndex) / columns) * rowHeight
    : 0;
  const selectedRendered = hasResults
    ? groupingActive
      ? selectedSection !== undefined &&
        selectedSection.visibleCount > 0 &&
        selectedGroupedTop >= groupWindowStart &&
        selectedGroupedTop < groupWindowEnd
      : selectedRow >= firstRow && selectedRow < windowEnd
    : false;
  const activeDescendant = selectedRendered
    ? `results-option-${clampedSelectedIndex}`
    : undefined;
  const activeGroupSection =
    groupingActive && groupSections.length > 0 && logicalScrollTop > 0
      ? groupSections[sectionIndexAt(groupSections, logicalScrollTop)]
      : undefined;
  const stickyGroupSection =
    activeGroupSection &&
    activeGroupSection.top + groupHeaderHeight <= logicalScrollTop
      ? activeGroupSection
      : undefined;

  const handleStickyGroupToggle = useCallback(
    (section: ResultSection) => {
      toggleResultGroup(section.group.key);
      const element = scrollRef.current;
      if (!element) return;

      // Keep the just-collapsed heading pinned at the viewport top rather than
      // leaving the user in the next section after its rows disappear.
      element.scrollTop = mapLogicalToPhysical(section.top);
      pendingScrollRestoreRef.current = false;
      savedResultsScroll = {
        scopeKey: scopeKeyRef.current,
        top: element.scrollTop,
      };
      setScrollTop(element.scrollTop);
    },
    [mapLogicalToPhysical, toggleResultGroup],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      if (isNarrowPhone) {
        setNarrowViewChoice(mode);
      }
      setStoredViewMode(mode);
    },
    [isNarrowPhone, setStoredViewMode],
  );

  const toggleGroupByTable = useCallback(() => {
    if (groupBy === 'table') {
      clearCollapsedResultGroups();
    }
    setGroupBy(groupBy === 'table' ? 'none' : 'table');
  }, [clearCollapsedResultGroups, groupBy, setGroupBy]);

  const allGroupsCollapsed =
    resultGroups.length > 0 &&
    resultGroups.every((group) => collapsedResultGroups[group.key] === true);
  const toggleAllGroups = useCallback(() => {
    if (allGroupsCollapsed) {
      setCollapsedResultGroups({});
      return;
    }
    const next: Record<string, true> = {};
    for (const group of resultGroups) {
      next[group.key] = true;
    }
    setCollapsedResultGroups(next);
  }, [allGroupsCollapsed, resultGroups, setCollapsedResultGroups]);

  const handleActivate = useCallback(
    (item: SearchResultItem, index: number) => {
      const element = scrollRef.current;
      if (element) {
        pendingScrollRestoreRef.current = false;
        savedResultsScroll = {
          scopeKey: scopeKeyRef.current,
          top: element.scrollTop,
        };
      }
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

  const clearQuery = useCallback(() => setQuery(''), [setQuery]);
  const clearTable = useCallback(() => setTableFilter('all'), [setTableFilter]);

  const resetSearch = useCallback(() => {
    setQuery('');
    resetFilters();
  }, [resetFilters, setQuery]);

  // One tap un-hides every unnamed definition in the current scope; `always`
  // also overrides any previously chosen "never" mode.
  const showUnnamed = useCallback(() => {
    setFilters({ includeUnnamed: true, unnamedMode: 'always' });
  }, [setFilters]);

  // Keep the keyboard-selected row in view ONLY when the selection index
  // actually changes (never on ordinary user scrolling).
  const prevSelectedIndexRef = useRef<number>(clampedSelectedIndex);
  const scrollMappingRef = useRef({
    isVirtualHeightCompressed,
    maxPhysicalScroll,
    maxLogicalScroll,
    viewportHeight,
    rowHeight,
    columns,
    viewMode,
    gridTopPad,
    groupingActive,
    groupSections,
    mapLogicalToPhysical,
  });
  scrollMappingRef.current = {
    isVirtualHeightCompressed,
    maxPhysicalScroll,
    maxLogicalScroll,
    viewportHeight,
    rowHeight,
    columns,
    viewMode,
    gridTopPad,
    groupingActive,
    groupSections,
    mapLogicalToPhysical,
  };

  useEffect(() => {
    if (prevSelectedIndexRef.current === clampedSelectedIndex) {
      return;
    }
    prevSelectedIndexRef.current = clampedSelectedIndex;

    const element = scrollRef.current;
    const {
      isVirtualHeightCompressed: compressed,
      maxPhysicalScroll: maxPhys,
      maxLogicalScroll: maxLog,
      viewportHeight: vpH,
      rowHeight: rH,
      columns: cols,
      viewMode: mode,
      gridTopPad: topPad,
      groupingActive: grouped,
      groupSections: sections,
      mapLogicalToPhysical: toPhysical,
    } = scrollMappingRef.current;

    if (!element || results.length === 0 || vpH <= 0 || rH <= 0) {
      return;
    }

    const selectedSection = grouped
      ? sectionForResult(sections, clampedSelectedIndex)
      : undefined;
    if (grouped && !selectedSection) return;
    const rowIndex =
      mode === 'grid' ? Math.floor(clampedSelectedIndex / cols) : clampedSelectedIndex;
    const selectedGroupCollapsed =
      selectedSection !== undefined && selectedSection.visibleCount === 0;
    const rowTop = selectedSection
      ? selectedGroupCollapsed
        ? selectedSection.top
        : selectedSection.itemTop +
          Math.floor((clampedSelectedIndex - selectedSection.startIndex) / cols) * rH
      : (mode === 'grid' ? topPad : 0) + rowIndex * rH;
    const rowBottom = rowTop + (selectedGroupCollapsed ? groupHeaderHeight : rH);
    const physTop = element.scrollTop;
    const currentTop = compressed
      ? maxPhys > 0
        ? Math.min(maxLog, (physTop / maxPhys) * maxLog)
        : 0
      : physTop;
    const currentBottom = currentTop + vpH;

    if (rowTop < currentTop) {
      scrollElementTo(element, rowTop, toPhysical);
    } else if (rowBottom > currentBottom) {
      scrollElementTo(element, rowBottom - vpH, toPhysical);
    }
  }, [
    clampedSelectedIndex,
    groupHeaderHeight,
    groupSections,
    groupingActive,
    results.length,
  ]);

  const artifactPerksCategory = filters.table === ARTIFACT_PERKS_TABLE;

  // The virtual window is rebuilt only when its contents can actually change.
  // Scroll frames that keep the same row range reuse these element objects, so
  // the memoized rows/cells bail out of reconciliation while only the window
  // transform moves. Every callback prop is a stable `useCallback` hook and all
  // other row props are primitives, so `React.memo` stays effective per frame.
  const rows = useMemo<ReactNode[]>(() => {
    const nextRows: ReactNode[] = [];

    if (!hasResults) {
      return nextRows;
    }

    if (groupingActive) {
      for (
        let sectionIndex = firstGroupSectionIndex;
        sectionIndex <= lastGroupSectionIndex;
        sectionIndex += 1
      ) {
        const section = groupSections[sectionIndex];
        if (!section) continue;

        if (
          section.top + groupHeaderHeight > groupWindowStart &&
          section.top < groupWindowEnd
        ) {
          const collapsed = collapsedResultGroups[section.group.key] === true;
          nextRows.push(
            <button
              key={`group-header-${section.group.key}`}
              type="button"
              className={styles.groupHeader}
              data-group-header=""
              data-group-key={section.group.key}
              aria-expanded={!collapsed}
              title={`${collapsed ? 'Expand' : 'Collapse'} ${section.group.label}`}
              onClick={() => toggleResultGroup(section.group.key)}
              onKeyDown={stopActivationKeys}
              style={{
                position: 'absolute',
                top: section.top - groupWindowStart,
                height: groupHeaderHeight,
              }}
            >
              <ChevronRightIcon
                className={joinClasses(
                  styles.groupChevron,
                  !collapsed ? styles.groupChevronExpanded : '',
                )}
                size={14}
              />
              <span className={styles.groupLabel}>{section.group.label}</span>
              <span className={styles.groupCount}>{sectionCountLabel(section)}</span>
            </button>,
          );
        }

        const firstItemRow = Math.max(
          0,
          Math.floor((groupWindowStart - section.itemTop) / rowHeight),
        );
        const lastItemRow = Math.max(
          0,
          Math.min(
            section.visibleCount,
            Math.ceil((groupWindowEnd - section.itemTop) / rowHeight),
          ),
        );

        if (viewMode === 'list') {
          for (let rowIndex = firstItemRow; rowIndex < lastItemRow; rowIndex += 1) {
            const index = section.startIndex + rowIndex;
            const item = results[index];
            if (!item) continue;
            const itemKey = resultKey(item);
            nextRows.push(
              <ListRow
                key={itemKey}
                item={item}
                index={index}
                setSize={results.length}
                rowHeight={rowHeight}
                active={itemKey === activeEntryKey}
                cursor={index === clampedSelectedIndex}
                collected={collectedKeys.has(itemKey)}
                inDiffBucket={diffKeys.has(itemKey)}
                collectMode={collectMode}
                showTableColumn={false}
                showInlineTable={false}
                dateDisplay={resultDateDisplay(item, sortMode, versionDates)}
                positionStyle={{
                  position: 'absolute',
                  top: section.itemTop + rowIndex * rowHeight - groupWindowStart,
                  right: 0,
                  left: 0,
                }}
                artifactPerksCategory={artifactPerksCategory}
                onActivate={handleActivate}
                onCopyHash={handleCopyHash}
                onToggleDiff={toggleDiffItem}
              />,
            );
          }
          continue;
        }

        for (let rowIndex = firstItemRow; rowIndex < lastItemRow; rowIndex += 1) {
          const start = section.startIndex + rowIndex * columns;
          const cells: ReactNode[] = [];
          const sectionEnd = section.startIndex + section.loaded;
          for (let column = 0; column < columns; column += 1) {
            const index = start + column;
            if (index >= sectionEnd) break;
            const item = results[index];
            if (!item) break;
            const itemKey = resultKey(item);
            cells.push(
              <GridCell
                key={itemKey}
                item={item}
                index={index}
                setSize={results.length}
                rowHeight={rowHeight}
                active={itemKey === activeEntryKey}
                cursor={index === clampedSelectedIndex}
                collected={collectedKeys.has(itemKey)}
                inDiffBucket={diffKeys.has(itemKey)}
                collectMode={collectMode}
                showTableColumn={false}
                showInlineTable={false}
                showGridTable={false}
                dateDisplay={resultDateDisplay(item, sortMode, versionDates)}
                artifactPerksCategory={artifactPerksCategory}
                onActivate={handleActivate}
                onToggleDiff={toggleDiffItem}
                onCopyHash={handleCopyHash}
              />,
            );
          }

          if (cells.length === 0) continue;
          const logicalTop = section.itemTop + rowIndex * rowHeight;
          nextRows.push(
            <div
              key={`grid-group-row-${section.group.key}-${rowIndex}`}
              className={styles.gridRow}
              data-group-row={section.group.key}
              style={{
                position: 'absolute',
                top: logicalTop - groupWindowStart,
                right: 0,
                left: 0,
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
      return nextRows;
    }

    if (viewMode === 'list') {
      for (let index = firstRow; index < windowEnd; index += 1) {
        const item = results[index];
        if (!item) continue;
        const itemKey = resultKey(item);
        nextRows.push(
          <ListRow
            key={itemKey}
            item={item}
            index={index}
            setSize={results.length}
            rowHeight={rowHeight}
            active={itemKey === activeEntryKey}
            cursor={index === clampedSelectedIndex}
            collected={collectedKeys.has(itemKey)}
            inDiffBucket={diffKeys.has(itemKey)}
            collectMode={collectMode}
            showTableColumn={showTableColumn}
            showInlineTable={showInlineTable}
            dateDisplay={resultDateDisplay(item, sortMode, versionDates)}
            artifactPerksCategory={artifactPerksCategory}
            onActivate={handleActivate}
            onCopyHash={handleCopyHash}
            onToggleDiff={toggleDiffItem}
          />,
        );
      }
      return nextRows;
    }

    for (let rowIndex = firstRow; rowIndex < windowEnd; rowIndex += 1) {
      const start = rowIndex * columns;
      const cells: ReactNode[] = [];

      for (let column = 0; column < columns; column += 1) {
        const index = start + column;
        const item = results[index];
        if (!item) break;
        const itemKey = resultKey(item);
        cells.push(
          <GridCell
            key={itemKey}
            item={item}
            index={index}
            setSize={results.length}
            rowHeight={rowHeight}
            active={itemKey === activeEntryKey}
            cursor={index === clampedSelectedIndex}
            collected={collectedKeys.has(itemKey)}
            inDiffBucket={diffKeys.has(itemKey)}
            collectMode={collectMode}
            showTableColumn={false}
            showInlineTable={showInlineTable}
            showGridTable={showGridTable}
            dateDisplay={resultDateDisplay(item, sortMode, versionDates)}
            artifactPerksCategory={artifactPerksCategory}
            onActivate={handleActivate}
            onToggleDiff={toggleDiffItem}
            onCopyHash={handleCopyHash}
          />,
        );
      }

      if (cells.length === 0) continue;

      nextRows.push(
        <div
          key={`grid-row-${rowIndex}`}
          className={joinClasses(
            styles.gridRow,
            rowIndex === totalRows - 1 ? styles.gridRowEnd : '',
          )}
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

    return nextRows;
  }, [
    activeEntryKey,
    artifactPerksCategory,
    clampedSelectedIndex,
    collectMode,
    collectedKeys,
    diffKeys,
    columns,
    collapsedResultGroups,
    firstGroupSectionIndex,
    firstRow,
    groupHeaderHeight,
    groupSections,
    groupWindowEnd,
    groupWindowStart,
    groupingActive,
    handleActivate,
    handleCopyHash,
    hasResults,
    lastGroupSectionIndex,
    results,
    rowHeight,
    sortMode,
    showInlineTable,
    showGridTable,
    showTableColumn,
    toggleResultGroup,
    toggleDiffItem,
    totalRows,
    versionDates,
    viewMode,
    windowEnd,
  ]);

  return (
    <section className={styles.pane} aria-label="Search results">
      <header className={styles.header}>
        <div
          className={joinClasses(
            styles.headerInfo,
            isNarrowPhone && hasTableFilter ? styles.headerInfoWithTable : '',
          )}
        >
          <span className={styles.summary} title={summaryText}>
            {headerSummaryText}
          </span>
          {hasActiveFilters && totalMatches > 0 && results.length > 0 ? (
            <button
              type="button"
              className={styles.bulkDiffButton}
              onClick={addCurrentResultsToDiff}
              title={`Add ${Math.min(results.length, DIFF_BUCKET_BULK_CAP)} loaded results to Diff bucket`}
              aria-label={`Add ${Math.min(results.length, DIFF_BUCKET_BULK_CAP)} loaded results to Diff bucket`}
              onKeyDown={stopActivationKeys}
            >
              <DiffIcon size={12} />
              <span>Diff</span>
            </button>
          ) : null}

          {isNarrowPhone && hasTableFilter ? (
            <span className={styles.tableChip}>
              <span className={styles.tableChipLabel} title={activeTableLabel}>
                {activeTableLabel}
              </span>
              <button
                type="button"
                className={styles.tableChipClear}
                aria-label="Clear table filter"
                title="Clear table filter"
                onClick={clearTable}
                onKeyDown={stopActivationKeys}
              >
                <CloseIcon size={10} />
              </button>
            </span>
          ) : null}

          {hasActiveFilters ? (
            <div className={styles.chips} role="group" aria-label="Active filters">
              {deepSearch ? (
                <span className={styles.chip}>
                  <span className={styles.chipLabel}>Deep Search</span>
                  <button
                    type="button"
                    className={styles.chipClear}
                    aria-label="Disable deep search"
                    title="Disable deep search"
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
                    {activeTableLabel}
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
          {isNarrowPhone && openTabCount > 0 ? (
            <button
              type="button"
              className={styles.tabsBtn}
              onClick={() => setMobileInspectorOpen(true)}
              aria-label={
                sessionCount === 0 && diffTabOpen
                  ? 'Return to Diff tab'
                  : `Return to open tabs, ${openTabCount}`
              }
              title={
                sessionCount === 0 && diffTabOpen
                  ? 'Return to Diff tab'
                  : `Open tabs (${openTabCount})`
              }
            >
              {sessionCount === 0 && diffTabOpen ? 'Diff' : `Tabs (${openTabCount})`}
            </button>
          ) : null}

          <div
            className={joinClasses(
              styles.sortControl,
              sortMode !== 'relevance' ? styles.sortControlJoined : '',
            )}
          >
            <Select
              className={styles.sort}
              value={sortFieldForMode(sortMode)}
              sections={sortSections}
              aria-label="Sort results"
              title="Sort results"
              align="end"
              minPopupWidth={176}
              onChange={handleSortFieldChange}
              onTriggerKeyDown={stopActivationKeys}
            />
            {sortMode !== 'relevance' ? (
              <button
                type="button"
                className={styles.sortDirBtn}
                aria-label={sortOrderLabel(sortMode)}
                title={sortOrderLabel(sortMode)}
                onClick={handleSortDirectionToggle}
                onKeyDown={stopActivationKeys}
              >
                {sortMode.endsWith('-asc') ? (
                  <ArrowUpIcon size={12} />
                ) : (
                  <ArrowDownIcon size={12} />
                )}
              </button>
            ) : null}
          </div>

          {!isNarrowPhone && viewportWidth >= 520 ? (
            <button
              type="button"
              className={joinClasses(
                styles.groupToggle,
                groupBy === 'table' ? styles.groupToggleActive : '',
              )}
              aria-pressed={groupBy === 'table'}
              aria-label="Group by table"
              title={
                groupingBlocked
                  ? deepSearch
                    ? 'Grouping is unavailable in Deep Search.'
                    : 'Grouping is available only when searching all tables.'
                  : 'Group results by table'
              }
              disabled={groupingBlocked}
              onClick={toggleGroupByTable}
              onKeyDown={stopActivationKeys}
            >
              <LayersIcon size={13} />
              <span>Group</span>
            </button>
          ) : null}

          {groupingActive && !isNarrowPhone && viewportWidth >= 640 ? (
            <button
              type="button"
              className={styles.groupCollapseToggle}
              aria-label={
                allGroupsCollapsed ? 'Expand all result groups' : 'Collapse all result groups'
              }
              title={allGroupsCollapsed ? 'Expand all groups' : 'Collapse all groups'}
              onClick={toggleAllGroups}
              onKeyDown={stopActivationKeys}
            >
              {allGroupsCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          ) : null}

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
          aria-busy={searching || loadingMore || showBootSkeleton || undefined}
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
              {emptySelectedTable ? (
                <>
                  <p className={styles.stateTitle}>No definitions in this table.</p>
                  <p className={styles.stateText}>
                    This table has no definitions in this manifest version.
                  </p>
                  <div className={styles.stateActions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={clearTable}
                      onKeyDown={stopActivationKeys}
                    >
                      Show all tables
                    </button>
                  </div>
                </>
              ) : hiddenUnnamed > 0 ? (
                <>
                  <p className={styles.stateTitle}>
                    {allScopeEntriesHidden
                      ? 'Only unnamed definitions are in this scope.'
                      : 'Unnamed definitions are hidden.'}
                  </p>
                  <p className={styles.stateText}>{hiddenUnnamedText}</p>
                  <div className={styles.stateActions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={showUnnamed}
                      onKeyDown={stopActivationKeys}
                    >
                      Show unnamed
                    </button>
                  </div>
                </>
              ) : trimmedQuery.length > 0 ? (
                <>
                  <p className={styles.stateTitle}>No definitions match this query.</p>
                  <p className={styles.stateText}>
                    Try a shorter term, or reset the search to browse the full manifest.
                  </p>
                  <div className={styles.stateActions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={resetSearch}
                      onKeyDown={stopActivationKeys}
                    >
                      Reset search
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.stateTitle}>Nothing matches the active filters.</p>
                  <p className={styles.stateText}>
                    Clear the active filters to browse the full manifest.
                  </p>
                  <div className={styles.stateActions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={resetFilters}
                      onKeyDown={stopActivationKeys}
                    >
                      Clear filters
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {groupingActive ? (
                <button
                  type="button"
                  className={joinClasses(
                    styles.stickyGroupIndicator,
                    stickyGroupSection ? styles.stickyGroupActive : '',
                  )}
                  data-sticky-group-indicator=""
                  aria-hidden={!stickyGroupSection}
                  aria-label={
                    stickyGroupSection
                      ? `${stickyGroupSection.group.label}, ${sectionCountLabel(stickyGroupSection)}`
                      : undefined
                  }
                  aria-expanded={
                    stickyGroupSection
                      ? collapsedResultGroups[stickyGroupSection.group.key] !== true
                      : undefined
                  }
                  disabled={!stickyGroupSection}
                  onClick={
                    stickyGroupSection
                      ? () => handleStickyGroupToggle(stickyGroupSection)
                      : undefined
                  }
                  onKeyDown={stopActivationKeys}
                  style={{ height: groupHeaderHeight, marginBottom: -groupHeaderHeight }}
                >
                  {stickyGroupSection ? (
                    <>
                      <ChevronRightIcon
                        className={joinClasses(
                          styles.groupChevron,
                          collapsedResultGroups[stickyGroupSection.group.key] !== true
                            ? styles.groupChevronExpanded
                            : '',
                        )}
                        size={14}
                      />
                      <span className={styles.groupLabel}>{stickyGroupSection.group.label}</span>
                      <span className={styles.groupCount}>
                        {sectionCountLabel(stickyGroupSection)}
                      </span>
                    </>
                  ) : null}
                </button>
              ) : null}
              <div
                className={styles.virtualSpace}
                data-virtual-space=""
                style={{ height: virtualHeight }}
                role="presentation"
              >
                <div
                  className={joinClasses(
                    styles.virtualWindow,
                    viewMode === 'grid' && !groupingActive ? styles.gridVirtualWindow : '',
                  )}
                  style={{
                    transform: `translateY(${groupingActive ? groupOffsetY : offsetY}px)`,
                  }}
                  role="presentation"
                >
                  {rows}
                </div>
                {hasMoreResults ? (
                  <div
                    ref={loadMoreFooterRef}
                    className={styles.loadMoreBar}
                    style={{ top: footerTopY }}
                    role="group"
                    aria-label="Load more results"
                  >
                    <span className={styles.loadMoreProgress}>
                      Showing {formatCount(results.length)} of {formatCount(totalMatches)} results
                    </span>
                    <div className={styles.loadMoreActions}>
                      {remaining <= loadMoreStep ? (
                        <button
                          type="button"
                          className={styles.loadMoreButton}
                          onClick={onLoadMore}
                          disabled={loadingMore || searching}
                        >
                          {`Load remaining ${formatCount(remaining)}`}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={styles.loadMoreButton}
                            onClick={onLoadMore}
                            disabled={loadingMore || searching}
                          >
                            {`Load ${formatCount(loadMoreStep)} more`}
                          </button>
                          <button
                            type="button"
                            className={styles.loadMoreButton}
                            onClick={onLoadAll}
                            disabled={loadingMore || searching}
                          >
                            {`Load all (${formatCount(totalMatches)})`}
                          </button>
                        </>
                      )}
                    </div>
                    {loadingMore ? (
                      <span className={styles.loadMoreStatus} role="status" aria-live="polite">
                        Loading…
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
});
