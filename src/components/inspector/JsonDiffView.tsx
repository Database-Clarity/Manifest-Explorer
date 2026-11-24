import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createJsonLineDiff,
  groupJsonDiffLines,
  type JsonDiffLine,
} from '../../manifest/lineDiff';
import styles from './JsonDiffView.module.scss';

export interface JsonDiffViewProps {
  before: unknown;
  after: unknown;
  filter?: string;
  onCopy?: (text: string, label: string) => void;
  /** Prefer split on desktop while allowing the view to adapt on narrow screens. */
  defaultLayout?: 'inline' | 'split';
  onStats?: (stats: JsonDiffStats) => void;
}

export interface JsonDiffStats {
  added: number;
  removed: number;
}

interface JsonSyntaxViewProps {
  value: unknown;
  filter?: string;
}

type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null';

const TOKEN_PATTERN =
  /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;

function markedText(text: string, query: string): ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const fragments: ReactNode[] = [];
  let cursor = 0;
  let match = lowerText.indexOf(lowerQuery, cursor);
  while (match >= 0) {
    if (match > cursor) {
      fragments.push(text.slice(cursor, match));
    }
    fragments.push(
      <mark className={styles.match} key={`${match}:${fragments.length}`}>
        {text.slice(match, match + query.length)}
      </mark>,
    );
    cursor = match + query.length;
    match = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }
  return fragments;
}

function syntaxLine(text: string, query: string): ReactNode[] {
  const parts: ReactNode[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const token = match[0];
    const index = match.index;
    if (index > cursor) {
      parts.push(markedText(text.slice(cursor, index), query));
    }
    let kind: TokenKind;
    if (token.startsWith('"')) {
      kind = /^\s*:/.test(text.slice(index + token.length)) ? 'key' : 'string';
    } else if (token === 'null') {
      kind = 'null';
    } else if (token === 'true' || token === 'false') {
      kind = 'boolean';
    } else {
      kind = 'number';
    }
    parts.push(
      <span className={styles[`token${kind[0]!.toUpperCase()}${kind.slice(1)}`]} key={index}>
        {markedText(token, query)}
      </span>,
    );
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    parts.push(markedText(text.slice(cursor), query));
  }
  return parts;
}

const diffSyntaxCache = new WeakMap<JsonDiffLine, Map<string, ReactNode[]>>();

function syntaxDiffLine(line: JsonDiffLine, query: string): ReactNode[] {
  let byQuery = diffSyntaxCache.get(line);
  if (!byQuery) {
    byQuery = new Map();
    diffSyntaxCache.set(line, byQuery);
  }
  const cached = byQuery.get(query);
  if (cached) return cached;

  const tokens = syntaxLine(line.text, query);
  byQuery.set(query, tokens);
  if (byQuery.size > 4) {
    const oldestQuery = byQuery.keys().next().value;
    if (oldestQuery !== undefined) byQuery.delete(oldestQuery);
  }
  return tokens;
}

function formatJson(value: unknown): string[] {
  if (value === undefined) return [];
  const text = JSON.stringify(value, null, 2);
  return text === undefined ? [] : text.split('\n');
}

export const JsonSyntaxView = memo(function JsonSyntaxView({
  value,
  filter = '',
}: JsonSyntaxViewProps): ReactNode {
  const lines = useMemo(() => formatJson(value), [value]);
  const query = filter.trim();
  const tokenizedLines = useMemo(
    () => lines.map((line) => syntaxLine(line, query)),
    [lines, query],
  );
  return (
    <div className={styles.syntaxViewport} role="region" aria-label="Formatted JSON">
      <div className={styles.codeRows}>
        {lines.map((_, index) => (
          <div className={styles.syntaxRow} key={index}>
            <span className={styles.syntaxLineNumber} aria-hidden="true">
              {index + 1}
            </span>
            <code className={styles.codeLine}>{tokenizedLines[index]}</code>
          </div>
        ))}
      </div>
    </div>
  );
});

function JsonLine({ line, filter }: { line: JsonDiffLine; filter: string }): ReactNode {
  const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '';
  const className =
    line.kind === 'added'
      ? styles.addedLine
      : line.kind === 'removed'
        ? styles.removedLine
        : styles.contextLine;
  return (
    <div className={className}>
      <span className={styles.oldLineNumber} aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className={styles.newLineNumber} aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      <span className={styles.mobileLineNumber} aria-hidden="true">
        {line.newLine ?? line.oldLine ?? ''}
      </span>
      <span className={styles.signGutter} aria-hidden="true">
        {sign}
      </span>
      <code className={styles.codeLine}>{syntaxDiffLine(line, filter)}</code>
    </div>
  );
}

interface SplitDiffRow {
  before: JsonDiffLine | null;
  after: JsonDiffLine | null;
}

function splitDiffRows(lines: readonly JsonDiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    if (line.kind === 'context') {
      rows.push({ before: line, after: line });
      cursor += 1;
      continue;
    }

    const removed: JsonDiffLine[] = [];
    const added: JsonDiffLine[] = [];
    while (cursor < lines.length && lines[cursor]?.kind !== 'context') {
      const change = lines[cursor]!;
      if (change.kind === 'removed') removed.push(change);
      else added.push(change);
      cursor += 1;
    }
    const rowCount = Math.max(removed.length, added.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        before: removed[index] ?? null,
        after: added[index] ?? null,
      });
    }
  }
  return rows;
}

const splitDiffRowsCache = new WeakMap<
  readonly JsonDiffLine[],
  Map<string, SplitDiffRow[]>
>();

function getSplitDiffRows(
  lines: readonly JsonDiffLine[],
  start: number,
  end: number,
): SplitDiffRow[] {
  let bySegment = splitDiffRowsCache.get(lines);
  if (!bySegment) {
    bySegment = new Map();
    splitDiffRowsCache.set(lines, bySegment);
  }

  const key = `${start}:${end}`;
  const cached = bySegment.get(key);
  if (cached) return cached;

  const rows = splitDiffRows(lines.slice(start, end));
  bySegment.set(key, rows);
  return rows;
}

function SplitCell({
  line,
  side,
  filter,
}: {
  line: JsonDiffLine | null;
  side: 'before' | 'after';
  filter: string;
}): ReactNode {
  if (!line) {
    return (
      <div className={`${styles.splitCell} ${styles.splitPlaceholder}`} aria-hidden="true">
        <span />
      </div>
    );
  }

  const lineKindClass =
    line.kind === 'added'
      ? styles.addedLine
      : line.kind === 'removed'
        ? styles.removedLine
        : styles.contextLine;
  const lineNumber = side === 'before' ? line.oldLine : line.newLine;
  const matches = !filter || line.text.toLowerCase().includes(filter.toLowerCase());
  const matchClass = filter
    ? matches
      ? styles.matchingLine
      : styles.nonMatchingLine
    : '';
  return (
    <div className={`${styles.splitCell} ${lineKindClass} ${matchClass}`}>
      <span className={styles.splitLineNumber} aria-hidden="true">
        {lineNumber ?? ''}
      </span>
      <code className={styles.codeLine}>{syntaxDiffLine(line, filter)}</code>
    </div>
  );
}

function MoreDiffLines({
  remaining,
  onShowMore,
  onShowAll,
}: {
  remaining: number;
  onShowMore: () => void;
  onShowAll: () => void;
}): ReactNode {
  if (remaining <= 0) return null;
  const amount = Math.min(400, remaining);
  return (
    <div className={styles.renderMore} role="group" aria-label="More diff lines">
      <button type="button" onClick={onShowMore}>
        Show {amount.toLocaleString()} more {amount === 1 ? 'line' : 'lines'} (
        {remaining.toLocaleString()} remaining)
      </button>
      <button type="button" onClick={onShowAll}>
        Show all
      </button>
    </div>
  );
}

function DiffControls({
  start,
  end,
  total,
  hasChangesAbove,
  hasChangesBelow,
  hasAnyChanges,
  split = false,
  onReveal,
}: {
  start: number;
  end: number;
  total: number;
  hasChangesAbove: boolean;
  hasChangesBelow: boolean;
  hasAnyChanges: boolean;
  split?: boolean;
  onReveal: (from: number, to: number) => void;
}): ReactNode {
  const count = end - start;
  if (count <= 0) return null;
  const className = split
    ? `${styles.collapsedRegion} ${styles.splitCollapsedRegion}`
    : styles.collapsedRegion;
  if (!hasAnyChanges) {
    return (
      <div className={className}>
        <span>{count} unchanged lines</span>
        <button type="button" onClick={() => onReveal(start, end)}>
          Expand all ({count} lines)
        </button>
      </div>
    );
  }
  if (!hasChangesAbove) {
    const revealStart = Math.max(start, end - 20);
    return (
      <div className={className}>
        <button type="button" onClick={() => onReveal(revealStart, end)}>
          ↑ Expand {end - revealStart} above
        </button>
        <button type="button" onClick={() => onReveal(0, total)}>
          Expand all ({count} lines)
        </button>
      </div>
    );
  }
  if (!hasChangesBelow) {
    const revealEnd = Math.min(end, start + 20);
    return (
      <div className={className}>
        <button type="button" onClick={() => onReveal(start, revealEnd)}>
          ↓ Expand {revealEnd - start} below
        </button>
        <button type="button" onClick={() => onReveal(0, total)}>
          Expand all ({count} lines)
        </button>
      </div>
    );
  }
  if (count <= 24) {
    return (
      <div className={className}>
        <button type="button" onClick={() => onReveal(start, end)}>
          ↕ Expand {count} lines
        </button>
      </div>
    );
  }
  const upperEnd = Math.min(end, start + 20);
  const lowerStart = Math.max(start, end - 20);
  return (
    <div className={className}>
      <button type="button" onClick={() => onReveal(start, upperEnd)}>
        ↑ 20 above
      </button>
      <span>{count} hidden lines</span>
      <button type="button" onClick={() => onReveal(lowerStart, end)}>
        ↓ 20 below
      </button>
      <button type="button" onClick={() => onReveal(start, end)}>
        Expand all
      </button>
    </div>
  );
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export const JsonDiffView = memo(function JsonDiffView({
  before,
  after,
  filter = '',
  onCopy,
  defaultLayout = 'inline',
  onStats,
}: JsonDiffViewProps): ReactNode {
  const userSelectedLayoutRef = useRef(false);
  const [layout, setLayout] = useState<'inline' | 'split'>(() =>
    defaultLayout === 'split' &&
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 900px)').matches
      ? 'split'
      : 'inline',
  );
  const [wrap, setWrap] = useState(true);
  const [expandedLines, setExpandedLines] = useState<ReadonlySet<number>>(() => new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [lineLimitState, setLineLimitState] = useState<{
    lines: readonly JsonDiffLine[];
    limit: number;
  } | null>(null);
  const diff = useMemo(() => createJsonLineDiff(before, after), [after, before]);
  const segments = useMemo(
    () => groupJsonDiffLines(diff.lines, 3, expandedLines, expandAll),
    [diff.lines, expandedLines, expandAll],
  );
  const visibleLineLimit =
    lineLimitState?.lines === diff.lines ? lineLimitState.limit : 400;
  const totalExpandedLines = useMemo(
    () =>
      segments.reduce(
        (total, segment) =>
          segment.type === 'visible' ? total + segment.end - segment.start : total,
        0,
      ),
    [segments],
  );
  const renderSegments = useMemo(() => {
    let remaining = visibleLineLimit;
    return segments.flatMap((segment) => {
      if (segment.type === 'collapsed') return [segment];
      if (remaining <= 0) return [];
      const end = Math.min(segment.end, segment.start + remaining);
      remaining -= end - segment.start;
      return [end === segment.end ? segment : { ...segment, end }];
    });
  }, [segments, visibleLineLimit]);
  const remainingVisibleLines = Math.max(0, totalExpandedLines - visibleLineLimit);
  const query = filter.trim();

  const showMoreLines = (): void => {
    setLineLimitState({
      lines: diff.lines,
      limit: Math.min(totalExpandedLines, visibleLineLimit + 400),
    });
  };
  const showAllLines = (): void => {
    setLineLimitState({ lines: diff.lines, limit: totalExpandedLines });
  };

  useEffect(() => {
    onStats?.({ added: diff.added, removed: diff.removed });
  }, [diff.added, diff.removed, onStats]);

  useEffect(() => {
    if (defaultLayout !== 'split' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 900px)');
    const updateLayout = (): void => {
      if (!userSelectedLayoutRef.current) {
        setLayout(media.matches ? 'split' : 'inline');
      }
    };
    media.addEventListener('change', updateLayout);
    updateLayout();
    return () => media.removeEventListener('change', updateLayout);
  }, [defaultLayout]);

  const changedIndexes = useMemo(
    () =>
      diff.lines.flatMap((line, index) => (line.kind === 'context' ? [] : [index])),
    [diff.lines],
  );

  const revealLines = (start: number, end: number): void => {
    setExpandedLines((current) => {
      const next = new Set(current);
      for (let index = start; index < end; index += 1) next.add(index);
      return next;
    });
  };

  const copyDiff = (): void => {
    if (!onCopy) return;
    const text = diff.lines
      .map((line) => {
        const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
        return `${sign}${line.text}`;
      })
      .join('\n');
    onCopy(text, 'Copied JSON diff');
  };

  return (
    <section
      className={`${styles.viewer} ${wrap ? '' : styles.unwrapped} ${
        layout === 'split' ? styles.splitLayout : ''
      }`}
      aria-label="JSON diff"
    >
      <div className={styles.toolbar}>
        <span className={styles.summary}>
          <strong className={styles.addedCount}>+{diff.added}</strong>
          <span aria-hidden="true"> / </span>
          <strong className={styles.removedCount}>−{diff.removed}</strong> lines
        </span>
        <div className={styles.toolbarActions}>
          <div className={styles.layoutToggle} role="group" aria-label="Diff layout">
            {(['inline', 'split'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={layout === mode ? styles.layoutButtonActive : styles.layoutButton}
                aria-pressed={layout === mode}
                onClick={() => {
                  userSelectedLayoutRef.current = true;
                  setLayout(mode);
                }}
              >
                {mode === 'inline' ? 'Inline' : 'Split'}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={wrap}
            onClick={() => setWrap((current) => !current)}
            title={wrap ? 'Turn off soft line wrapping' : 'Turn on soft line wrapping'}
          >
            Wrap
          </button>
          <button
            type="button"
            onClick={() => {
              setExpandedLines(new Set());
              setExpandAll((expanded) => !expanded);
              setLineLimitState({ lines: diff.lines, limit: 400 });
            }}
          >
            {expandAll ? 'Collapse unchanged' : 'Expand all'}
          </button>
          {onCopy && (
            <button type="button" onClick={copyDiff}>
              Copy
            </button>
          )}
        </div>
      </div>
      {layout === 'inline' ? (
        <div className={styles.diffViewport} role="region" aria-label="Inline JSON diff">
          <div className={styles.codeRows}>
            {renderSegments.map((segment) => {
              if (segment.type === 'visible') {
                return (
                  <div key={`visible-${segment.start}-${segment.end}`}>
                    {segment.scope && (
                      <div className={styles.scopeBreadcrumb} aria-label="JSON scope">
                        {segment.scope.map((part, index) => (
                          <span key={`${part}-${index}`}>
                            {index > 0 && <span className={styles.breadcrumbSeparator}>›</span>}
                            {part}
                          </span>
                        ))}
                      </div>
                    )}
                    {diff.lines.slice(segment.start, segment.end).map((line, offset) => {
                      const lineIndex = segment.start + offset;
                      const matches =
                        !query || line.text.toLowerCase().includes(query.toLowerCase());
                      return (
                        <div
                          className={
                            query && !matches
                              ? styles.nonMatchingLine
                              : matches && query
                                ? styles.matchingLine
                                : undefined
                          }
                          key={`line-${lineIndex}`}
                        >
                          <JsonLine line={line} filter={query} />
                        </div>
                      );
                    })}
                  </div>
                );
              }

              const hasChangesAbove = lowerBound(changedIndexes, segment.start) > 0;
              const hasChangesBelow =
                lowerBound(changedIndexes, segment.end) < changedIndexes.length;
              return (
                <DiffControls
                  key={`collapsed-${segment.start}-${segment.end}`}
                  start={segment.start}
                  end={segment.end}
                  total={diff.lines.length}
                  hasChangesAbove={hasChangesAbove}
                  hasChangesBelow={hasChangesBelow}
                  hasAnyChanges={changedIndexes.length > 0}
                  onReveal={revealLines}
                />
              );
            })}
            <MoreDiffLines
              remaining={remainingVisibleLines}
              onShowMore={showMoreLines}
              onShowAll={showAllLines}
            />
          </div>
        </div>
      ) : (
        <div className={styles.diffViewport} role="region" aria-label="Side-by-side JSON diff">
          <div className={styles.splitRows}>
            <div className={styles.splitHeader}>
              <span>Before</span>
              <span>After</span>
            </div>
            {renderSegments.map((segment) => {
              if (segment.type === 'visible') {
                return (
                  <div
                    className={styles.splitHunk}
                    key={`visible-${segment.start}-${segment.end}`}
                  >
                    {segment.scope && (
                      <div className={styles.scopeBreadcrumb} aria-label="JSON scope">
                        {segment.scope.map((part, index) => (
                          <span key={`${part}-${index}`}>
                            {index > 0 && <span className={styles.breadcrumbSeparator}>›</span>}
                            {part}
                          </span>
                        ))}
                      </div>
                    )}
                    {getSplitDiffRows(diff.lines, segment.start, segment.end).map(
                      (row, index) => (
                        <div className={styles.splitRow} key={`${segment.start}-${index}`}>
                          <SplitCell line={row.before} side="before" filter={query} />
                          <SplitCell line={row.after} side="after" filter={query} />
                        </div>
                      ),
                    )}
                  </div>
                );
              }

              const hasChangesAbove = lowerBound(changedIndexes, segment.start) > 0;
              const hasChangesBelow =
                lowerBound(changedIndexes, segment.end) < changedIndexes.length;
              return (
                <DiffControls
                  key={`collapsed-${segment.start}-${segment.end}`}
                  start={segment.start}
                  end={segment.end}
                  total={diff.lines.length}
                  hasChangesAbove={hasChangesAbove}
                  hasChangesBelow={hasChangesBelow}
                  hasAnyChanges={changedIndexes.length > 0}
                  split
                  onReveal={revealLines}
                />
              );
            })}
            <MoreDiffLines
              remaining={remainingVisibleLines}
              onShowMore={showMoreLines}
              onShowAll={showAllLines}
            />
          </div>
        </div>
      )}
    </section>
  );
});
