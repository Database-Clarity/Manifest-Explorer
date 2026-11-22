import {
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
  CopyIcon,
  ExternalLinkIcon,
} from '../../ui/Icons';
import { ColorSwatchWidget } from './ColorSwatchWidget';
import { ImageLightbox } from './ImageLightbox';
import styles from './JsonTree.module.scss';

export interface JsonTreeProps {
  data: Record<string, unknown>;
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
 * cache, so repeated renders (and shared subtrees) never re-walk deep values.
 */
const FILTER_MAX_DEPTH = 8;

type FilterCache = ReadonlyArray<WeakMap<object, boolean>>;

function createFilterCache(): FilterCache {
  return Array.from(
    { length: FILTER_MAX_DEPTH + 1 },
    () => new WeakMap<object, boolean>(),
  );
}

function matchesFilter(
  key: string,
  value: unknown,
  filterLower: string,
  depth: number,
  cache: FilterCache,
): boolean {
  if (!filterLower) {
    return true;
  }
  if (key.toLowerCase().includes(filterLower)) {
    return true;
  }
  if (value === null || value === undefined) {
    return 'null'.includes(filterLower);
  }
  if (typeof value === 'string') {
    return value.toLowerCase().includes(filterLower);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase().includes(filterLower);
  }
  if (typeof value !== 'object' || depth > FILTER_MAX_DEPTH) {
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
      if (matchesFilter(String(index), value[index], filterLower, depth + 1, cache)) {
        result = true;
        break;
      }
    }
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry && matchesFilter(entry[0], entry[1], filterLower, depth + 1, cache)) {
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

const NO_FIND_MATCHES: readonly FindMatch[] = [];

function collectFindMatches(
  data: Record<string, unknown>,
  filterLower: string,
): FindMatch[] {
  const matches: FindMatch[] = [];
  // A single mutable ancestor stack: `ancestors.slice()` only runs when a
  // match is actually recorded, keeping large definitions O(N) instead of O(N²).
  const ancestors: string[] = [];

  const visit = (nodeKey: string, path: string, value: unknown): void => {
    const keyMatches = nodeKey.toLowerCase().includes(filterLower);
    const valueMatches =
      value === null
        ? 'null'.includes(filterLower)
        : typeof value === 'string'
          ? value.toLowerCase().includes(filterLower)
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value).toLowerCase().includes(filterLower)
            : false;

    if (keyMatches || valueMatches) {
      matches.push({ path, ancestorPaths: ancestors.slice() });
    }

    if (Array.isArray(value)) {
      ancestors.push(path);
      for (let index = 0; index < value.length; index += 1) {
        const childKey = String(index);
        visit(childKey, `${path}[${childKey}]`, value[index]);
      }
      ancestors.pop();
    } else if (typeof value === 'object' && value !== null) {
      ancestors.push(path);
      const entries = Object.entries(value as Record<string, unknown>);
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry) {
          continue;
        }
        visit(entry[0], `${path}.${entry[0]}`, entry[1]);
      }
      ancestors.pop();
    }
  };

  const rootEntries = Object.entries(data);
  for (let index = 0; index < rootEntries.length; index += 1) {
    const entry = rootEntries[index];
    if (!entry) {
      continue;
    }
    visit(entry[0], entry[0], entry[1]);
  }
  return matches;
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
  expansionStore: ExpansionStore;
  onTogglePath: (path: string, nextOpen: boolean) => void;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
  onOpenLightbox: (url: string, path: string) => void;
  imageScaling: ImageScalingMode;
  isArrayItem?: boolean;
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
  expansionStore,
  onTogglePath,
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
  const selfKeyMatches = filterLower.length > 0 && nodeKey.toLowerCase().includes(filterLower);
  const preserveSubtree =
    searchMode === 'filter' && filterLower.length > 0 && (ancestorMatched || selfKeyMatches);
  const isActiveMatch = searchMode === 'find' && path === activeMatchPath;
  const defaultExpanded =
    depth === 0 &&
    (nodeKey === 'displayProperties' || nodeKey === 'inventory' || nodeKey === 'equippingBlock');

  const isObject = typeof value === 'object' && value !== null;
  const isArray = Array.isArray(value);
  const hasDescendantMatch =
    searchMode === 'filter' &&
    filterLower.length > 0 &&
    !selfKeyMatches &&
    !ancestorMatched &&
    isObject &&
    matchesFilter(nodeKey, value, filterLower, 0, filterCache);
  const isAutoExpandedForSearch =
    searchMode === 'filter'
      ? filterLower.length > 0 && (selfKeyMatches || hasDescendantMatch)
      : searchMode === 'find' && expandedByFind.has(path);
  const isExpanded =
    manualOpen !== undefined
      ? manualOpen
      : isAutoExpandedForSearch
        ? true
        : expandGeneration.mode === 'expand'
          ? depth < 6
          : expandGeneration.mode === 'collapse'
            ? false
            : defaultExpanded;

  if (isObject) {
    const entries = isExpanded
      ? isArray
        ? (value as unknown[]).map((childValue, index) => [String(index), childValue] as const)
        : Object.entries(value as Record<string, unknown>)
      : null;
    const filteredEntries =
      entries === null
        ? null
        : searchMode === 'filter' && filterLower.length > 0 && !preserveSubtree
          ? entries.filter(([childKey, childValue]) =>
              matchesFilter(childKey, childValue, filterLower, 0, filterCache),
            )
          : entries;

    const swatch = !isArray ? asColorSwatch(value) : null;
    const objectKeyRef = isArray
      ? null
      : resolveObjectKeyRef(nodeKey, parentKey, resolvedRefs);
    const count = isArray
      ? (value as unknown[]).length
      : Object.keys(value as Record<string, unknown>).length;
    const peek =
      !isExpanded && count > 0
        ? getCollapsedPeek(value as Record<string, unknown>, isArray)
        : null;
    const summary = isArray ? `[${count}]` : `{${count}}`;

    const handleObjectRefClick = (event: MouseEvent<HTMLButtonElement>): void => {
      if (!objectKeyRef) return;
      onNavigateRef(
        {
          table: objectKeyRef.table,
          hash: objectKeyRef.hash,
          label: objectKeyRef.name || undefined,
          icon: objectKeyRef.icon,
        },
        event.ctrlKey || event.metaKey,
      );
    };

    const handleObjectRefAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
      if (event.button === 1 && objectKeyRef) {
        event.preventDefault();
        onNavigateRef(
          {
            table: objectKeyRef.table,
            hash: objectKeyRef.hash,
            label: objectKeyRef.name || undefined,
            icon: objectKeyRef.icon,
          },
          true,
        );
      }
    };

    return (
      <div className={styles.node}>
        <div
          className={isActiveMatch ? `${styles.row} ${styles.rowActiveMatch}` : styles.row}
          data-json-path={isActiveMatch ? path : undefined}
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
          {objectKeyRef && (
            <button
              type="button"
              className={`${styles.annotation} ${styles.annotationRef} ${styles.refBadge}`}
              onClick={handleObjectRefClick}
              onAuxClick={handleObjectRefAuxClick}
              title={`Click to inspect · Ctrl+Click or middle-click for new tab (${objectKeyRef.table}:${objectKeyRef.hash}${objectKeyRef.subtitle ? ` — ${objectKeyRef.subtitle}` : ''})`}
            >
              <span className={styles.refTable}>{getShortTableName(objectKeyRef.table)}</span>
              <span className={styles.refName}>&quot;{objectKeyRef.name || 'Unnamed'}&quot;</span>
            </button>
          )}
          {peek && <span className={styles.peek}>{peek}</span>}
          {swatch && (
            <ColorSwatchWidget
              r={swatch.r}
              g={swatch.g}
              b={swatch.b}
              a={swatch.a}
              onCopy={onCopy}
            />
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

        {isExpanded && filteredEntries !== null && filteredEntries.length > 0 && (
          <div className={styles.children}>
            {filteredEntries.map(([childKey, childValue]) => {
              const childPath = isArray ? `${path}[${childKey}]` : `${path}.${childKey}`;
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
                  expansionStore={expansionStore}
                  onTogglePath={onTogglePath}
                  resolvedRefs={resolvedRefs}
                  onNavigateRef={onNavigateRef}
                  onCopy={onCopy}
                  onOpenLightbox={onOpenLightbox}
                  imageScaling={imageScaling}
                  isArrayItem={isArray}
                />
              );
            })}
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
  const lazyTargetTable =
    !resolvedRef && typeof value === 'number' && Number.isInteger(value) && value > 0
      ? getTargetTablesForField(nodeKey, parentKey)[0]
      : undefined;
  const lazyHash =
    lazyTargetTable !== undefined && typeof value === 'number' ? toUnsignedHash(value) : null;
  const isImage = isBungieImagePath(value);
  const escapedString =
    typeof value === 'string' ? JSON.stringify(value).slice(1, -1) : null;

  const handleRefClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!resolvedRef) return;
    onNavigateRef(
      {
        table: resolvedRef.table,
        hash: resolvedRef.hash,
        label: resolvedRef.name || undefined,
        icon: resolvedRef.icon,
      },
      event.ctrlKey || event.metaKey,
    );
  };

  const handleRefAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.button === 1 && resolvedRef) {
      event.preventDefault();
      onNavigateRef(
        {
          table: resolvedRef.table,
          hash: resolvedRef.hash,
          label: resolvedRef.name || undefined,
          icon: resolvedRef.icon,
        },
        true,
      );
    }
  };

  const handleLazyRefClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!lazyTargetTable || lazyHash === null) return;
    onNavigateRef(
      { table: lazyTargetTable, hash: lazyHash },
      event.ctrlKey || event.metaKey,
    );
  };

  const handleLazyRefAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 1 || !lazyTargetTable || lazyHash === null) return;
    event.preventDefault();
    onNavigateRef({ table: lazyTargetTable, hash: lazyHash }, true);
  };

  return (
    <div className={styles.node}>
      <div
        className={isActiveMatch ? `${styles.row} ${styles.rowActiveMatch}` : styles.row}
        data-json-path={isActiveMatch ? path : undefined}
      >
        <span className={styles.leafSpacer} />
        <span className={styles.keyPair}>
          <span className={isArrayItem ? styles.arrayIndex : styles.key}>
            {highlightText(nodeKey, filterLower, isActiveMatch && selfKeyMatches)}
          </span>
          <span className={styles.colon}>:</span>
        </span>

        {typeof value === 'string' && (
          <span className={styles.valString}>
            &quot;{highlightText(escapedString ?? value, filterLower, isActiveMatch)}&quot;
          </span>
        )}
        {typeof value === 'number' && (
          <span className={styles.valNumber}>
            {highlightText(String(value), filterLower, isActiveMatch)}
          </span>
        )}
        {typeof value === 'boolean' && (
          <span className={styles.valBoolean}>
            {highlightText(String(value), filterLower, isActiveMatch)}
          </span>
        )}
        {(value === null || value === undefined) && (
          <span className={styles.valNull}>{highlightText('null', filterLower, isActiveMatch)}</span>
        )}

        {resolvedRef && (
          <button
            type="button"
            className={`${styles.annotation} ${styles.annotationRef} ${styles.refBadge}`}
            onClick={handleRefClick}
            onAuxClick={handleRefAuxClick}
            title={`Click to inspect · Ctrl+Click or middle-click for new tab (${resolvedRef.table}:${resolvedRef.hash}${resolvedRef.subtitle ? ` — ${resolvedRef.subtitle}` : ''})`}
          >
            <span className={styles.refTable}>{getShortTableName(resolvedRef.table)}</span>
            <span className={styles.refName}>&quot;{resolvedRef.name || 'Unnamed'}&quot;</span>
          </button>
        )}

        {!resolvedRef && enumInfo && (
          <span className={`${styles.annotation} ${styles.annotationEnum}`}>
            <span className={styles.enumType}>{enumInfo.enumName}</span>
            <span className={styles.enumDot}>{enumInfo.isBitmask ? ': ' : '.'}</span>
            <span className={styles.enumLabel}>{enumInfo.label}</span>
          </span>
        )}

        {!resolvedRef && !enumInfo && lazyTargetTable && lazyHash !== null && (
          <button
            type="button"
            className={`${styles.annotation} ${styles.annotationLazy} ${styles.refBadge}`}
            onClick={handleLazyRefClick}
            onAuxClick={handleLazyRefAuxClick}
            title={`Table not loaded yet — click to load ${lazyTargetTable} and open ${lazyHash} · Ctrl+Click or middle-click for new tab`}
          >
            <span className={styles.lazyLabel}>Open {getShortTableName(lazyTargetTable)}</span>
            <span className={styles.lazyHash}>{lazyHash}</span>
          </button>
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

export const JsonTree = memo(function JsonTree({
  data,
  resolvedRefs,
  onNavigateRef,
  onCopy,
  initialFilter,
  onFilterChange,
  initialExpanded,
  onExpandedChange,
  imageScaling = 'sharp',
}: JsonTreeProps): ReactNode {
  const [filter, setFilter] = useState(initialFilter ?? '');
  const [searchMode, setSearchMode] = useState<'filter' | 'find'>('filter');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [expandGeneration, setExpandGeneration] = useState<{
    mode: 'default' | 'expand' | 'collapse';
    seq: number;
  }>({ mode: 'default', seq: 0 });
  const [lightbox, setLightbox] = useState<{ url: string; path: string } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const expansionStore = useMemo(() => createExpansionStore(initialExpanded ?? {}), []);

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
  const filterCache = useMemo(() => createFilterCache(), [deferredFilterLower]);

  const findMatches = useMemo(
    () =>
      searchMode === 'find' && deferredFilterLower
        ? collectFindMatches(data, deferredFilterLower)
        : NO_FIND_MATCHES,
    [data, deferredFilterLower, searchMode],
  );
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
    });
    return paths;
  }, [clampedActiveMatchIndex, findMatches]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [deferredFilterLower, data]);

  useEffect(() => {
    if (searchMode !== 'find' || activeMatchPath === null) return;
    const activeRow = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-json-path]') ?? [],
    ).find((row) => row.dataset.jsonPath === activeMatchPath);
    activeRow?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [activeMatchPath, searchMode]);

  const rootEntries = useMemo(() => {
    const all = Object.entries(data);
    if (searchMode === 'find' || !deferredFilterLower) {
      return all;
    }
    return all.filter(([key, value]) =>
      matchesFilter(key, value, deferredFilterLower, 0, filterCache),
    );
  }, [data, deferredFilterLower, filterCache, searchMode]);

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

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.filterInput}
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          onBlur={flushFilterPersist}
          onKeyDown={handleSearchKeyDown}
          placeholder={searchMode === 'filter' ? 'Filter keys or values…' : 'Find in JSON…'}
          aria-label={searchMode === 'filter' ? 'Filter JSON keys or values' : 'Find in JSON'}
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
                : `${clampedActiveMatchIndex + 1} / ${findMatches.length}`}
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
        className={styles.tree}
        ref={treeRef}
        data-inspector-scroll="true"
        role="tree"
        aria-label="Definition JSON"
      >
        {searchMode === 'filter' && rootEntries.length === 0 ? (
          <div className={styles.empty}>No fields match &quot;{filter}&quot;.</div>
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
              expansionStore={expansionStore}
              onTogglePath={handleTogglePath}
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
        <ImageLightbox
          url={lightbox.url}
          path={lightbox.path}
          defaultScaling={imageScaling}
          onClose={() => setLightbox(null)}
          onCopy={handleCopy}
        />
      )}
    </div>
  );
});
