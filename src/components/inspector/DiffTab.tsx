import { memo, useCallback, useState, type ReactNode } from 'react';
import type { DefinitionDetailPayload, DefinitionRef } from '../../types/manifest';
import { getShortTableName } from '../../manifest/tables';
import { JsonDiffView, type JsonDiffStats } from './JsonDiffView';
import { Skeleton } from '../../ui/Skeleton';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import styles from './InspectorTabs.module.scss';

export interface DiffTabProps {
  current: DefinitionDetailPayload;
  pinnedRef: DefinitionRef | null;
  pinnedDetail: DefinitionDetailPayload | null;
  pinnedLoading: boolean;
  onPinCurrent: () => void;
  onClearPin: () => void;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
}

export const DiffTab = memo(function DiffTab({
  current,
  pinnedRef,
  pinnedDetail,
  pinnedLoading,
  onPinCurrent,
  onClearPin,
  onNavigateRef,
}: DiffTabProps): ReactNode {
  const [filter, setFilter] = useState('');
  const [lineStats, setLineStats] = useState<{
    before: unknown;
    after: unknown;
    stats: JsonDiffStats;
  } | null>(null);

  const isSame =
    pinnedRef !== null &&
    pinnedRef.table === current.table &&
    pinnedRef.hash === current.hash;

  const handleDiffStats = useCallback(
    (stats: JsonDiffStats) => {
      if (!pinnedDetail) return;
      setLineStats((currentStats) =>
        currentStats?.before === pinnedDetail.data &&
        currentStats.after === current.data &&
        currentStats.stats.added === stats.added &&
        currentStats.stats.removed === stats.removed
          ? currentStats
          : { before: pinnedDetail.data, after: current.data, stats },
      );
    },
    [current.data, pinnedDetail],
  );

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
  const currentLineStats =
    lineStats?.before === pinnedDetail.data && lineStats.after === current.data
      ? lineStats.stats
      : null;

  return (
    <div className={styles.scrollBody} data-inspector-scroll="true">
      <div className={styles.diffHeader}>
        <div className={styles.diffSummary}>
          <span>
            Baseline:{' '}
            <button
              type="button"
              className={styles.inlineLink}
              onClick={(event) =>
                onNavigateRef(
                  { ...pinnedRef, label: pinnedName },
                  event.ctrlKey || event.metaKey,
                )
              }
              onMouseDown={preventMiddleClickAutoScroll}
              onAuxClick={(event) =>
                activateOnMiddleClick(event, () =>
                  onNavigateRef({ ...pinnedRef, label: pinnedName }, true),
                )
              }
            >
              {pinnedName} ({pinnedRef.hash})
            </button>
          </span>
          <span className={styles.metaCount}>
            {currentLineStats
              ? `+${currentLineStats.added} / −${currentLineStats.removed} lines`
              : 'Calculating line diff…'}
          </span>
        </div>
        <div className={styles.diffControls}>
          <ClearSearchInput
            className={styles.diffFilter}
            wrapperClassName={styles.diffFilterWrap}
            value={filter}
            onValueChange={setFilter}
            placeholder="Filter changed paths…"
            aria-label="Filter diff paths"
            clearLabel="Clear diff filter"
          />
          <button type="button" className={styles.smallBtn} onClick={onClearPin}>
            Clear baseline
          </button>
        </div>
      </div>

      {currentLineStats?.added === 0 && currentLineStats.removed === 0 ? (
        <div className={styles.emptyState}>These two definitions are identical.</div>
      ) : (
        <JsonDiffView
          before={pinnedDetail.data}
          after={current.data}
          filter={filter}
          onStats={handleDiffStats}
        />
      )}
    </div>
  );
});
