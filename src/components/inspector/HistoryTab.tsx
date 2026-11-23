import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeJsonDiff, type DiffEntry } from '../../manifest/diff';
import {
  fetchItemHistory,
  reconstructRevisionSnapshot,
  type HistoryVersionMeta,
  type ItemHistoryResult,
  type ResolvedItemRevision,
} from '../../manifest/history';
import { Skeleton } from '../../ui/Skeleton';
import styles from './InspectorTabs.module.scss';

type HistoryView = 'updates' | 'compare';
const CURRENT_VERSION = 'current';

export interface HistoryTabProps {
  table: string;
  hash: number;
  currentData: Record<string, unknown>;
}

function formatDate(date: string, includeDay = true): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    ...(includeDay ? { day: 'numeric' } : {}),
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function formatDiffVal(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'object' && value !== null) {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }
  return String(value);
}

function revisionEntries(revision: ResolvedItemRevision): DiffEntry[] {
  return (revision.d ?? []).map((op) => {
    if (op[0] === 0) {
      return { path: op[1], kind: 'changed', left: op[2], right: op[3] };
    }
    if (op[0] === 1) {
      return { path: op[1], kind: 'added', right: op[2] };
    }
    return { path: op[1], kind: 'removed', left: op[2] };
  });
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

function DiffRows({ entries }: { entries: DiffEntry[] }): ReactNode {
  if (entries.length === 0) {
    return <p className={styles.historyNoFields}>No field-level changes recorded.</p>;
  }
  return (
    <div className={styles.diffList}>
      {entries.map((entry, index) => (
        <div key={`${entry.path}:${index}`} className={styles.diffItem}>
          <div className={styles.diffPath}>
            <span className="mono">{entry.path}</span>
            <span className={styles.diffKind}>{entry.kind}</span>
          </div>
          {(entry.kind === 'removed' || entry.kind === 'changed') && (
            <div className={styles.diffDel}>− {formatDiffVal(entry.left)}</div>
          )}
          {(entry.kind === 'added' || entry.kind === 'changed') && (
            <div className={styles.diffIns}>+ {formatDiffVal(entry.right)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function RevisionCard({
  revision,
  expanded,
  onToggle,
  filter,
}: {
  revision: ResolvedItemRevision;
  expanded: boolean;
  onToggle: () => void;
  filter: string;
}): ReactNode {
  const entries = useMemo(() => revisionEntries(revision), [revision]);
  const query = filter.trim().toLowerCase();
  const filteredEntries = query
    ? entries.filter((entry) => entry.path.toLowerCase().includes(query))
    : entries;
  const versionLabel = revision.version.version ?? revision.version.id;

  return (
    <article className={styles.historyCard}>
      <button
        type="button"
        className={styles.historyCardToggle}
        aria-expanded={expanded}
        onClick={onToggle}
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
          {revision.t !== undefined && revision.t > (revision.d?.length ?? 0) && (
            <p className={styles.historyDiffNote}>
              Showing first {revision.d?.length ?? 0} of {revision.t} changes
            </p>
          )}
          {filteredEntries.length === 0 && query ? (
            <p className={styles.historyNoFields}>No changes match this path filter.</p>
          ) : (
            <DiffRows entries={filteredEntries} />
          )}
        </div>
      )}
    </article>
  );
}

function versionOptionLabel(version: HistoryVersionMeta): string {
  const date = formatDate(version.date);
  return `${date} · ${version.version ?? version.id}`;
}

export const HistoryTab = memo(function HistoryTab({
  table,
  hash,
  currentData,
}: HistoryTabProps): ReactNode {
  const [result, setResult] = useState<ItemHistoryResult | null>(null);
  const [view, setView] = useState<HistoryView>('updates');
  const [filter, setFilter] = useState('');
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [fromVersion, setFromVersion] = useState<string>('');
  const [toVersion, setToVersion] = useState<string>(CURRENT_VERSION);

  useEffect(() => {
    let mounted = true;
    setResult(null);
    void fetchItemHistory(table, hash).then((nextResult) => {
      if (mounted) {
        setResult(nextResult);
      }
    });
    return () => {
      mounted = false;
    };
  }, [table, hash]);

  useEffect(() => {
    if (!result?.available) {
      return;
    }
    const firstRevision = result.revisions[result.revisions.length - 1];
    const fallbackVersion = result.versions[0];
    const initialFrom = firstRevision?.v ?? fallbackVersion?.i;
    setFromVersion(initialFrom === undefined ? '' : String(initialFrom));
    setExpandedVersion(
      result.revisions.find((revision) => revision.k === 'm')?.v ??
        result.revisions[0]?.v ??
        null,
    );
  }, [result]);

  const query = filter.trim().toLowerCase();
  const visibleRevisions = useMemo(() => {
    if (!result) {
      return [];
    }
    return result.revisions.filter((revision) => {
      if (!query) {
        return true;
      }
      return revisionEntries(revision).some((entry) =>
        entry.path.toLowerCase().includes(query),
      );
    });
  }, [query, result]);

  const compareEntries = useMemo(() => {
    if (!result?.available || !fromVersion) {
      return [];
    }
    const from =
      fromVersion === CURRENT_VERSION
        ? currentData
        : reconstructRevisionSnapshot(
            currentData,
            result.revisions,
            Number(fromVersion),
          );
    const to =
      toVersion === CURRENT_VERSION
        ? currentData
        : reconstructRevisionSnapshot(
            currentData,
            result.revisions,
            Number(toVersion),
          );
    return computeJsonDiff(from, to);
  }, [currentData, fromVersion, result, toVersion]);

  const visibleCompareEntries = useMemo(
    () =>
      query
        ? compareEntries.filter((entry) => entry.path.toLowerCase().includes(query))
        : compareEntries,
    [compareEntries, query],
  );

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
  const summary = oldestRevision && newestRevision
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
          <input
            type="search"
            className={styles.historyFilter}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter changed fields…"
            aria-label="Filter changed fields"
          />
        </div>
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
                nextOlder &&
                gapExists(result.versions, nextOlder.v, revision.v);
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
                    onToggle={() =>
                      setExpandedVersion((current) =>
                        current === revision.v ? null : revision.v,
                      )
                    }
                    filter={filter}
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
                {result.versions.map((version) => (
                  <option key={version.i} value={version.i}>
                    {versionOptionLabel(version)}
                  </option>
                ))}
                <option value={CURRENT_VERSION}>Current live</option>
              </select>
            </label>
            <label className={styles.historySelectLabel}>
              <span>To</span>
              <select
                className={styles.historySelect}
                value={toVersion}
                onChange={(event) => setToVersion(event.target.value)}
              >
                {result.versions.map((version) => (
                  <option key={version.i} value={version.i}>
                    {versionOptionLabel(version)}
                  </option>
                ))}
                <option value={CURRENT_VERSION}>Current live</option>
              </select>
            </label>
          </div>
          {visibleCompareEntries.length === 0 ? (
            <div className={styles.emptyState}>
              {compareEntries.length === 0
                ? 'These two versions are identical.'
                : 'No differences match this path filter.'}
            </div>
          ) : (
            <DiffRows entries={visibleCompareEntries} />
          )}
        </div>
      )}
    </div>
  );
});
