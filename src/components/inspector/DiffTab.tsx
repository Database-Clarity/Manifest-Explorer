import { useMemo, useState, type ReactNode } from 'react';
import type { DefinitionDetailPayload, DefinitionRef } from '../../types/manifest';
import { computeJsonDiff, type DiffEntry } from '../../manifest/diff';
import { getShortTableName } from '../../manifest/tables';
import { Skeleton } from '../../ui/Skeleton';
import styles from './InspectorTabs.module.scss';

export interface DiffTabProps {
  current: DefinitionDetailPayload;
  pinnedRef: DefinitionRef | null;
  pinnedDetail: DefinitionDetailPayload | null;
  pinnedLoading: boolean;
  onPinCurrent: () => void;
  onClearPin: () => void;
  onNavigateRef: (ref: DefinitionRef) => void;
}

function formatDiffVal(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'object' && value !== null) {
    const str = JSON.stringify(value);
    return str.length > 180 ? `${str.slice(0, 177)}…` : str;
  }
  return String(value);
}

export function DiffTab({
  current,
  pinnedRef,
  pinnedDetail,
  pinnedLoading,
  onPinCurrent,
  onClearPin,
  onNavigateRef,
}: DiffTabProps): ReactNode {
  const [filter, setFilter] = useState('');

  const isSame =
    pinnedRef !== null &&
    pinnedRef.table === current.table &&
    pinnedRef.hash === current.hash;

  const entries: DiffEntry[] = useMemo(() => {
    if (!pinnedDetail || isSame) {
      return [];
    }
    return computeJsonDiff(pinnedDetail.data, current.data);
  }, [pinnedDetail, current.data, isSame]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return entries;
    }
    return entries.filter((e) => e.path.toLowerCase().includes(q));
  }, [entries, filter]);

  if (!pinnedRef) {
    return (
      <div className={styles.scrollBody}>
        <div className={styles.emptyState}>
          <p>
            Pin this definition as a comparison baseline, then open another definition (or
            pick a Variant) to compare fields side by side.
          </p>
          <button type="button" className={styles.primaryBtn} onClick={onPinCurrent}>
            Pin current as baseline
          </button>
        </div>
      </div>
    );
  }

  if (isSame) {
    return (
      <div className={styles.scrollBody}>
        <div className={styles.emptyState}>
          <p>
            Baseline pinned: <strong>{getShortTableName(pinnedRef.table)}</strong>{' '}
            <span className="mono">{pinnedRef.hash}</span>. Open another definition or
            click Diff on a variant to see changes.
          </p>
          <button type="button" className={styles.smallBtn} onClick={onClearPin}>
            Clear baseline
          </button>
        </div>
      </div>
    );
  }

  if (pinnedLoading || !pinnedDetail) {
    return (
      <div className={styles.scrollBody}>
        <div className={styles.stackGap}>
          <Skeleton height="2rem" />
          <Skeleton height="4rem" />
          <Skeleton height="4rem" />
        </div>
      </div>
    );
  }

  const pinnedName =
    ((pinnedDetail.data.displayProperties as { name?: string } | undefined)?.name ??
      `${getShortTableName(pinnedDetail.table)} ${pinnedDetail.hash}`);

  return (
    <div className={styles.scrollBody}>
      <div className={styles.diffHeader}>
        <div className={styles.diffSummary}>
          <span>
            Baseline:{' '}
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() => onNavigateRef(pinnedRef)}
            >
              {pinnedName} ({pinnedRef.hash})
            </button>
          </span>
          <span className={styles.metaCount}>
            {entries.length} {entries.length === 1 ? 'difference' : 'differences'}
          </span>
        </div>
        <div className={styles.diffControls}>
          <input
            type="search"
            className={styles.diffFilter}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter changed paths…"
            aria-label="Filter diff paths"
          />
          <button type="button" className={styles.smallBtn} onClick={onClearPin}>
            Clear baseline
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          {entries.length === 0
            ? 'These two definitions are identical.'
            : 'No differences match this path filter.'}
        </div>
      ) : (
        <div className={styles.diffList}>
          {filtered.map((entry) => (
            <div key={entry.path} className={styles.diffItem}>
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
      )}
    </div>
  );
}
