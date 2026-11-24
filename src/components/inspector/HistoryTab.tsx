import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  DefinitionRef,
  ImageScalingMode,
  ResolvedHashSummary,
} from '../../types/manifest';
import {
  fetchItemHistory,
  reconstructRevisionPair,
  reconstructRevisionSnapshot,
  type HistoryVersionMeta,
  type ItemHistoryResult,
  type ResolvedItemRevision,
  type RevisionSnapshotPair,
} from '../../manifest/history';
import { JsonDiffView, JsonSyntaxView } from './JsonDiffView';
import { JsonTree } from './JsonTree';
import { Skeleton } from '../../ui/Skeleton';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import styles from './InspectorTabs.module.scss';

type HistoryView = 'updates' | 'compare';
type RevisionMode = 'diff' | 'pretty' | 'json';
type CompareMode = 'diff' | 'from-json' | 'to-json';
type SnapshotPairLookup = (version: number) => RevisionSnapshotPair;
const CURRENT_VERSION = 'current';

const REVISION_MODES: ReadonlyArray<{ value: RevisionMode; label: string }> = [
  { value: 'diff', label: 'Diff' },
  { value: 'pretty', label: 'Pretty' },
  { value: 'json', label: 'JSON' },
];

const COMPARE_MODES: ReadonlyArray<{ value: CompareMode; label: string }> = [
  { value: 'diff', label: 'Diff' },
  { value: 'from-json', label: 'From JSON' },
  { value: 'to-json', label: 'To JSON' },
];

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export interface HistoryTabProps {
  table: string;
  hash: number;
  currentData: Record<string, unknown>;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  imageScaling: ImageScalingMode;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
}

function formatDate(date: string, includeDay = true): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return (includeDay ? DATE_FORMATTER : MONTH_YEAR_FORMATTER).format(parsed);
}

function revisionLabel(revision: ResolvedItemRevision): string {
  switch (revision.k) {
    case 'a':
      return 'Added';
    case 'm': {
      const fields = revision.t ?? revision.d?.length ?? 0;
      return `Modified · ${fields} ${fields === 1 ? 'field' : 'fields'}`;
    }
    case 'r':
      return 'Removed';
    case 'u':
      return 'Unclassified';
    case 'c':
      return 'Reclassified';
  }
}

function gapExists(
  versions: HistoryVersionMeta[],
  olderIndex: number,
  newerIndex: number,
): boolean {
  return versions.some(
    (version) =>
      version.gapBefore && version.i > olderIndex && version.i <= newerIndex,
  );
}

function HistoryGap(): ReactNode {
  return (
    <div className={styles.historyGap} role="note">
      <span className={styles.historyGapLine} aria-hidden="true" />
      <span>Archive gap — intermediate updates not yet archived</span>
      <span className={styles.historyGapLine} aria-hidden="true" />
    </div>
  );
}

function versionOptionLabel(version: HistoryVersionMeta): string {
  const date = formatDate(version.date);
  return `${date} · ${version.version ?? version.id}`;
}

function snapshotText(snapshot: unknown): string {
  if (snapshot === undefined) return '';
  const json = JSON.stringify(snapshot, null, 2);
  return json === undefined ? '' : json;
}

function downloadJson(snapshot: unknown, filename: string): void {
  const blob = new Blob([snapshotText(snapshot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ModeButtons<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  label: string;
  onChange: (value: T) => void;
}): ReactNode {
  return (
    <div className={styles.historyModeToggle} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`${styles.historyModeButton} ${
            value === option.value ? styles.historyModeButtonActive : ''
          }`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function JsonSnapshot({
  snapshot,
  filter,
  table,
  hash,
  version,
  onCopy,
}: {
  snapshot: unknown;
  filter: string;
  table: string;
  hash: number;
  version: string;
  onCopy: (text: string, label: string) => void;
}): ReactNode {
  // Cache the pretty-printed JSON: switching Diff → Pretty → JSON or re-expanding
  // a revision reuses the same snapshot object, and stringifying a multi-MB
  // definition is the expensive part of this panel.
  const json = useMemo(() => snapshotText(snapshot), [snapshot]);
  const filename = `${table}-${hash}-v${version}.json`;
  return (
    <div className={styles.historySnapshot}>
      <div className={styles.historySnapshotActions}>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={() => onCopy(json, 'Copied snapshot JSON')}
        >
          Copy JSON
        </button>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={() => downloadJson(snapshot, filename)}
        >
          Download .json
        </button>
      </div>
      {snapshot === null ? (
        <p className={styles.historyNoFields}>This item did not exist in this version.</p>
      ) : (
        <JsonSyntaxView value={snapshot} filter={filter} />
      )}
    </div>
  );
}

function SnapshotPretty({
  snapshot,
  resolvedRefs,
  imageScaling,
  onNavigateRef,
  onCopy,
}: {
  snapshot: unknown;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  imageScaling: ImageScalingMode;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
}): ReactNode {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return <p className={styles.historyNoFields}>This item did not exist in this version.</p>;
  }
  return (
    <JsonTree
      data={snapshot as Record<string, unknown>}
      resolvedRefs={resolvedRefs}
      imageScaling={imageScaling}
      onNavigateRef={onNavigateRef}
      onCopy={onCopy}
      embedded
    />
  );
}

const RevisionCard = memo(function RevisionCard({
  revision,
  expanded,
  onToggle,
  filter,
  table,
  hash,
  resolvedRefs,
  imageScaling,
  onNavigateRef,
  onCopy,
  getSnapshotPair,
}: {
  revision: ResolvedItemRevision;
  expanded: boolean;
  onToggle: (version: number) => void;
  filter: string;
  table: string;
  hash: number;
  resolvedRefs: Record<string, ResolvedHashSummary>;
  imageScaling: ImageScalingMode;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
  /** Cached reconstruction pair for this tab's `(table, hash, currentData)` scope. */
  getSnapshotPair: SnapshotPairLookup;
}): ReactNode {
  const [mode, setMode] = useState<RevisionMode>('diff');
  // One reconstruction walk produces both sides of this revision, and the tab
  // caches both versions, so flipping modes or revisiting stays O(1).
  const { before, after } = useMemo(() => {
    if (!expanded) return { before: null, after: null };
    return getSnapshotPair(revision.v);
  }, [expanded, getSnapshotPair, revision.v]);
  const versionLabel = revision.version.version ?? revision.version.id;

  return (
    <article className={styles.historyCard}>
      <button
        type="button"
        className={styles.historyCardToggle}
        aria-expanded={expanded}
        onClick={() => onToggle(revision.v)}
      >
        <span className={styles.historyCardTitle}>
          <span className={styles.historyDate}>{formatDate(revision.version.date)}</span>
          <span
            className={styles.historyVersion}
            title={`Manifest version ${versionLabel}`}
          >
            {versionLabel}
          </span>
        </span>
        <span
          className={`${styles.historyBadge} ${
            revision.k === 'a'
              ? styles.historyBadgeAdded
              : revision.k === 'r'
                ? styles.historyBadgeRemoved
                : ''
          }`}
        >
          {revisionLabel(revision)}
        </span>
        <span className={styles.historyChevron} aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && (
        <div className={styles.historyCardBody}>
          <div className={styles.historyCardToolbar}>
            <ModeButtons
              value={mode}
              options={REVISION_MODES}
              label="Revision display mode"
              onChange={setMode}
            />
            {revision.t !== undefined && revision.t > (revision.d?.length ?? 0) && (
              <p className={styles.historyDiffNote}>
                Showing first {revision.d?.length ?? 0} of {revision.t} recorded changes
              </p>
            )}
          </div>
          {mode === 'diff' ? (
            <JsonDiffView
              before={before}
              after={after}
              filter={filter}
              onCopy={onCopy}
              defaultLayout="inline"
            />
          ) : mode === 'pretty' ? (
            <SnapshotPretty
              snapshot={after}
              resolvedRefs={resolvedRefs}
              imageScaling={imageScaling}
              onNavigateRef={onNavigateRef}
              onCopy={onCopy}
            />
          ) : (
            <JsonSnapshot
              snapshot={after}
              filter={filter}
              table={table}
              hash={hash}
              version={String(revision.v)}
              onCopy={onCopy}
            />
          )}
        </div>
      )}
    </article>
  );
});

export const HistoryTab = memo(function HistoryTab({
  table,
  hash,
  currentData,
  resolvedRefs,
  imageScaling,
  onNavigateRef,
  onCopy,
}: HistoryTabProps): ReactNode {
  const [result, setResult] = useState<ItemHistoryResult | null>(null);
  const [view, setView] = useState<HistoryView>('updates');
  const [filter, setFilter] = useState('');
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [fromVersion, setFromVersion] = useState<string>('');
  const [toVersion, setToVersion] = useState<string>(CURRENT_VERSION);
  const [compareMode, setCompareMode] = useState<CompareMode>('diff');

  useEffect(() => {
    let mounted = true;
    setResult(null);
    void fetchItemHistory(table, hash).then((nextResult) => {
      if (mounted) setResult(nextResult);
    });
    return () => {
      mounted = false;
    };
  }, [table, hash]);

  useEffect(() => {
    if (!result?.available) return;
    const latestChange = result.revisions[0];
    const previousVersion = latestChange
      ? [...result.versions]
          .filter((version) => version.i < latestChange.v)
          .sort((a, b) => b.i - a.i)[0]
      : undefined;
    const previousRevision = result.revisions[1];
    const oldestRevision = result.revisions[result.revisions.length - 1];
    const initialFrom =
      previousVersion?.i ?? previousRevision?.v ?? oldestRevision?.v ?? result.versions[0]?.i;
    setFromVersion(initialFrom === undefined ? '' : String(initialFrom));
    setToVersion(CURRENT_VERSION);
    setExpandedVersion(
      result.revisions.find((revision) => revision.k === 'm')?.v ??
        result.revisions[0]?.v ??
        null,
    );
  }, [result]);

  // One cache per `(table, hash, currentData, revisions)` scope. Snapshots are
  // detached clones from the history module, so they are safe to share between
  // the Diff/Pretty/JSON views. Reconstructing a revision pair populates both
  // `v` and `v - 1` at once, which halves patch work per expanded card.
  const { getSnapshot, getSnapshotPair } = useMemo(() => {
    const prefix = `${table}:${hash}:`;
    const snapshots = new Map<string, unknown>();
    const pairs = new Map<string, RevisionSnapshotPair>();
    const revisions = result?.revisions ?? [];

    const getSnapshot = (version: number): unknown => {
      const key = `${prefix}${version}`;
      if (snapshots.has(key)) {
        return snapshots.get(key);
      }
      const snapshot = reconstructRevisionSnapshot(currentData, revisions, version);
      snapshots.set(key, snapshot);
      return snapshot;
    };

    const getSnapshotPair = (version: number): RevisionSnapshotPair => {
      const key = `${prefix}${version}`;
      const cached = pairs.get(key);
      if (cached) {
        return cached;
      }
      const pair = reconstructRevisionPair(currentData, revisions, version);
      pairs.set(key, pair);
      snapshots.set(key, pair.after);
      snapshots.set(`${prefix}${version - 1}`, pair.before);
      return pair;
    };

    return { getSnapshot, getSnapshotPair };
  }, [currentData, hash, result, table]);

  const toggleRevision = useCallback((version: number) => {
    setExpandedVersion((current) => (current === version ? null : version));
  }, []);

  const query = filter.trim().toLowerCase();
  const visibleRevisions = useMemo(() => {
    if (!result) return [];
    return result.revisions.filter((revision) => {
      if (!query) return true;
      return (revision.d ?? []).some((op) => op[1].toLowerCase().includes(query));
    });
  }, [query, result]);

  const newestFirstVersions = useMemo(
    () => [...(result?.versions ?? [])].sort((a, b) => b.i - a.i),
    [result],
  );

  const compareSnapshots = useMemo(() => {
    if (!result?.available || !fromVersion) {
      return { from: null, to: null };
    }
    return {
      from: fromVersion === CURRENT_VERSION ? currentData : getSnapshot(Number(fromVersion)),
      to: toVersion === CURRENT_VERSION ? currentData : getSnapshot(Number(toVersion)),
    };
  }, [currentData, fromVersion, getSnapshot, result, toVersion]);

  if (!result) {
    return (
      <div className={styles.historyTab} data-inspector-scroll="true">
        <div className={styles.stackGap}>
          <Skeleton height="2rem" />
          <Skeleton height="4rem" />
          <Skeleton height="4rem" />
          <Skeleton height="4rem" />
        </div>
      </div>
    );
  }

  const hasRevisions = result.revisions.length > 0;
  const oldestRevision = result.revisions[result.revisions.length - 1];
  const newestRevision = result.revisions[0];
  const summary =
    oldestRevision && newestRevision
      ? `${result.revisions.length} ${
          result.revisions.length === 1 ? 'update' : 'updates'
        } · ${formatDate(oldestRevision.version.date, false)} → ${formatDate(
          newestRevision.version.date,
          false,
        )}`
      : 'No recorded updates';

  return (
    <div className={styles.historyTab} data-inspector-scroll="true">
      <header className={styles.historyHeader}>
        <div className={styles.historyHeaderTop}>
          <p className={styles.historySummary}>{summary}</p>
          <ClearSearchInput
            className={styles.historyFilter}
            wrapperClassName={styles.historyFilterWrap}
            value={filter}
            onValueChange={setFilter}
            placeholder="Filter changed fields…"
            aria-label="Filter changed fields"
            clearLabel="Clear history filter"
          />
          <div
            className={styles.historyViewToggle}
            role="group"
            aria-label="History view"
          >
            <button
              type="button"
              className={`${styles.historyViewButton} ${
                view === 'updates' ? styles.historyViewButtonActive : ''
              }`}
              aria-pressed={view === 'updates'}
              onClick={() => setView('updates')}
            >
              Updates
            </button>
            <button
              type="button"
              className={`${styles.historyViewButton} ${
                view === 'compare' ? styles.historyViewButtonActive : ''
              }`}
              aria-pressed={view === 'compare'}
              onClick={() => setView('compare')}
            >
              Compare
            </button>
          </div>
        </div>
      </header>

      {!result.available ? (
        <div className={styles.emptyState}>
          Manifest history is available on the deployed site.
        </div>
      ) : !hasRevisions ? (
        <div className={styles.emptyState}>
          No historical changes recorded for this definition.
        </div>
      ) : view === 'updates' ? (
        <div className={styles.historyTimeline}>
          {visibleRevisions.length === 0 ? (
            <div className={styles.emptyState}>No updates match this path filter.</div>
          ) : (
            visibleRevisions.map((revision, index) => {
              const nextOlder = visibleRevisions[index + 1];
              const hasGapAfter =
                nextOlder && gapExists(result.versions, nextOlder.v, revision.v);
              const hasGapBeforeFirst =
                !nextOlder &&
                oldestRevision &&
                revision.v === oldestRevision.v &&
                result.versions.some(
                  (version) => version.gapBefore && version.i <= oldestRevision.v,
                );
              return (
                <div className={styles.historyTimelineEntry} key={revision.v}>
                  <RevisionCard
                    revision={revision}
                    expanded={expandedVersion === revision.v}
                    onToggle={toggleRevision}
                    filter={filter}
                    table={table}
                    hash={hash}
                    resolvedRefs={resolvedRefs}
                    imageScaling={imageScaling}
                    onNavigateRef={onNavigateRef}
                    onCopy={onCopy}
                    getSnapshotPair={getSnapshotPair}
                  />
                  {(hasGapAfter || hasGapBeforeFirst) && <HistoryGap />}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className={styles.historyCompare}>
          <div className={styles.historyCompareControls}>
            <label className={styles.historySelectLabel}>
              <span>From</span>
              <select
                className={styles.historySelect}
                value={fromVersion}
                onChange={(event) => setFromVersion(event.target.value)}
              >
                <option value={CURRENT_VERSION}>Current live</option>
                {newestFirstVersions.map((version) => (
                  <option key={version.i} value={version.i}>
                    {versionOptionLabel(version)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.historySelectLabel}>
              <span>To</span>
              <select
                className={styles.historySelect}
                value={toVersion}
                onChange={(event) => setToVersion(event.target.value)}
              >
                <option value={CURRENT_VERSION}>Current live</option>
                {newestFirstVersions.map((version) => (
                  <option key={version.i} value={version.i}>
                    {versionOptionLabel(version)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.historyCompareToolbar}>
            <ModeButtons
              value={compareMode}
              options={COMPARE_MODES}
              label="Compare display mode"
              onChange={setCompareMode}
            />
            {compareMode === 'from-json' && (
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() =>
                  onCopy(snapshotText(compareSnapshots.from), 'Copied From snapshot JSON')
                }
              >
                Copy JSON
              </button>
            )}
            {compareMode === 'to-json' && (
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() =>
                  onCopy(snapshotText(compareSnapshots.to), 'Copied To snapshot JSON')
                }
              >
                Copy JSON
              </button>
            )}
          </div>
          {compareMode === 'diff' ? (
            <JsonDiffView
              before={compareSnapshots.from}
              after={compareSnapshots.to}
              filter={filter}
              onCopy={onCopy}
            />
          ) : (
            <div className={styles.historySnapshot}>
              {compareMode === 'from-json' ? (
                compareSnapshots.from === null ? (
                  <p className={styles.historyNoFields}>
                    This item did not exist in the selected version.
                  </p>
                ) : (
                  <JsonSyntaxView value={compareSnapshots.from} filter={filter} />
                )
              ) : compareSnapshots.to === null ? (
                <p className={styles.historyNoFields}>
                  This item did not exist in the selected version.
                </p>
              ) : (
                <JsonSyntaxView value={compareSnapshots.to} filter={filter} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
