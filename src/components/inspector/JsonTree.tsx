import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { DefinitionRef, ResolvedHashSummary } from '../../types/manifest';
import { annotateEnumField } from '../../manifest/enums';
import {
  bungieAssetUrl,
  getTargetTablesForField,
  isBungieImagePath,
  toUnsignedHash,
} from '../../manifest/hash';
import { getShortTableName } from '../../manifest/tables';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  ImageIcon,
} from '../../ui/Icons';
import styles from './JsonTree.module.scss';

export interface JsonTreeProps {
  data: Record<string, unknown>;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
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
  const unsigned = toUnsignedHash(value);
  const targets = getTargetTablesForField(fieldName, parentKey);

  for (const table of targets) {
    const direct = resolvedRefs[`${table}:${unsigned}`];
    if (direct) {
      return direct;
    }
  }

  const looksLikeHashKey =
    /hash(es)?$/i.test(fieldName) ||
    (parentKey !== undefined && /hash(es)?$/i.test(parentKey));
  if (looksLikeHashKey || targets.length > 0) {
    const anyMatch = resolvedRefs[String(unsigned)];
    if (anyMatch) {
      return anyMatch;
    }
  }

  return null;
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
  onOpenLightbox: (url: string, path: string) => void;
}

function InlineImagePreview({ path, onOpenLightbox }: InlineImagePreviewProps): ReactNode {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [errored, setErrored] = useState(false);
  const url = bungieAssetUrl(path);
  const isScreenshot = /screenshot/i.test(path);

  if (errored) {
    return null;
  }

  return (
    <div className={styles.imagePreview}>
      <button
        type="button"
        className={isScreenshot ? styles.screenshotBtn : styles.iconPreviewBtn}
        onClick={() => onOpenLightbox(url, path)}
        title="Open full-size image"
      >
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className={isScreenshot ? styles.screenshotImg : styles.iconImg}
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
  resolvedRefs: Record<string, ResolvedHashSummary>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
  onOpenLightbox: (url: string, path: string) => void;
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
  resolvedRefs,
  onNavigateRef,
  onCopy,
  onOpenLightbox,
  isArrayItem = false,
}: NodeProps): ReactNode {
  const defaultExpanded =
    depth === 0 &&
    (nodeKey === 'displayProperties' || nodeKey === 'inventory' || nodeKey === 'equippingBlock');

  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [lastSeq, setLastSeq] = useState(expandGeneration.seq);

  if (lastSeq !== expandGeneration.seq) {
    setLastSeq(expandGeneration.seq);
    setManualOpen(null);
  }

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
    const count = entries.length;
    const peek = !isExpanded && count > 0 ? getCollapsedPeek(value as Record<string, unknown>, isArray) : null;
    const summary = isArray
      ? `[${count}]`
      : `{${count}}`;

    return (
      <div className={styles.node}>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={() => setManualOpen(!isExpanded)}
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
          {peek && <span className={styles.peek}>{peek}</span>}
          {swatch && (
            <span
              className={styles.swatch}
              style={{
                backgroundColor: `rgba(${swatch.r}, ${swatch.g}, ${swatch.b}, ${swatch.a})`,
              }}
              title={`rgba(${swatch.r}, ${swatch.g}, ${swatch.b}, ${swatch.a.toFixed(2)})`}
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
                  parentKey={isArray ? nodeKey : undefined}
                  path={childPath}
                  value={childValue}
                  depth={depth + 1}
                  filterLower={filterLower}
                  expandGeneration={expandGeneration}
                  resolvedRefs={resolvedRefs}
                  onNavigateRef={onNavigateRef}
                  onCopy={onCopy}
                  onOpenLightbox={onOpenLightbox}
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
  const isImage = isBungieImagePath(value);

  const handleRefClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!resolvedRef) return;
    const inNewTab = event.ctrlKey || event.metaKey || event.shiftKey;
    onNavigateRef({ table: resolvedRef.table, hash: resolvedRef.hash }, inNewTab);
  };

  const handleRefAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.button === 1 && resolvedRef) {
      event.preventDefault();
      onNavigateRef({ table: resolvedRef.table, hash: resolvedRef.hash }, true);
    }
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
            &quot;{highlightText(value, filterLower)}&quot;
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

      {isImage && <InlineImagePreview path={value} onOpenLightbox={onOpenLightbox} />}
    </div>
  );
}

export function JsonTree({
  data,
  resolvedRefs,
  onNavigateRef,
  onCopy,
}: JsonTreeProps): ReactNode {
  const [filter, setFilter] = useState('');
  const [expandGeneration, setExpandGeneration] = useState<{
    mode: 'default' | 'expand' | 'collapse';
    seq: number;
  }>({ mode: 'default', seq: 0 });
  const [lightbox, setLightbox] = useState<{ url: string; path: string } | null>(null);

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

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.filterInput}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter keys or values…"
          aria-label="Filter JSON keys or values"
        />
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() =>
            setExpandGeneration((prev) => ({ mode: 'expand', seq: prev.seq + 1 }))
          }
        >
          Expand
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() =>
            setExpandGeneration((prev) => ({ mode: 'collapse', seq: prev.seq + 1 }))
          }
        >
          Collapse
        </button>
      </div>

      <div className={styles.tree} role="tree" aria-label="Definition JSON">
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
              resolvedRefs={resolvedRefs}
              onNavigateRef={onNavigateRef}
              onCopy={onCopy}
              onOpenLightbox={handleOpenLightbox}
            />
          ))
        )}
      </div>

      {lightbox && (
        <div
          className={styles.lightboxBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Asset preview"
          onClick={() => setLightbox(null)}
        >
          <div className={styles.lightboxCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.lightboxHeader}>
              <span className={styles.lightboxTitle}>
                <ImageIcon size={14} />
                <span className="mono">{lightbox.path}</span>
              </span>
              <div className={styles.lightboxActions}>
                <a
                  href={lightbox.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.toolBtn}
                >
                  Open original
                </a>
                <button
                  type="button"
                  className={styles.toolBtn}
                  onClick={() => setLightbox(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className={styles.lightboxBody}>
              <img src={lightbox.url} alt="" className={styles.lightboxImg} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
