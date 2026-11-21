import {
  useCallback,
  useEffect,
  useMemo,
  useState,
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

function highlightText(text: string, needle: string): ReactNode {
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
      <mark className={styles.match}>{text.slice(idx, idx + needle.length)}</mark>
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

function matchesFilter(key: string, value: unknown, filterLower: string, depth = 0): boolean {
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
  if (depth > 8) {
    return false;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (matchesFilter(String(i), value[i], filterLower, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry && matchesFilter(entry[0], entry[1], filterLower, depth + 1)) {
        return true;
      }
    }
  }
  return false;
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

interface NodeProps {
  nodeKey: string;
  parentKey?: string;
  path: string;
  value: unknown;
  depth: number;
  filterLower: string;
  expandGeneration: { mode: 'default' | 'expand' | 'collapse'; seq: number };
  expandedMap: Record<string, boolean>;
  onTogglePath: (path: string, nextOpen: boolean) => void;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
  onOpenLightbox: (url: string, path: string) => void;
  imageScaling: ImageScalingMode;
  isArrayItem?: boolean;
}

function JsonNode({
  nodeKey,
  parentKey,
  path,
  value,
  depth,
  filterLower,
  expandGeneration,
  expandedMap,
  onTogglePath,
  resolvedRefs,
  onNavigateRef,
  onCopy,
  onOpenLightbox,
  imageScaling,
  isArrayItem = false,
}: NodeProps): ReactNode {
  const defaultExpanded =
    depth === 0 &&
    (nodeKey === 'displayProperties' || nodeKey === 'inventory' || nodeKey === 'equippingBlock');

  const manualOpen = expandedMap[path] ?? null;

  const isExpanded =
    filterLower.length > 0
      ? true
      : manualOpen !== null
        ? manualOpen
        : expandGeneration.mode === 'expand'
          ? depth < 6
          : expandGeneration.mode === 'collapse'
            ? false
            : defaultExpanded;

  const isObject = typeof value === 'object' && value !== null;
  const isArray = Array.isArray(value);

  if (isObject) {
    const entries = isArray
      ? (value as unknown[]).map((v, idx) => [String(idx), v] as const)
      : Object.entries(value as Record<string, unknown>);
    const filteredEntries = filterLower
      ? entries.filter(([k, v]) => matchesFilter(k, v, filterLower))
      : entries;

    const swatch = !isArray ? asColorSwatch(value) : null;
    const objectKeyRef = isArray
      ? null
      : resolveObjectKeyRef(nodeKey, parentKey, resolvedRefs);
    const count = entries.length;
    const peek = !isExpanded && count > 0 ? getCollapsedPeek(value as Record<string, unknown>, isArray) : null;
    const summary = isArray
      ? `[${count}]`
      : `{${count}}`;

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
        <div className={styles.row}>
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
              {highlightText(nodeKey, filterLower)}
            </span>
            <span className={styles.colon}>:</span>
          </button>
          <span className={styles.containerMeta}>{summary}</span>
          {objectKeyRef && (
            <span className={styles.comment}>
              {'// '}
              <button
                type="button"
                className={styles.refLink}
                onClick={handleObjectRefClick}
                onAuxClick={handleObjectRefAuxClick}
                title={`Click to inspect · Ctrl+Click or middle-click for new tab (${objectKeyRef.table}:${objectKeyRef.hash}${objectKeyRef.subtitle ? ` — ${objectKeyRef.subtitle}` : ''})`}
              >
                {getShortTableName(objectKeyRef.table)} &quot;{objectKeyRef.name || 'Unnamed'}&quot;
              </button>
            </span>
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

        {isExpanded && filteredEntries.length > 0 && (
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
                  expandGeneration={expandGeneration}
                  expandedMap={expandedMap}
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
      <div className={styles.row}>
        <span className={styles.leafSpacer} />
        <span className={styles.keyPair}>
          <span className={isArrayItem ? styles.arrayIndex : styles.key}>
            {highlightText(nodeKey, filterLower)}
          </span>
          <span className={styles.colon}>:</span>
        </span>

        {typeof value === 'string' && (
          <span className={styles.valString}>
            &quot;{highlightText(escapedString ?? value, filterLower)}&quot;
          </span>
        )}
        {typeof value === 'number' && (
          <span className={styles.valNumber}>{highlightText(String(value), filterLower)}</span>
        )}
        {typeof value === 'boolean' && (
          <span className={styles.valBoolean}>{String(value)}</span>
        )}
        {(value === null || value === undefined) && (
          <span className={styles.valNull}>null</span>
        )}

        {resolvedRef && (
          <span className={styles.comment}>
            {'// '}
            <button
              type="button"
              className={styles.refLink}
              onClick={handleRefClick}
              onAuxClick={handleRefAuxClick}
              title={`Click to inspect · Ctrl+Click or middle-click for new tab (${resolvedRef.table}:${resolvedRef.hash}${resolvedRef.subtitle ? ` — ${resolvedRef.subtitle}` : ''})`}
            >
              {getShortTableName(resolvedRef.table)} &quot;{resolvedRef.name || 'Unnamed'}&quot;
            </button>
          </span>
        )}

        {!resolvedRef && enumInfo && (
          <span className={styles.comment}>
            {'// '}
            <span className={styles.enumType}>{enumInfo.enumName}</span>
            {enumInfo.isBitmask ? ': ' : '.'}
            {enumInfo.label}
          </span>
        )}

        {!resolvedRef && !enumInfo && lazyTargetTable && lazyHash !== null && (
          <span className={styles.comment}>
            {'// '}
            <button
              type="button"
              className={`${styles.refLink} ${styles.refLinkLazy}`}
              onClick={handleLazyRefClick}
              onAuxClick={handleLazyRefAuxClick}
              title={`Table not loaded yet — click to load ${lazyTargetTable} and open ${lazyHash} · Ctrl+Click or middle-click for new tab`}
            >
              Open {getShortTableName(lazyTargetTable)} {lazyHash}
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

      {isImage && (
        <InlineImagePreview
          path={value}
          imageScaling={imageScaling}
          onOpenLightbox={onOpenLightbox}
        />
      )}
    </div>
  );
}

export function JsonTree({
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
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(
    () => initialExpanded ?? {},
  );
  const [expandGeneration, setExpandGeneration] = useState<{
    mode: 'default' | 'expand' | 'collapse';
    seq: number;
  }>({ mode: 'default', seq: 0 });
  const [lightbox, setLightbox] = useState<{ url: string; path: string } | null>(null);

  useEffect(() => {
    setFilter(initialFilter ?? '');
  }, [initialFilter]);

  const handleFilterChange = useCallback(
    (next: string) => {
      setFilter(next);
      onFilterChange?.(next);
    },
    [onFilterChange],
  );

  const handleTogglePath = useCallback(
    (targetPath: string, nextOpen: boolean) => {
      setExpandedMap((prev) => {
        const next = { ...prev, [targetPath]: nextOpen };
        onExpandedChange?.(next);
        return next;
      });
    },
    [onExpandedChange],
  );

  const filterLower = filter.trim().toLowerCase();

  const rootEntries = useMemo(() => {
    const all = Object.entries(data);
    if (!filterLower) {
      return all;
    }
    return all.filter(([key, val]) => matchesFilter(key, val, filterLower));
  }, [data, filterLower]);

  const handleOpenLightbox = useCallback((url: string, path: string) => {
    setLightbox({ url, path });
  }, []);

  const handleCopy = useCallback(
    (text: string, label: string) => {
      onCopy(text, label);
    },
    [onCopy],
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.filterInput}
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          placeholder="Filter keys or values…"
          aria-label="Filter JSON keys or values"
        />
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            setExpandedMap({});
            onExpandedChange?.({});
            setExpandGeneration((prev) => ({ mode: 'expand', seq: prev.seq + 1 }));
          }}
        >
          Expand
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            setExpandedMap({});
            onExpandedChange?.({});
            setExpandGeneration((prev) => ({ mode: 'collapse', seq: prev.seq + 1 }));
          }}
        >
          Collapse
        </button>
      </div>

      <div
        className={styles.tree}
        data-inspector-scroll="true"
        role="tree"
        aria-label="Definition JSON"
      >
        {rootEntries.length === 0 ? (
          <div className={styles.empty}>No fields match &quot;{filter}&quot;.</div>
        ) : (
          rootEntries.map(([key, val]) => (
            <JsonNode
              key={key}
              nodeKey={key}
              path={key}
              value={val}
              depth={0}
              filterLower={filterLower}
              expandGeneration={expandGeneration}
              expandedMap={expandedMap}
              onTogglePath={handleTogglePath}
              resolvedRefs={resolvedRefs}
              onNavigateRef={onNavigateRef}
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
}
