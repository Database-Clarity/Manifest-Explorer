import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type {
  DefinitionRef,
  ImageScalingMode,
  ResolvedHashSummary,
} from '../../types/manifest';
import { annotateEnumField } from '../../manifest/enums';
import {
  bungieAssetUrl,
  getTargetTablesForField,
  getTargetTablesForObjectKey,
  isBungieImagePath,
  toUnsignedHash,
} from '../../manifest/hash';
import { getShortTableName } from '../../manifest/tables';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  ExternalLinkIcon,
} from '../../ui/Icons';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import {
  activateOnMiddleClick,
  preventMiddleClickAutoScroll,
} from '../middleClick';
import styles from './JsonTree.module.scss';

const LazyColorSwatchWidget = lazy(() =>
  import('./ColorSwatchWidget').then((module) => ({
    default: module.ColorSwatchWidget,
  })),
);
const LazyImageLightbox = lazy(() =>
  import('./ImageLightbox').then((module) => ({ default: module.ImageLightbox })),
);

export interface JsonTreeProps {
  data: Record<string, unknown>;
  /** Previous snapshot. When supplied, Pretty opens in a change-focused diff view. */
  diffBefore?: unknown;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
  /** Seed/sync the filter, for example when restoring tab history or Deep Search. */
  initialFilter?: string;
  onFilterChange?: (filter: string) => void;
  /** Restored manual expand/collapse overrides keyed by JSON path. */
  initialExpanded?: Record<string, boolean>;
  onExpandedChange?: (expanded: Record<string, boolean>) => void;
  imageScaling?: ImageScalingMode;
  /** Let the containing History page own vertical scrolling. */
  embedded?: boolean;
}

interface ColorSwatch {
  r: number;
  g: number;
  b: number;
  a: number;
}

function asColorSwatch(value: unknown): ColorSwatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.red === 'number' &&
    typeof obj.green === 'number' &&
    typeof obj.blue === 'number'
  ) {
    const a = typeof obj.alpha === 'number' ? obj.alpha / 255 : 1;
    return {
      r: Math.max(0, Math.min(255, Math.round(obj.red))),
      g: Math.max(0, Math.min(255, Math.round(obj.green))),
      b: Math.max(0, Math.min(255, Math.round(obj.blue))),
      a: Math.max(0, Math.min(1, a)),
    };
  }
  return null;
}

function getCollapsedPeek(value: Record<string, unknown>, isArray: boolean): string | null {
  if (isArray) {
    return null;
  }
  const name = value.name;
  if (typeof name === 'string' && name.trim().length > 0) {
    const trimmed = name.trim();
    return `"${trimmed.length > 36 ? `${trimmed.slice(0, 35)}…` : trimmed}"`;
  }
  const dp = value.displayProperties;
  if (typeof dp === 'object' && dp !== null && typeof (dp as Record<string, unknown>).name === 'string') {
    const dpName = String((dp as Record<string, unknown>).name).trim();
    if (dpName) {
      return `"${dpName.length > 36 ? `${dpName.slice(0, 35)}…` : dpName}"`;
    }
  }
  if (Array.isArray(value.socketEntries) && Array.isArray(value.socketCategories)) {
    return `${value.socketCategories.length} categories, ${value.socketEntries.length} sockets`;
  }
  if (typeof value.tierTypeName === 'string' && value.tierTypeName) {
    return `"${value.tierTypeName}"`;
  }
  return null;
}

function highlightText(text: string, needle: string, active = false): ReactNode {
  if (!needle) {
    return text;
  }
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, idx)}
      <mark className={active ? `${styles.match} ${styles.matchActive}` : styles.match}>
        {text.slice(idx, idx + needle.length)}
      </mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

function resolveHashForNode(
  fieldName: string,
  parentKey: string | undefined,
  value: number,
  resolvedRefs: Record<string, ResolvedHashSummary>,
): ResolvedHashSummary | null {
  if (!Number.isInteger(value) || value === 0) {
    return null;
  }
  if (fieldName === 'hash' && parentKey === undefined) {
    return null;
  }
  const unsigned = toUnsignedHash(value);
  const targets = getTargetTablesForField(fieldName, parentKey);

  if (targets.length > 0) {
    for (const table of targets) {
      const direct = resolvedRefs[`${table}:${unsigned}`];
      if (direct) {
        return direct;
      }
    }
    return null;
  }

  const looksLikeHashKey =
    /hash(es)?$/i.test(fieldName) ||
    (parentKey !== undefined && /hash(es)?$/i.test(parentKey));
  if (looksLikeHashKey) {
    const anyMatch = resolvedRefs[String(unsigned)];
    if (anyMatch) {
      return anyMatch;
    }
  }

  return null;
}

/**
 * Resolve a numeric object key such as `stats.stats["4284893193"]` against the
 * definition's resolved refs. The parent property tells us which table the key
 * belongs to; bare-key entries are the fallback for older payloads.
 */
function resolveObjectKeyRef(
  nodeKey: string,
  parentKey: string | undefined,
  resolvedRefs: Record<string, ResolvedHashSummary>,
): ResolvedHashSummary | null {
  if (!/^\d+$/.test(nodeKey)) {
    return null;
  }
  const numeric = Number(nodeKey);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    return null;
  }

  const unsigned = toUnsignedHash(numeric);
  for (const table of getTargetTablesForObjectKey(parentKey)) {
    const direct = resolvedRefs[`${table}:${unsigned}`] ?? resolvedRefs[`${table}:${nodeKey}`];
    if (direct) {
      return direct;
    }
  }

  return resolvedRefs[nodeKey] ?? resolvedRefs[String(unsigned)] ?? null;
}

/**
 * Nested values are walked up to this many levels below the node the filter is
 * invoked on. Object results are memoized per call depth in a per-filter-pass
 * cache, so repeated renders never re-walk deep values.
 */
const FILTER_MAX_DEPTH = 8;
const CHILDREN_CHUNK_SIZE = 120;

type FilterCache = ReadonlyArray<WeakMap<object, boolean>>;

function createFilterCache(): FilterCache {
  return Array.from(
    { length: FILTER_MAX_DEPTH + 1 },
    () => new WeakMap<object, boolean>(),
  );
}

function refLabelMatches(
  table: string,
  name: string | undefined,
  filterLower: string,
): boolean {
  return (
    (typeof name === 'string' && name.toLowerCase().includes(filterLower)) ||
    getShortTableName(table).toLowerCase().includes(filterLower)
  );
}

/**
 * Does this node itself match the query? Runs before any descendant walking so
 * resolved context labels ("Stat: Reload Speed") and enum annotations
 * ("Solar", "Exotic") match exactly like raw keys and values. Keeping this
 * check outside the object cache means the cached subtree result is still keyed
 * only by object identity (a parsed manifest definition is a tree), while the
 * per-node context lookup stays correct for its own key/parent pair.
 */
function matchesNodeSelf(
  nodeKey: string,
  parentKey: string | undefined,
  value: unknown,
  filterLower: string,
  resolvedRefs: Record<string, ResolvedHashSummary>,
): boolean {
  if (!filterLower) {
    return false;
  }
  if (nodeKey.toLowerCase().includes(filterLower)) {
    return true;
  }
  if (value === null || value === undefined) {
    return 'null'.includes(filterLower);
  }
  if (typeof value === 'string') {
    return value.toLowerCase().includes(filterLower);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (String(value).toLowerCase().includes(filterLower)) {
      return true;
    }
    if (typeof value !== 'number') {
      return false;
    }
    const resolvedRef = resolveHashForNode(
      nodeKey,
      parentKey,
      value,
      resolvedRefs,
    );
    if (
      resolvedRef &&
      refLabelMatches(resolvedRef.table, resolvedRef.name, filterLower)
    ) {
      return true;
    }
    const enumInfo = annotateEnumField(nodeKey, value, parentKey);
    return enumInfo
      ? enumInfo.label.toLowerCase().includes(filterLower) ||
          enumInfo.enumName.toLowerCase().includes(filterLower)
      : false;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const objectRef = resolveObjectKeyRef(nodeKey, parentKey, resolvedRefs);
    if (
      objectRef &&
      refLabelMatches(objectRef.table, objectRef.name, filterLower)
    ) {
      return true;
    }
  }
  return false;
}

function matchesFilter(
  key: string,
  value: unknown,
  filterLower: string,
  depth: number,
  cache: FilterCache,
  parentKey: string | undefined,
  resolvedRefs: Record<string, ResolvedHashSummary>,
): boolean {
  if (!filterLower) {
    return true;
  }
  if (matchesNodeSelf(key, parentKey, value, filterLower, resolvedRefs)) {
    return true;
  }
  if (typeof value !== 'object' || value === null || depth > FILTER_MAX_DEPTH) {
    return false;
  }
  const bucket = cache[depth];
  if (!bucket) {
    return false;
  }
  const cached = bucket.get(value);
  if (cached !== undefined) {
    return cached;
  }
  let result = false;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (
        matchesFilter(
          String(index),
          value[index],
          filterLower,
          depth + 1,
          cache,
          key,
          resolvedRefs,
        )
      ) {
        result = true;
        break;
      }
    }
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (
        entry &&
        matchesFilter(
          entry[0],
          entry[1],
          filterLower,
          depth + 1,
          cache,
          key,
          resolvedRefs,
        )
      ) {
        result = true;
        break;
      }
    }
  }
  bucket.set(value, result);
  return result;
}

interface FindMatch {
  path: string;
  ancestorPaths: string[];
}

const MAX_FIND_MATCHES = 5_000;

interface FindMatchesResult {
  matches: readonly FindMatch[];
  truncated: boolean;
}

const NO_FIND_MATCHES: readonly FindMatch[] = [];

function collectFindMatches(
  data: Record<string, unknown>,
  filterLower: string,
  resolvedRefs: Record<string, ResolvedHashSummary>,
): FindMatchesResult {
  const matches: FindMatch[] = [];
  // A single mutable ancestor stack: `ancestors.slice()` only runs when a
  // match is actually recorded, keeping large definitions O(N) instead of O(N²).
  const ancestors: string[] = [];

  const visit = (
    nodeKey: string,
    parentKey: string | undefined,
    path: string,
    value: unknown,
  ): void => {
    if (matches.length > MAX_FIND_MATCHES) return;
    if (matchesNodeSelf(nodeKey, parentKey, value, filterLower, resolvedRefs)) {
      matches.push({ path, ancestorPaths: ancestors.slice() });
    }

    if (Array.isArray(value)) {
      ancestors.push(path);
      for (
        let index = 0;
        index < value.length && matches.length <= MAX_FIND_MATCHES;
        index += 1
      ) {
        const childKey = String(index);
        visit(childKey, nodeKey, `${path}[${childKey}]`, value[index]);
      }
      ancestors.pop();
    } else if (typeof value === 'object' && value !== null) {
      ancestors.push(path);
      const entries = Object.entries(value as Record<string, unknown>);
      for (
        let index = 0;
        index < entries.length && matches.length <= MAX_FIND_MATCHES;
        index += 1
      ) {
        const entry = entries[index];
        if (!entry) {
          continue;
        }
        visit(entry[0], nodeKey, `${path}.${entry[0]}`, entry[1]);
      }
      ancestors.pop();
    }
  };

  const rootEntries = Object.entries(data);
  for (
    let index = 0;
    index < rootEntries.length && matches.length <= MAX_FIND_MATCHES;
    index += 1
  ) {
    const entry = rootEntries[index];
    if (!entry) {
      continue;
    }
    visit(entry[0], undefined, entry[0], entry[1]);
  }
  return {
    matches: matches.slice(0, MAX_FIND_MATCHES),
    truncated: matches.length > MAX_FIND_MATCHES,
  };
}

type JsonNodeDiffKind = 'added' | 'removed' | 'changed' | 'same';

interface JsonNodeDiff {
  kind: JsonNodeDiffKind;
  hasChanges: boolean;
  oldValue?: unknown;
}

interface JsonTreeDiff {
  data: Record<string, unknown>;
  nodes: ReadonlyMap<string, JsonNodeDiff>;
}

function isTreeContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function treeChildPath(parentPath: string, key: string, isArray: boolean): string {
  if (isArray) return `${parentPath}[${key}]`;
  return parentPath ? `${parentPath}.${key}` : key;
}

function createJsonTreeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): JsonTreeDiff {
  const nodes = new Map<string, JsonNodeDiff>();

  const markSubtree = (
    path: string,
    value: unknown,
    kind: 'added' | 'removed',
  ): void => {
    nodes.set(path, { kind, hasChanges: true });
    if (Array.isArray(value)) {
      value.forEach((child, index) =>
        markSubtree(treeChildPath(path, String(index), true), child, kind),
      );
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
        markSubtree(treeChildPath(path, key, false), child, kind),
      );
    }
  };

  const markDescendants = (
    path: string,
    value: unknown,
    kind: 'added' | 'removed',
  ): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) =>
        markSubtree(treeChildPath(path, String(index), true), child, kind),
      );
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
        markSubtree(treeChildPath(path, key, false), child, kind),
      );
    }
  };

  const mergeNode = (
    path: string,
    oldValue: unknown,
    newValue: unknown,
    hasOld: boolean,
    hasNew: boolean,
  ): unknown => {
    if (!hasOld) {
      markSubtree(path, newValue, 'added');
      return newValue;
    }
    if (!hasNew) {
      markSubtree(path, oldValue, 'removed');
      return oldValue;
    }

    if (
      isTreeContainer(oldValue) &&
      isTreeContainer(newValue) &&
      Array.isArray(oldValue) === Array.isArray(newValue)
    ) {
      const oldArray = Array.isArray(oldValue);
      const newArray = Array.isArray(newValue);
      const keys =
        oldArray && newArray
          ? Array.from(
              { length: Math.max(oldValue.length, newValue.length) },
              (_, index) => String(index),
            )
          : [
              ...Object.keys(newValue as Record<string, unknown>),
              ...Object.keys(oldValue as Record<string, unknown>).filter(
                (key) => !Object.prototype.hasOwnProperty.call(newValue, key),
              ),
            ];
      const mergedEntries: Array<readonly [string, unknown]> = [];
      let hasChanges = false;

      keys.forEach((key) => {
        const childHasOld = oldArray
          ? Number(key) < (oldValue as unknown[]).length
          : Object.prototype.hasOwnProperty.call(oldValue, key);
        const childHasNew = newArray
          ? Number(key) < (newValue as unknown[]).length
          : Object.prototype.hasOwnProperty.call(newValue, key);
        const childPath = treeChildPath(path, key, oldArray);
        const child = mergeNode(
          childPath,
          oldArray
            ? (oldValue as unknown[])[Number(key)]
            : (oldValue as Record<string, unknown>)[key],
          newArray
            ? (newValue as unknown[])[Number(key)]
            : (newValue as Record<string, unknown>)[key],
          childHasOld,
          childHasNew,
        );
        mergedEntries.push([key, child]);
        hasChanges ||= nodes.get(childPath)?.hasChanges ?? false;
      });

      const mergedValue = oldArray
        ? mergedEntries.map(([, child]) => child)
        : Object.fromEntries(mergedEntries);
      nodes.set(path, {
        kind: hasChanges ? 'changed' : 'same',
        hasChanges,
      });
      return mergedValue;
    }

    if (Object.is(oldValue, newValue)) {
      nodes.set(path, { kind: 'same', hasChanges: false });
      return newValue;
    }

    nodes.set(path, { kind: 'changed', hasChanges: true, oldValue });
    if (isTreeContainer(newValue)) {
      markDescendants(path, newValue, 'added');
    }
    return newValue;
  };

  const merged = mergeNode('', before, after, true, true);
  return {
    data: (merged ?? {}) as Record<string, unknown>,
    nodes,
  };
}

interface InlineImagePreviewProps {
  path: string;
  imageScaling: ImageScalingMode;
  onOpenLightbox: (url: string, path: string) => void;
}

function InlineImagePreview({
  path,
  imageScaling,
  onOpenLightbox,
}: InlineImagePreviewProps): ReactNode {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [errored, setErrored] = useState(false);
  const url = bungieAssetUrl(path);
  const isScreenshot = /screenshot|banner|pgcr/i.test(path);
  const isInteger = imageScaling === 'integer';

  if (errored) {
    return null;
  }

  const iconSize = dims ? (dims.w === 96 ? 96 : dims.w) : 96;

  return (
    <div className={styles.imagePreview}>
      <button
        type="button"
        className={isScreenshot ? styles.screenshotBtn : styles.iconPreviewBtn}
        onClick={() => onOpenLightbox(url, path)}
        title="Open full-size image"
        aria-label={`Open image ${path}`}
      >
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className={isScreenshot ? styles.screenshotImg : styles.iconImg}
          style={
            isInteger
              ? {
                  imageRendering: 'pixelated',
                  width: isScreenshot ? undefined : iconSize,
                  height: isScreenshot ? undefined : iconSize,
                }
              : undefined
          }
          data-scaling={imageScaling}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setDims({ w: img.naturalWidth, h: img.naturalHeight });
            }
          }}
          onError={() => setErrored(true)}
        />
      </button>
      <div className={styles.imageMeta}>
        {dims && (
          <span className={styles.imageDims}>
            {dims.w} × {dims.h}
          </span>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.imageLink}
        >
          Open asset
          <ExternalLinkIcon size={12} />
        </a>
      </div>
    </div>
  );
}

/**
 * Manual expand/collapse overrides live in a tiny external store so that
 * toggling one node only re-renders that node (its descendants mount/unmount)
 * instead of the whole tree. JsonTree still persists the full map through
 * `onExpandedChange` and seeds it from `initialExpanded`.
 */
interface ExpansionStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: (path: string) => boolean | undefined;
  readonly set: (path: string, open: boolean) => Record<string, boolean>;
  readonly reset: () => Record<string, boolean>;
}

function createExpansionStore(initial: Record<string, boolean>): ExpansionStore {
  let expandedMap: Record<string, boolean> = { ...initial };
  const listeners = new Set<() => void>();

  const emit = (): void => {
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: (path) => expandedMap[path],
    set: (path, open) => {
      expandedMap = { ...expandedMap, [path]: open };
      emit();
      return expandedMap;
    },
    reset: () => {
      expandedMap = {};
      emit();
      return expandedMap;
    },
  };
}

interface NodeProps {
  nodeKey: string;
  parentKey?: string;
  path: string;
  value: unknown;
  depth: number;
  filterLower: string;
  searchMode: 'filter' | 'find';
  ancestorMatched?: boolean;
  activeMatchPath: string | null;
  expandedByFind: ReadonlySet<string>;
  expandGeneration: { mode: 'default' | 'expand' | 'collapse'; seq: number };
  filterCache: FilterCache;
  diffMode: boolean;
  diffNodes: ReadonlyMap<string, JsonNodeDiff> | null;
  expansionStore: ExpansionStore;
  onTogglePath: (path: string, nextOpen: boolean) => void;
  selectedActionPath: string | null;
  onRowClick: (path: string, event: MouseEvent<HTMLDivElement>) => void;
  onDismissRowActions: () => void;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
  onOpenLightbox: (url: string, path: string) => void;
  imageScaling: ImageScalingMode;
  isArrayItem?: boolean;
}

function PreviousScalarValue({
  nodeKey,
  parentKey,
  value,
  resolvedRefs,
  onNavigateRef,
}: {
  nodeKey: string;
  parentKey?: string;
  value: unknown;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
}): ReactNode {
  const valueClass =
    typeof value === 'string' || isTreeContainer(value)
      ? styles.valString
      : typeof value === 'number'
        ? styles.valNumber
        : typeof value === 'boolean'
          ? styles.valBoolean
          : styles.valNull;
  const valueText =
    typeof value === 'string'
      ? `"${JSON.stringify(value).slice(1, -1)}"`
      : isTreeContainer(value)
        ? JSON.stringify(value, null, 2)
        : String(value ?? 'null');
  const resolvedRef =
    typeof value === 'number'
      ? resolveHashForNode(nodeKey, parentKey, value, resolvedRefs)
      : null;
  const enumInfo =
    typeof value === 'number' ? annotateEnumField(nodeKey, value, parentKey) : null;
  const ref: DefinitionRef | null = resolvedRef
    ? {
        table: resolvedRef.table,
        hash: resolvedRef.hash,
        label: resolvedRef.name || undefined,
        icon: resolvedRef.icon,
      }
    : null;

  return (
    <>
      <span className={styles.diffOldValue}>
        <del className={valueClass}>{valueText}</del>
        {resolvedRef && ref ? (
          <button
            type="button"
            className={`${styles.annotation} ${styles.annotationRef} ${styles.refBadge}`}
            onClick={(event) => onNavigateRef(ref, event.ctrlKey || event.metaKey)}
            onMouseDown={preventMiddleClickAutoScroll}
            onAuxClick={(event) =>
              activateOnMiddleClick(event, () => onNavigateRef(ref, true))
            }
            title={`${resolvedRef.table}:${resolvedRef.hash}${resolvedRef.subtitle ? ` — ${resolvedRef.subtitle}` : ''}`}
          >
            <span className={styles.refTable}>{getShortTableName(resolvedRef.table)}</span>
            <span className={styles.refName}>
              &quot;{resolvedRef.name || 'Unnamed'}&quot;
            </span>
          </button>
        ) : enumInfo ? (
          <span className={`${styles.annotation} ${styles.annotationEnum}`}>
            <span className={styles.enumType}>{enumInfo.enumName}</span>
            <span className={styles.enumDot}>{enumInfo.isBitmask ? ': ' : '.'}</span>
            <span className={styles.enumLabel}>{enumInfo.label}</span>
          </span>
        ) : null}
      </span>
      <span className={styles.diffArrow} aria-hidden="true">→</span>
    </>
  );
}

const JsonNode = memo(function JsonNode({
  nodeKey,
  parentKey,
  path,
  value,
  depth,
  filterLower,
  searchMode,
  ancestorMatched = false,
  activeMatchPath,
  expandedByFind,
  expandGeneration,
  filterCache,
  diffMode,
  diffNodes,
  expansionStore,
  onTogglePath,
  selectedActionPath,
  onRowClick,
  onDismissRowActions,
  resolvedRefs,
  onNavigateRef,
  onCopy,
  onOpenLightbox,
  imageScaling,
  isArrayItem = false,
}: NodeProps): ReactNode {
  const manualOpen = useSyncExternalStore(
    expansionStore.subscribe,
    () => expansionStore.getSnapshot(path),
    () => expansionStore.getSnapshot(path),
  );
  const [childLimit, setChildLimit] = useState(CHILDREN_CHUNK_SIZE);
  const selfKeyMatches = filterLower.length > 0 && nodeKey.toLowerCase().includes(filterLower);
  const selfMatches =
    searchMode === 'filter' &&
    filterLower.length > 0 &&
    matchesNodeSelf(nodeKey, parentKey, value, filterLower, resolvedRefs);
  const preserveSubtree =
    searchMode === 'filter' && filterLower.length > 0 && (ancestorMatched || selfMatches);
  const isActiveMatch = searchMode === 'find' && path === activeMatchPath;
  const diffNode = diffMode ? diffNodes?.get(path) : undefined;
  const diffKind = diffNode?.kind;
  const diffHasChanges = diffNode?.hasChanges ?? false;
  const defaultExpanded =
    depth === 0 &&
    (nodeKey === 'displayProperties' || nodeKey === 'inventory' || nodeKey === 'equippingBlock');

  const isObject = typeof value === 'object' && value !== null;
  const isArray = Array.isArray(value);
  const hasDescendantMatch =
    searchMode === 'filter' &&
    filterLower.length > 0 &&
    !selfMatches &&
    !ancestorMatched &&
    isObject &&
    matchesFilter(
      nodeKey,
      value,
      filterLower,
      0,
      filterCache,
      parentKey,
      resolvedRefs,
    );
  const isAutoExpandedForSearch =
    searchMode === 'filter'
      ? filterLower.length > 0 && (selfMatches || hasDescendantMatch)
      : searchMode === 'find' && expandedByFind.has(path);
  const isExpanded =
    manualOpen !== undefined
      ? manualOpen
      : isAutoExpandedForSearch
        ? true
        : diffMode && diffHasChanges
          ? true
          : expandGeneration.mode === 'expand'
            ? depth < 6
            : expandGeneration.mode === 'collapse'
              ? false
              : defaultExpanded;

  if (isObject) {
    const arrayValue = isArray ? (value as unknown[]) : null;
    const objectValue = isArray ? null : (value as Record<string, unknown>);
    const objectKeys = isExpanded && objectValue ? Object.keys(objectValue) : null;
    const count = arrayValue
      ? arrayValue.length
      : objectKeys?.length ?? Object.keys(objectValue ?? {}).length;
    const readChild = (index: number): readonly [string, unknown] => {
      const childKey = arrayValue ? String(index) : objectKeys?.[index] ?? '';
      return [
        childKey,
        arrayValue ? arrayValue[index] : objectValue?.[childKey],
      ];
    };
    const filterActive = searchMode === 'filter' && filterLower.length > 0;
    const chunkChildren = isExpanded && count > CHILDREN_CHUNK_SIZE && !filterActive;
    let visibleEntries: Array<readonly [string, unknown]> | null = null;
    let remainingChildren = 0;
    if (isExpanded) {
      visibleEntries = [];
      if (filterActive && !preserveSubtree) {
        for (let index = 0; index < count; index += 1) {
          const entry = readChild(index);
          const childPath = treeChildPath(path, entry[0], isArray);
          if (
            (!diffMode || (diffNodes?.get(childPath)?.hasChanges ?? false)) &&
            matchesFilter(
              entry[0],
              entry[1],
              filterLower,
              0,
              filterCache,
              nodeKey,
              resolvedRefs,
            )
          ) {
            visibleEntries.push(entry);
          }
        }
      } else if (diffMode) {
        let changedCount = 0;
        for (let index = 0; index < count; index += 1) {
          const entry = readChild(index);
          const childPath = treeChildPath(path, entry[0], isArray);
          if (diffNodes?.get(childPath)?.hasChanges) {
            if (changedCount < childLimit) visibleEntries.push(entry);
            changedCount += 1;
          }
        }
        remainingChildren = Math.max(0, changedCount - visibleEntries.length);
      } else if (chunkChildren) {
        const revealFindMatches = searchMode === 'find' && filterLower.length > 0;
        if (!revealFindMatches) {
          for (let index = 0; index < Math.min(childLimit, count); index += 1) {
            visibleEntries.push(readChild(index));
          }
        } else {
          for (let index = 0; index < count; index += 1) {
            const childKey = arrayValue ? String(index) : objectKeys?.[index] ?? '';
            const childPath = arrayValue
              ? `${path}[${childKey}]`
              : `${path}.${childKey}`;
            if (
              index < childLimit ||
              expandedByFind.has(childPath)
            ) {
              visibleEntries.push(readChild(index));
            }
          }
        }
        remainingChildren = count - visibleEntries.length;
      } else {
        for (let index = 0; index < count; index += 1) {
          visibleEntries.push(readChild(index));
        }
      }
    }

    const swatch = !isArray ? asColorSwatch(value) : null;
    const objectKeyRef = isArray
      ? null
      : resolveObjectKeyRef(nodeKey, parentKey, resolvedRefs);
    const objectRefTarget: DefinitionRef | null = objectKeyRef
      ? {
          table: objectKeyRef.table,
          hash: objectKeyRef.hash,
          label: objectKeyRef.name || undefined,
          icon: objectKeyRef.icon,
        }
      : null;
    const peek =
      !isExpanded && count > 0
        ? getCollapsedPeek(value as Record<string, unknown>, isArray)
        : null;
    const summary = isArray ? `[${count}]` : `{${count}}`;
    const rowClassNames = [
      styles.row,
      isActiveMatch ? styles.rowActiveMatch : '',
      diffKind === 'added' ? styles.diffAddedRow : '',
      diffKind === 'removed' ? styles.diffRemovedRow : '',
      diffKind === 'changed' ? styles.diffChangedRow : '',
      selectedActionPath === path ? styles.rowMobileSelected : '',
    ]
      .filter(Boolean)
      .join(' ');

    const handleObjectRefClick = (event: MouseEvent<HTMLButtonElement>): void => {
      if (!objectRefTarget) return;
      onNavigateRef(objectRefTarget, event.ctrlKey || event.metaKey);
    };

    const handleObjectRefAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
      activateOnMiddleClick(event, () => {
        if (objectRefTarget) {
          onNavigateRef(objectRefTarget, true);
        }
      });
    };

    return (
      <div className={styles.node}>
        <div
          className={rowClassNames}
          data-json-path={isActiveMatch ? path : undefined}
          data-json-row-path={path}
          onClick={(event) => onRowClick(path, event)}
        >
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={() => onTogglePath(path, !isExpanded)}
            aria-expanded={isExpanded}
            disabled={count === 0}
          >
            {count > 0 ? (
              isExpanded ? (
                <ChevronDownIcon size={13} />
              ) : (
                <ChevronRightIcon size={13} />
              )
            ) : (
              <span className={styles.emptyToggle} />
            )}
            <span className={isArrayItem ? styles.arrayIndex : styles.key}>
              {highlightText(nodeKey, filterLower, isActiveMatch && selfKeyMatches)}
            </span>
            <span className={styles.colon}>:</span>
          </button>
          <span className={styles.containerMeta}>{summary}</span>
          {diffKind && diffKind !== 'same' && (
            <span
              className={`${styles.diffStatus} ${
                diffKind === 'added'
                  ? styles.diffStatusAdded
                  : diffKind === 'removed'
                    ? styles.diffStatusRemoved
                    : styles.diffStatusChanged
              }`}
              aria-label={
                diffKind === 'added'
                  ? 'Added'
                  : diffKind === 'removed'
                    ? 'Removed'
                    : 'Changed'
              }
            >
              {diffKind === 'added' ? '+' : diffKind === 'removed' ? '−' : '~'}
            </span>
          )}
          {objectKeyRef && (
            <span className={styles.refLinkGroup}>
              <button
                type="button"
                className={`${styles.annotation} ${styles.annotationRef} ${styles.refBadge}`}
                onClick={handleObjectRefClick}
                onMouseDown={preventMiddleClickAutoScroll}
                onAuxClick={handleObjectRefAuxClick}
                title={`Click to inspect · Ctrl+Click or middle-click for new tab (${objectKeyRef.table}:${objectKeyRef.hash}${objectKeyRef.subtitle ? ` — ${objectKeyRef.subtitle}` : ''})`}
              >
                <span className={styles.refTable}>
                  {highlightText(
                    getShortTableName(objectKeyRef.table),
                    filterLower,
                    isActiveMatch,
                  )}
                </span>
                <span className={styles.refName}>
                  &quot;{highlightText(objectKeyRef.name || 'Unnamed', filterLower, isActiveMatch)}&quot;
                </span>
              </button>
              <button
                type="button"
                className={styles.refOpenBtn}
                onClick={() => {
                  if (objectRefTarget) {
                    onNavigateRef(objectRefTarget, true);
                  }
                }}
                onMouseDown={preventMiddleClickAutoScroll}
                onAuxClick={(event) => {
                  activateOnMiddleClick(event, () => {
                    if (objectRefTarget) {
                      onNavigateRef(objectRefTarget, true);
                    }
                  });
                }}
                title={`Open ${objectKeyRef.name || getShortTableName(objectKeyRef.table)} in a new tab`}
                aria-label={`Open ${objectKeyRef.name || getShortTableName(objectKeyRef.table)} in a new tab`}
              >
                <ExternalLinkIcon size={11} />
              </button>
            </span>
          )}
          {peek && <span className={styles.peek}>{peek}</span>}
          {swatch && (
            <Suspense fallback={null}>
              <LazyColorSwatchWidget
                r={swatch.r}
                g={swatch.g}
                b={swatch.b}
                a={swatch.a}
                onCopy={onCopy}
              />
            </Suspense>
          )}
          <div className={styles.rowActions}>
            <button
              type="button"
              className={styles.microAction}
              onClick={() => onCopy(path, 'Copied JSON path')}
              title={`Copy path: ${path}`}
            >
              Path
            </button>
            <button
              type="button"
              className={styles.microAction}
              onClick={() => onCopy(JSON.stringify(value, null, 2), `Copied ${nodeKey}`)}
              title={`Copy ${nodeKey} JSON`}
            >
              <CopyIcon size={12} />
            </button>
          </div>
        </div>

        {selectedActionPath === path && (
          <div className={styles.rowActionBar} data-row-actions-for={path}>
            <button
              type="button"
              className={styles.rowActionButton}
              onClick={() => onCopy(path, 'Copied JSON path')}
            >
              Copy path
            </button>
            <button
              type="button"
              className={styles.rowActionButton}
              onClick={() => onCopy(JSON.stringify(value, null, 2), `Copied ${nodeKey}`)}
            >
              Copy value
            </button>
            <button
              type="button"
              className={styles.rowActionDismiss}
              onClick={onDismissRowActions}
              aria-label="Dismiss row actions"
              title="Dismiss"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        {isExpanded && visibleEntries !== null && visibleEntries.length > 0 && (
          <div className={styles.children}>
            {visibleEntries.map(([childKey, childValue]) => {
              const childPath = treeChildPath(path, childKey, isArray);
              return (
                <JsonNode
                  key={childKey}
                  nodeKey={childKey}
                  parentKey={nodeKey}
                  path={childPath}
                  value={childValue}
                  depth={depth + 1}
                  filterLower={filterLower}
                  searchMode={searchMode}
                  ancestorMatched={preserveSubtree}
                  activeMatchPath={activeMatchPath}
                  expandedByFind={expandedByFind}
                  expandGeneration={expandGeneration}
                  filterCache={filterCache}
                  diffMode={diffMode}
                  diffNodes={diffNodes}
                  expansionStore={expansionStore}
                  onTogglePath={onTogglePath}
                  selectedActionPath={selectedActionPath}
                  onRowClick={onRowClick}
                  onDismissRowActions={onDismissRowActions}
                  resolvedRefs={resolvedRefs}
                  onNavigateRef={onNavigateRef}
                  onCopy={onCopy}
                  onOpenLightbox={onOpenLightbox}
                  imageScaling={imageScaling}
                  isArrayItem={isArray}
                />
              );
            })}
            {chunkChildren && remainingChildren > 0 && (
              <div
                role="group"
                aria-label={`More ${nodeKey} entries`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.375rem 0.25rem',
                }}
              >
                <button
                  type="button"
                  className={styles.toolBtn}
                  onClick={() =>
                    setChildLimit((limit) =>
                      Math.min(count, limit + CHILDREN_CHUNK_SIZE),
                    )
                  }
                >
                  Show {Math.min(CHILDREN_CHUNK_SIZE, remainingChildren)} more (
                  {remainingChildren.toLocaleString()} remaining)
                </button>
                <button
                  type="button"
                  className={styles.toolBtn}
                  onClick={() => setChildLimit(count)}
                >
                  Show all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const enumInfo =
    typeof value === 'number' ? annotateEnumField(nodeKey, value, parentKey) : null;
  const resolvedRef =
    typeof value === 'number'
      ? resolveHashForNode(nodeKey, parentKey, value, resolvedRefs)
      : null;
  const resolvedRefTarget: DefinitionRef | null = resolvedRef
    ? {
        table: resolvedRef.table,
        hash: resolvedRef.hash,
        label: resolvedRef.name || undefined,
        icon: resolvedRef.icon,
      }
    : null;
  const lazyTargetTable =
    !resolvedRef && typeof value === 'number' && Number.isInteger(value) && value > 0
      ? getTargetTablesForField(nodeKey, parentKey)[0]
      : undefined;
  const lazyHash =
    lazyTargetTable !== undefined && typeof value === 'number' ? toUnsignedHash(value) : null;
  const lazyRefTarget: DefinitionRef | null =
    lazyTargetTable !== undefined && lazyHash !== null
      ? { table: lazyTargetTable, hash: lazyHash }
      : null;
  const isImage = isBungieImagePath(value);
  const escapedString =
    typeof value === 'string' ? JSON.stringify(value).slice(1, -1) : null;

  const handleRefClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!resolvedRefTarget) return;
    onNavigateRef(resolvedRefTarget, event.ctrlKey || event.metaKey);
  };

  const handleRefAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
    activateOnMiddleClick(event, () => {
      if (resolvedRefTarget) {
        onNavigateRef(resolvedRefTarget, true);
      }
    });
  };

  const handleLazyRefClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!lazyRefTarget) return;
    onNavigateRef(lazyRefTarget, event.ctrlKey || event.metaKey);
  };

  const handleLazyRefAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
    activateOnMiddleClick(event, () => {
      if (lazyRefTarget) {
        onNavigateRef(lazyRefTarget, true);
      }
    });
  };

  return (
    <div className={styles.node}>
      <div
        className={[
          styles.row,
          isActiveMatch ? styles.rowActiveMatch : '',
          diffKind === 'added' ? styles.diffAddedRow : '',
          diffKind === 'removed' ? styles.diffRemovedRow : '',
          diffKind === 'changed' ? styles.diffChangedRow : '',
          selectedActionPath === path ? styles.rowMobileSelected : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-json-path={isActiveMatch ? path : undefined}
        data-json-row-path={path}
        onClick={(event) => onRowClick(path, event)}
      >
        <span className={styles.leafSpacer} />
        <span className={styles.keyPair}>
          <span className={isArrayItem ? styles.arrayIndex : styles.key}>
            {highlightText(nodeKey, filterLower, isActiveMatch && selfKeyMatches)}
          </span>
          <span className={styles.colon}>:</span>
        </span>

        {diffKind === 'changed' && !isTreeContainer(diffNode?.oldValue) && (
          <PreviousScalarValue
            nodeKey={nodeKey}
            parentKey={parentKey}
            value={diffNode?.oldValue}
            resolvedRefs={resolvedRefs}
            onNavigateRef={onNavigateRef}
          />
        )}

        {typeof value === 'string' && (
          <span className={styles.valString}>
            {diffKind === 'changed' ? (
              <ins className={styles.diffNewValue}>
                &quot;{highlightText(escapedString ?? value, filterLower, isActiveMatch)}&quot;
              </ins>
            ) : (
              <>
                &quot;{highlightText(escapedString ?? value, filterLower, isActiveMatch)}&quot;
              </>
            )}
          </span>
        )}
        {typeof value === 'number' && (
          <span className={styles.valNumber}>
            {diffKind === 'changed' ? (
              <ins className={styles.diffNewValue}>
                {highlightText(String(value), filterLower, isActiveMatch)}
              </ins>
            ) : (
              highlightText(String(value), filterLower, isActiveMatch)
            )}
          </span>
        )}
        {typeof value === 'boolean' && (
          <span className={styles.valBoolean}>
            {diffKind === 'changed' ? (
              <ins className={styles.diffNewValue}>
                {highlightText(String(value), filterLower, isActiveMatch)}
              </ins>
            ) : (
              highlightText(String(value), filterLower, isActiveMatch)
            )}
          </span>
        )}
        {(value === null || value === undefined) && (
          <span className={styles.valNull}>
            {diffKind === 'changed' ? (
              <ins className={styles.diffNewValue}>
                {highlightText('null', filterLower, isActiveMatch)}
              </ins>
            ) : (
              highlightText('null', filterLower, isActiveMatch)
            )}
          </span>
        )}

        {resolvedRef && (
          <span className={styles.refLinkGroup}>
            <button
              type="button"
              className={`${styles.annotation} ${styles.annotationRef} ${styles.refBadge}`}
              onClick={handleRefClick}
              onMouseDown={preventMiddleClickAutoScroll}
              onAuxClick={handleRefAuxClick}
              title={`Click to inspect · Ctrl+Click or middle-click for new tab (${resolvedRef.table}:${resolvedRef.hash}${resolvedRef.subtitle ? ` — ${resolvedRef.subtitle}` : ''})`}
            >
              <span className={styles.refTable}>
                {highlightText(
                  getShortTableName(resolvedRef.table),
                  filterLower,
                  isActiveMatch,
                )}
              </span>
              <span className={styles.refName}>
                &quot;{highlightText(resolvedRef.name || 'Unnamed', filterLower, isActiveMatch)}&quot;
              </span>
            </button>
            <button
              type="button"
              className={styles.refOpenBtn}
              onClick={() => {
                if (resolvedRefTarget) {
                  onNavigateRef(resolvedRefTarget, true);
                }
              }}
              onMouseDown={preventMiddleClickAutoScroll}
              onAuxClick={(event) => {
                activateOnMiddleClick(event, () => {
                  if (resolvedRefTarget) {
                    onNavigateRef(resolvedRefTarget, true);
                  }
                });
              }}
              title={`Open ${resolvedRef.name || getShortTableName(resolvedRef.table)} in a new tab`}
              aria-label={`Open ${resolvedRef.name || getShortTableName(resolvedRef.table)} in a new tab`}
            >
              <ExternalLinkIcon size={11} />
            </button>
          </span>
        )}

        {!resolvedRef && enumInfo && (
          <span className={`${styles.annotation} ${styles.annotationEnum}`}>
            <span className={styles.enumType}>
              {highlightText(enumInfo.enumName, filterLower, isActiveMatch)}
            </span>
            <span className={styles.enumDot}>{enumInfo.isBitmask ? ': ' : '.'}</span>
            <span className={styles.enumLabel}>
              {highlightText(enumInfo.label, filterLower, isActiveMatch)}
            </span>
          </span>
        )}

        {!resolvedRef && !enumInfo && lazyTargetTable && lazyHash !== null && (
          <span className={styles.refLinkGroup}>
            <button
              type="button"
              className={`${styles.annotation} ${styles.annotationLazy} ${styles.refBadge}`}
              onClick={handleLazyRefClick}
              onMouseDown={preventMiddleClickAutoScroll}
              onAuxClick={handleLazyRefAuxClick}
              title={`Table not loaded yet — click to load ${lazyTargetTable} and open ${lazyHash} · Ctrl+Click or middle-click for new tab`}
            >
              <span className={styles.lazyLabel}>
                Open{' '}
                {highlightText(
                  getShortTableName(lazyTargetTable),
                  filterLower,
                  isActiveMatch,
                )}
              </span>
              <span className={styles.lazyHash}>
                {highlightText(String(lazyHash), filterLower, isActiveMatch)}
              </span>
            </button>
            <button
              type="button"
              className={styles.refOpenBtn}
              onClick={() => {
                if (lazyRefTarget) {
                  onNavigateRef(lazyRefTarget, true);
                }
              }}
              onMouseDown={preventMiddleClickAutoScroll}
              onAuxClick={(event) => {
                activateOnMiddleClick(event, () => {
                  if (lazyRefTarget) {
                    onNavigateRef(lazyRefTarget, true);
                  }
                });
              }}
              title={`Open ${getShortTableName(lazyTargetTable)} ${lazyHash} in a new tab`}
              aria-label={`Open ${getShortTableName(lazyTargetTable)} ${lazyHash} in a new tab`}
            >
              <ExternalLinkIcon size={11} />
            </button>
          </span>
        )}

        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.microAction}
            onClick={() => onCopy(path, 'Copied JSON path')}
            title={`Copy path: ${path}`}
          >
            Path
          </button>
          <button
            type="button"
            className={styles.microAction}
            onClick={() => onCopy(String(value ?? 'null'), `Copied ${nodeKey}`)}
            title="Copy value"
          >
            <CopyIcon size={12} />
          </button>
        </div>
      </div>

      {selectedActionPath === path && (
        <div className={styles.rowActionBar} data-row-actions-for={path}>
          <button
            type="button"
            className={styles.rowActionButton}
            onClick={() => onCopy(path, 'Copied JSON path')}
          >
            Copy path
          </button>
          <button
            type="button"
            className={styles.rowActionButton}
            onClick={() => onCopy(JSON.stringify(value, null, 2), `Copied ${nodeKey}`)}
          >
            Copy value
          </button>
          <button
            type="button"
            className={styles.rowActionDismiss}
            onClick={onDismissRowActions}
            aria-label="Dismiss row actions"
            title="Dismiss"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {isImage && (
        <InlineImagePreview
          path={value}
          imageScaling={imageScaling}
          onOpenLightbox={onOpenLightbox}
        />
      )}
    </div>
  );
});

const FILTER_PERSIST_DEBOUNCE_MS = 200;
const COMPACT_TOOLBAR_QUERY = '(max-width: 700px)';

const SEARCH_PLACEHOLDERS = {
  filter: { full: 'Filter keys or values…', compact: 'Filter…' },
  find: { full: 'Find in JSON…', compact: 'Find…' },
} as const;

let compactToolbarQuery: MediaQueryList | null | undefined;

function getCompactToolbarQuery(): MediaQueryList | null {
  if (compactToolbarQuery !== undefined) {
    return compactToolbarQuery;
  }
  compactToolbarQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPACT_TOOLBAR_QUERY)
      : null;
  return compactToolbarQuery;
}

/** Narrow layouts swap in short placeholders so the toolbar input never clips. */
function useCompactToolbar(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const query = getCompactToolbarQuery();
      if (!query) {
        return () => {};
      }
      query.addEventListener('change', onStoreChange);
      return () => query.removeEventListener('change', onStoreChange);
    },
    () => getCompactToolbarQuery()?.matches ?? false,
    () => false,
  );
}

export const JsonTree = memo(function JsonTree({
  data,
  diffBefore,
  resolvedRefs,
  onNavigateRef,
  onCopy,
  initialFilter,
  onFilterChange,
  initialExpanded,
  onExpandedChange,
  imageScaling = 'sharp',
  embedded = false,
}: JsonTreeProps): ReactNode {
  const [filter, setFilter] = useState(initialFilter ?? '');
  const [searchMode, setSearchMode] = useState<'filter' | 'find'>('filter');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [showDiff, setShowDiff] = useState(true);
  const [selectedActionPath, setSelectedActionPath] = useState<string | null>(null);
  const [expandGeneration, setExpandGeneration] = useState<{
    mode: 'default' | 'expand' | 'collapse';
    seq: number;
  }>({ mode: 'default', seq: 0 });
  const [lightbox, setLightbox] = useState<{ url: string; path: string } | null>(null);
  const compactToolbar = useCompactToolbar();
  const treeRef = useRef<HTMLDivElement>(null);
  const expansionStore = useMemo(() => createExpansionStore(initialExpanded ?? {}), []);
  const diffTree = useMemo(() => {
    if (diffBefore === undefined) return null;
    const beforeRecord =
      typeof diffBefore === 'object' &&
      diffBefore !== null &&
      !Array.isArray(diffBefore)
        ? (diffBefore as Record<string, unknown>)
        : {};
    return createJsonTreeDiff(beforeRecord, data);
  }, [data, diffBefore]);
  const diffMode = diffTree !== null && showDiff;
  const viewData = diffMode ? diffTree.data : data;
  const diffNodes = diffMode ? diffTree.nodes : null;

  // Keep parent callbacks in refs so every callback handed to JsonNode stays
  // identity-stable for the lifetime of the tree (crucial for React.memo).
  const onFilterChangeRef = useRef(onFilterChange);
  const onNavigateRefRef = useRef(onNavigateRef);
  const onCopyRef = useRef(onCopy);
  const onExpandedChangeRef = useRef(onExpandedChange);

  useEffect(() => {
    onFilterChangeRef.current = onFilterChange;
    onNavigateRefRef.current = onNavigateRef;
    onCopyRef.current = onCopy;
    onExpandedChangeRef.current = onExpandedChange;
  }, [onCopy, onExpandedChange, onFilterChange, onNavigateRef]);

  // Filter persistence into Zustand history is debounced; the input itself
  // updates synchronously so typing never waits on the store cascade.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFilterPersistRef = useRef<string | null>(null);
  const lastPersistedFilterRef = useRef(initialFilter ?? '');

  const persistPendingFilter = useCallback((): void => {
    const pending = pendingFilterPersistRef.current;
    if (pending === null) {
      return;
    }
    pendingFilterPersistRef.current = null;
    if (pending === lastPersistedFilterRef.current) {
      return;
    }
    lastPersistedFilterRef.current = pending;
    onFilterChangeRef.current?.(pending);
  }, []);

  const clearPersistTimer = useCallback((): void => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, []);

  const flushFilterPersist = useCallback((): void => {
    clearPersistTimer();
    persistPendingFilter();
  }, [clearPersistTimer, persistPendingFilter]);

  // Flush any debounced value when the tree unmounts (tab switch, new hash…).
  useEffect(() => flushFilterPersist, [flushFilterPersist]);

  const scheduleFilterPersist = useCallback(
    (next: string): void => {
      pendingFilterPersistRef.current = next;
      clearPersistTimer();
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        persistPendingFilter();
      }, FILTER_PERSIST_DEBOUNCE_MS);
    },
    [clearPersistTimer, persistPendingFilter],
  );

  useEffect(() => {
    const incoming = initialFilter ?? '';
    // Our own debounced persistence round-trips through the parent; never let
    // that echo clobber newer text the user is already typing.
    if (incoming === lastPersistedFilterRef.current) {
      return;
    }
    lastPersistedFilterRef.current = incoming;
    pendingFilterPersistRef.current = null;
    clearPersistTimer();
    setFilter(incoming);
  }, [clearPersistTimer, initialFilter]);

  const handleFilterChange = useCallback(
    (next: string) => {
      setFilter(next);
      scheduleFilterPersist(next);
    },
    [scheduleFilterPersist],
  );

  const handleTogglePath = useCallback(
    (targetPath: string, nextOpen: boolean) => {
      const next = expansionStore.set(targetPath, nextOpen);
      onExpandedChangeRef.current?.(next);
    },
    [expansionStore],
  );

  const handleRowClick = useCallback(
    (path: string, event: MouseEvent<HTMLDivElement>): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('button, a, img')) return;
      if (typeof window !== 'undefined' && window.getSelection()?.toString()) return;
      setSelectedActionPath((current) => (current === path ? null : path));
    },
    [],
  );

  const dismissRowActions = useCallback(() => setSelectedActionPath(null), []);

  useEffect(() => {
    if (!selectedActionPath) return;
    const dismissOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-row-actions-for]')) return;
      if (
        !target.closest('[data-json-row-path]') ||
        target.closest('button, a, img')
      ) {
        setSelectedActionPath(null);
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [selectedActionPath]);

  useEffect(() => {
    setShowDiff(true);
  }, [data, diffBefore]);

  const resetExpansion = useCallback(
    (mode: 'expand' | 'collapse'): void => {
      const next = expansionStore.reset();
      onExpandedChangeRef.current?.(next);
      setExpandGeneration((prev) => ({ mode, seq: prev.seq + 1 }));
    },
    [expansionStore],
  );

  const filterLower = filter.trim().toLowerCase();
  // Defer the (potentially expensive) tree/find recompute so the controlled
  // input always commits immediately, even on 10k-line definitions.
  const deferredFilterLower = useDeferredValue(filterLower);
  // One boolean cache per call depth, recreated per filter pass: JsonNode never
  // re-walks the same deep subtree twice for the same filter.
  const filterCache = useMemo(
    () => createFilterCache(),
    [deferredFilterLower, resolvedRefs],
  );

  const findMatchesResult = useMemo(
    () =>
      searchMode === 'find' && deferredFilterLower
        ? collectFindMatches(viewData, deferredFilterLower, resolvedRefs)
        : { matches: NO_FIND_MATCHES, truncated: false },
    [deferredFilterLower, resolvedRefs, searchMode, viewData],
  );
  const findMatches = findMatchesResult.matches;
  const findMatchesTruncated = findMatchesResult.truncated;
  const clampedActiveMatchIndex =
    findMatches.length === 0
      ? 0
      : Math.min(activeMatchIndex, findMatches.length - 1);
  const activeMatchPath = findMatches[clampedActiveMatchIndex]?.path ?? null;
  const expandedByFind = useMemo(() => {
    const paths = new Set<string>();
    const visibleMatches = findMatches.slice(0, 200);
    const activeMatch = findMatches[clampedActiveMatchIndex];
    if (activeMatch && !visibleMatches.includes(activeMatch)) {
      visibleMatches.push(activeMatch);
    }
    visibleMatches.forEach((match) => {
      match.ancestorPaths.forEach((path) => paths.add(path));
      paths.add(match.path);
    });
    return paths;
  }, [clampedActiveMatchIndex, findMatches]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [deferredFilterLower, viewData]);

  useEffect(() => {
    if (searchMode !== 'find' || activeMatchPath === null) return;
    const activeRow = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-json-path]') ?? [],
    ).find((row) => row.dataset.jsonPath === activeMatchPath);
    activeRow?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [activeMatchPath, searchMode]);

  const rootEntries = useMemo(() => {
    const all = Object.entries(viewData);
    return all.filter(([key, value]) => {
      if (diffMode && !diffNodes?.get(key)?.hasChanges) return false;
      if (searchMode === 'find' || !deferredFilterLower) return true;
      return matchesFilter(
        key,
        value,
        deferredFilterLower,
        0,
        filterCache,
        undefined,
        resolvedRefs,
      );
    });
  }, [
    deferredFilterLower,
    diffMode,
    diffNodes,
    filterCache,
    resolvedRefs,
    searchMode,
    viewData,
  ]);

  const stepMatch = useCallback(
    (direction: -1 | 1) => {
      if (findMatches.length === 0) return;
      setActiveMatchIndex(
        (clampedActiveMatchIndex + direction + findMatches.length) % findMatches.length,
      );
    },
    [clampedActiveMatchIndex, findMatches.length],
  );

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      if (filter.length > 0) {
        handleFilterChange('');
        flushFilterPersist();
      } else {
        event.currentTarget.blur();
      }
      return;
    }
    if (
      searchMode === 'find' &&
      findMatches.length > 0 &&
      (event.key === 'Enter' || event.key === 'Tab')
    ) {
      event.preventDefault();
      stepMatch(event.shiftKey ? -1 : 1);
    }
  };

  const handleOpenLightbox = useCallback((url: string, path: string) => {
    setLightbox({ url, path });
  }, []);

  const handleNavigateRef = useCallback(
    (ref: DefinitionRef, inNewTab?: boolean): void => {
      // Persist any pending filter while this entry is still the active one;
      // the tree key changes (and unmounts) as soon as navigation lands.
      flushFilterPersist();
      onNavigateRefRef.current(ref, inNewTab);
    },
    [flushFilterPersist],
  );

  const handleCopy = useCallback((text: string, label: string): void => {
    onCopyRef.current(text, label);
  }, []);

  const searchPlaceholder = compactToolbar
    ? SEARCH_PLACEHOLDERS[searchMode].compact
    : SEARCH_PLACEHOLDERS[searchMode].full;

  return (
    <div
      className={
        embedded ? `${styles.wrapper} ${styles.embeddedWrapper}` : styles.wrapper
      }
    >
      <div className={styles.toolbar}>
        <ClearSearchInput
          className={styles.filterInput}
          wrapperClassName={styles.filterWrap}
          value={filter}
          onValueChange={handleFilterChange}
          onBlur={flushFilterPersist}
          onKeyDown={handleSearchKeyDown}
          placeholder={searchPlaceholder}
          aria-label={searchMode === 'filter' ? 'Filter JSON keys or values' : 'Find in JSON'}
          clearLabel={searchMode === 'filter' ? 'Clear JSON filter' : 'Clear JSON find'}
        />
        <div className={styles.searchModes} role="group" aria-label="JSON search mode">
          <button
            type="button"
            className={styles.searchModeBtn}
            aria-pressed={searchMode === 'filter'}
            title="Filter — show only matching fields and matched dropdown sections"
            onClick={() => setSearchMode('filter')}
          >
            Filter
          </button>
          <button
            type="button"
            className={styles.searchModeBtn}
            aria-pressed={searchMode === 'find'}
            title="Find — keep full JSON visible and step through every highlighted match"
            onClick={() => setSearchMode('find')}
          >
            Find
          </button>
        </div>
        {diffBefore !== undefined && (
          <div className={styles.diffModes} role="group" aria-label="Pretty display mode">
            <button
              type="button"
              className={styles.diffModeButton}
              aria-pressed={showDiff}
              onClick={() => setShowDiff(true)}
            >
              Diff
            </button>
            <button
              type="button"
              className={styles.diffModeButton}
              aria-pressed={!showDiff}
              onClick={() => setShowDiff(false)}
            >
              Snapshot
            </button>
          </div>
        )}
        {searchMode === 'find' && deferredFilterLower.length > 0 && (
          <div className={styles.findControls} role="group" aria-label="Find matches">
            <button
              type="button"
              className={styles.findStepBtn}
              onClick={() => stepMatch(-1)}
              disabled={findMatches.length === 0}
              title="Previous match (Shift+Enter / Shift+Tab)"
              aria-label="Previous match"
            >
              ↑
            </button>
            <span className={styles.matchCount} aria-live="polite">
              {findMatches.length === 0
                ? '0 / 0'
                : `${clampedActiveMatchIndex + 1} / ${findMatches.length}${findMatchesTruncated ? '+' : ''}`}
            </span>
            <button
              type="button"
              className={styles.findStepBtn}
              onClick={() => stepMatch(1)}
              disabled={findMatches.length === 0}
              title="Next match (Enter / Tab)"
              aria-label="Next match"
            >
              ↓
            </button>
          </div>
        )}
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => resetExpansion('expand')}
        >
          Expand
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => resetExpansion('collapse')}
        >
          Collapse
        </button>
      </div>

      <div
        className={embedded ? `${styles.tree} ${styles.embeddedTree}` : styles.tree}
        ref={treeRef}
        data-inspector-scroll="true"
        role="tree"
        aria-label="Definition JSON"
      >
        {searchMode === 'filter' && deferredFilterLower && rootEntries.length === 0 ? (
          <div className={styles.empty}>No fields match &quot;{filter}&quot;.</div>
        ) : rootEntries.length === 0 ? (
          <div className={styles.empty}>
            {diffMode ? 'No changes to show.' : 'No fields in this snapshot.'}
          </div>
        ) : (
          rootEntries.map(([key, val]) => (
            <JsonNode
              key={key}
              nodeKey={key}
              path={key}
              value={val}
              depth={0}
              filterLower={deferredFilterLower}
              searchMode={searchMode}
              activeMatchPath={activeMatchPath}
              expandedByFind={expandedByFind}
              expandGeneration={expandGeneration}
              filterCache={filterCache}
              diffMode={diffMode}
              diffNodes={diffNodes}
              expansionStore={expansionStore}
              onTogglePath={handleTogglePath}
              selectedActionPath={selectedActionPath}
              onRowClick={handleRowClick}
              onDismissRowActions={dismissRowActions}
              resolvedRefs={resolvedRefs}
              onNavigateRef={handleNavigateRef}
              onCopy={handleCopy}
              onOpenLightbox={handleOpenLightbox}
              imageScaling={imageScaling}
            />
          ))
        )}
      </div>

      {lightbox && (
        <Suspense fallback={null}>
          <LazyImageLightbox
            url={lightbox.url}
            path={lightbox.path}
            defaultScaling={imageScaling}
            onClose={() => setLightbox(null)}
            onCopy={handleCopy}
          />
        </Suspense>
      )}
    </div>
  );
});
