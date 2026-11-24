import { memo, useMemo, useState, type ReactNode } from 'react';
import type { DefinitionDetailPayload, DefinitionRef } from '../../types/manifest';
import { computeJsonDiff } from '../../manifest/diff';
import { getShortTableName } from '../../manifest/tables';
import { JsonDiffView } from './JsonDiffView';
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

  const isSame =
    pinnedRef !== null &&
    pinnedRef.table === current.table &&
    pinnedRef.hash === current.hash;

  const entries = useMemo(() => {
    if (!pinnedDetail || isSame) return [];
    return computeJsonDiff(pinnedDetail.data, current.data);
  }, [pinnedDetail, current.data, isSame]);

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
            {entries.length} {entries.length === 1 ? 'difference' : 'differences'}
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

      {entries.length === 0 ? (
        <div className={styles.emptyState}>These two definitions are identical.</div>
      ) : (
        <JsonDiffView
          before={pinnedDetail.data}
          after={current.data}
          filter={filter}
        />
      )}
    </div>
  );
});
