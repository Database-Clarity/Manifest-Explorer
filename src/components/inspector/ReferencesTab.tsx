import { memo, useMemo, useState, type ReactNode } from 'react';
import type {
  DefinitionRef,
  ReverseReference,
  ReverseReferenceResponse,
} from '../../types/manifest';
import { getFriendlyTableName, getShortTableName } from '../../manifest/tables';
import { BungieIcon } from '../BungieIcon';
import { Skeleton } from '../../ui/Skeleton';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import { ExternalLinkIcon } from '../../ui/Icons';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import styles from './InspectorTabs.module.scss';

/** Definitions like weapon tiers can be referenced by thousands of items. */
const REFERENCE_CHUNK_SIZE = 80;
const REFERENCE_FILTER_THRESHOLD = 40;

export interface ReferencesTabProps {
  /** Stable identity of the definition; response refreshes may add tables. */
  scopeKey: string;
  response: ReverseReferenceResponse | null;
  loading: boolean;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onLoadPriorityTable: (table: string) => void;
}

interface ReferenceGroup {
  table: string;
  refs: ReverseReference[];
  /** Total references in this table before the active filter. */
  total: number;
}

function referenceMatches(
  ref: ReverseReference,
  needle: string,
  tableSearch: string,
): boolean {
  return (
    ref.sourceName.toLowerCase().includes(needle) ||
    String(ref.sourceHash).includes(needle) ||
    tableSearch.includes(needle) ||
    ref.paths.some((path) => path.toLowerCase().includes(needle))
  );
}

const ReferenceRow = memo(function ReferenceRow({
  reference,
  onNavigateRef,
}: {
  reference: ReverseReference;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
}): ReactNode {
  const refName =
    reference.sourceName ||
    `${getShortTableName(reference.sourceTable)} ${reference.sourceHash}`;
  const definitionRef: DefinitionRef = {
    table: reference.sourceTable,
    hash: reference.sourceHash,
    label: reference.sourceName || undefined,
    icon: reference.sourceIcon,
  };

  return (
    <div className={styles.refActionRow}>
      <button
        type="button"
        className={styles.entityRow}
        title="Click to open in tab · Ctrl+Click or middle-click for new tab"
        onClick={(event) =>
          onNavigateRef(
            definitionRef,
            event.ctrlKey || event.metaKey || event.shiftKey,
          )
        }
        onMouseDown={preventMiddleClickAutoScroll}
        onAuxClick={(event) => {
          activateOnMiddleClick(event, () => onNavigateRef(definitionRef, true));
        }}
      >
        <BungieIcon icon={reference.sourceIcon} size={28} />
        <span className={styles.entityText}>
          <span className={styles.entityName}>{refName}</span>
          <span className={`${styles.entitySub} mono`}>
            {reference.paths.slice(0, 3).join(', ')}
            {reference.paths.length > 3
              ? ` (+${reference.paths.length - 3} more)`
              : ''}
          </span>
        </span>
        <span className={styles.entityHash}>{reference.sourceHash}</span>
      </button>
      <button
        type="button"
        className={styles.openInNewTabBtn}
        aria-label={`Open ${refName} in new tab`}
        title={`Open ${refName} in new tab`}
        onClick={() => onNavigateRef(definitionRef, true)}
        onMouseDown={preventMiddleClickAutoScroll}
        onAuxClick={(event) =>
          activateOnMiddleClick(event, () => onNavigateRef(definitionRef, true))
        }
      >
        <ExternalLinkIcon size={14} />
      </button>
    </div>
  );
});

export const ReferencesTab = memo(function ReferencesTab({
  scopeKey,
  response,
  loading,
  onNavigateRef,
  onLoadPriorityTable,
}: ReferencesTabProps): ReactNode {
  const [filter, setFilter] = useState('');
  // Keep the expanded limit when a background table load refreshes this
  // definition's response. A different definition still starts at the cap.
  const [limitState, setLimitState] = useState<{
    scopeKey: string;
    limits: Record<string, number>;
  }>({ scopeKey, limits: {} });
  const limits = limitState.scopeKey === scopeKey ? limitState.limits : {};
  const query = filter.trim().toLowerCase();

  // Filtering happens over every reference; chunking only trims the rendered
  // rows per table group, so matches are never hidden by the initial cap.
  const grouped = useMemo<ReferenceGroup[]>(() => {
    if (!response) {
      return [];
    }
    const totals = new Map<string, number>();
    for (const ref of response.references) {
      totals.set(ref.sourceTable, (totals.get(ref.sourceTable) ?? 0) + 1);
    }
    const tableSearch = new Map<string, string>();
    const searchForTable = (table: string): string => {
      let text = tableSearch.get(table);
      if (text === undefined) {
        text = `${table.toLowerCase()} ${getShortTableName(table).toLowerCase()} ${getFriendlyTableName(table).toLowerCase()}`;
        tableSearch.set(table, text);
      }
      return text;
    };
    const map = new Map<string, ReverseReference[]>();
    for (const ref of response.references) {
      if (query && !referenceMatches(ref, query, searchForTable(ref.sourceTable))) {
        continue;
      }
      const list = map.get(ref.sourceTable);
      if (list) {
        list.push(ref);
      } else {
        map.set(ref.sourceTable, [ref]);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([table, refs]) => ({
        table,
        refs,
        total: totals.get(table) ?? refs.length,
      }));
  }, [query, response]);

  const updateLimits = (
    updater: (current: Record<string, number>) => Record<string, number>,
  ): void => {
    setLimitState((current) => ({
      scopeKey,
      limits: updater(current.scopeKey === scopeKey ? current.limits : {}),
    }));
  };

  const showMore = (group: ReferenceGroup, limit: number): void => {
    updateLimits((current) => ({
      ...current,
      [group.table]: Math.min(
        group.refs.length,
        (current[group.table] ?? limit) + REFERENCE_CHUNK_SIZE,
      ),
    }));
  };

  const showAll = (group: ReferenceGroup): void => {
    updateLimits((current) => ({
      ...current,
      // Keep the whole group expanded if another table load refreshes it.
      [group.table]: Number.POSITIVE_INFINITY,
    }));
  };

  if (loading && !response) {
    return (
      <div className={styles.scrollBody}>
        <div className={styles.metaHeader}>Scanning loaded manifest tables…</div>
        <div className={styles.stackGap}>
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.scrollBody} data-inspector-scroll="true">
      {response && (
        <div
          className={styles.metaHeader}
          title={`Scan finished in ${response.durationMs.toFixed(0)} ms`}
        >
          <span>
            {response.references.length} referencing{' '}
            {response.references.length === 1 ? 'definition' : 'definitions'} across{' '}
            {response.scannedTables.length} loaded tables
          </span>
        </div>
      )}

      {response && response.references.length > REFERENCE_FILTER_THRESHOLD && (
        <ClearSearchInput
          className={styles.poolFilter}
          wrapperClassName={styles.poolFilterField}
          value={filter}
          onValueChange={setFilter}
          placeholder={`Filter ${response.references.length} references…`}
          aria-label="Filter references"
          clearLabel="Clear reference filter"
          autoComplete="off"
          spellCheck={false}
        />
      )}

      {response && response.unloadedPriorityTables.length > 0 && (
        <div className={styles.noticeBanner}>
          <span>Load more tables for exhaustive reverse lookup:</span>
          <div className={styles.inlineBtnGroup}>
            {response.unloadedPriorityTables.map((table) => (
              <button
                key={table}
                type="button"
                className={styles.smallBtn}
                onClick={() => onLoadPriorityTable(table)}
              >
                Load {getShortTableName(table)}
              </button>
            ))}
          </div>
        </div>
      )}

      {grouped.length === 0 ? (
        <div className={styles.emptyState}>
          {query
            ? 'No loaded definitions match this reference filter.'
            : 'No loaded definitions reference this hash.'}
        </div>
      ) : (
        grouped.map((group) => {
          const limit = limits[group.table] ?? REFERENCE_CHUNK_SIZE;
          const shown =
            group.refs.length > limit ? group.refs.slice(0, limit) : group.refs;
          const remaining = group.refs.length - shown.length;
          return (
            <section key={group.table} className={styles.section}>
              <h3 className={styles.sectionTitle}>
                {getFriendlyTableName(group.table)} ({group.refs.length}
                {query ? ` of ${group.total.toLocaleString()}` : ''})
              </h3>
              <div className={styles.entityList}>
                {shown.map((ref) => (
                  <ReferenceRow
                    key={`${ref.sourceTable}:${ref.sourceHash}`}
                    reference={ref}
                    onNavigateRef={onNavigateRef}
                  />
                ))}
              </div>
              {remaining > 0 && (
                <div className={styles.inlineBtnGroup}>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={() => showMore(group, limit)}
                  >
                    Show {Math.min(REFERENCE_CHUNK_SIZE, remaining)} more (
                    {remaining.toLocaleString()} remaining)
                  </button>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={() => showAll(group)}
                  >
                    Show all
                  </button>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
});
