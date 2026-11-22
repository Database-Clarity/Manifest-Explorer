import { memo, useMemo, type ReactNode } from 'react';
import type { DefinitionRef, ReverseReferenceResponse } from '../../types/manifest';
import { getFriendlyTableName, getShortTableName } from '../../manifest/tables';
import { BungieIcon } from '../BungieIcon';
import { Skeleton } from '../../ui/Skeleton';
import { ExternalLinkIcon } from '../../ui/Icons';
import styles from './InspectorTabs.module.scss';

export interface ReferencesTabProps {
  response: ReverseReferenceResponse | null;
  loading: boolean;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onLoadPriorityTable: (table: string) => void;
}

export const ReferencesTab = memo(function ReferencesTab({
  response,
  loading,
  onNavigateRef,
  onLoadPriorityTable,
}: ReferencesTabProps): ReactNode {
  const grouped = useMemo(() => {
    if (!response) {
      return [];
    }
    const map = new Map<string, ReverseReferenceResponse['references']>();
    for (const ref of response.references) {
      const list = map.get(ref.sourceTable);
      if (list) {
        list.push(ref);
      } else {
        map.set(ref.sourceTable, [ref]);
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [response]);

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
        <div className={styles.metaHeader}>
          <span>
            {response.references.length} referencing{' '}
            {response.references.length === 1 ? 'definition' : 'definitions'} across{' '}
            {response.scannedTables.length} loaded tables ({response.durationMs.toFixed(0)}{' '}
            ms)
          </span>
        </div>
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
          No loaded definitions reference this hash.
        </div>
      ) : (
        grouped.map(([table, refs]) => (
          <section key={table} className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {getFriendlyTableName(table)} ({refs.length})
            </h3>
            <div className={styles.entityList}>
              {refs.map((ref) => {
                const refName =
                  ref.sourceName ||
                  `${getShortTableName(ref.sourceTable)} ${ref.sourceHash}`;
                const definitionRef: DefinitionRef = {
                  table: ref.sourceTable,
                  hash: ref.sourceHash,
                  label: ref.sourceName || undefined,
                  icon: ref.sourceIcon,
                };
                return (
                  <div
                    key={`${ref.sourceTable}:${ref.sourceHash}`}
                    className={styles.refActionRow}
                  >
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
                      onAuxClick={(event) => {
                        if (event.button === 1) {
                          event.preventDefault();
                          onNavigateRef(definitionRef, true);
                        }
                      }}
                    >
                      <BungieIcon icon={ref.sourceIcon} size={28} />
                      <span className={styles.entityText}>
                        <span className={styles.entityName}>{refName}</span>
                        <span className={`${styles.entitySub} mono`}>
                          {ref.paths.slice(0, 3).join(', ')}
                          {ref.paths.length > 3
                            ? ` (+${ref.paths.length - 3} more)`
                            : ''}
                        </span>
                      </span>
                      <span className={styles.entityHash}>{ref.sourceHash}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.openInNewTabBtn}
                      aria-label={`Open ${refName} in new tab`}
                      title={`Open ${refName} in new tab`}
                      onClick={() => onNavigateRef(definitionRef, true)}
                    >
                      <ExternalLinkIcon size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
});
