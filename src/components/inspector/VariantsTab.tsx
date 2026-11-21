import type { ReactNode } from 'react';
import type { DefinitionRef, VariantItem } from '../../types/manifest';
import { BungieIcon } from '../BungieIcon';
import { DiffIcon } from '../../ui/Icons';
import { Skeleton } from '../../ui/Skeleton';
import styles from './InspectorTabs.module.scss';

export interface VariantsTabProps {
  currentRef: DefinitionRef;
  variants: VariantItem[];
  loading: boolean;
  onNavigateRef: (ref: DefinitionRef) => void;
  onDiffVariant: (variantRef: DefinitionRef) => void;
}

export function VariantsTab({
  currentRef,
  variants,
  loading,
  onNavigateRef,
  onDiffVariant,
}: VariantsTabProps): ReactNode {
  if (loading) {
    return (
      <div className={styles.scrollBody}>
        <div className={styles.stackGap}>
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
        </div>
      </div>
    );
  }

  if (variants.length <= 1) {
    return (
      <div className={styles.scrollBody}>
        <div className={styles.emptyState}>
          No other variants with a matching base name were found in this table.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.scrollBody}>
      <div className={styles.metaHeader}>
        {variants.length} definitions share this name family.
      </div>
      <div className={styles.entityList}>
        {variants.map((item) => {
          const isCurrent =
            item.hash === currentRef.hash && item.table === currentRef.table;
          return (
            <div
              key={`${item.table}:${item.hash}`}
              className={`${styles.variantRow} ${isCurrent ? styles.currentRow : ''}`}
            >
              <button
                type="button"
                className={styles.variantMain}
                onClick={() => onNavigateRef({ table: item.table, hash: item.hash })}
              >
                <BungieIcon
                  icon={item.icon}
                  watermark={item.iconWatermark}
                  tierType={item.tierType}
                  size={32}
                />
                <span className={styles.entityText}>
                  <span className={styles.entityName}>
                    {item.name || 'Unnamed'}
                    {isCurrent && <span className={styles.tagCurrent}> current</span>}
                    {item.isAdept && <span className={styles.tagMuted}> · Adept</span>}
                    {item.isHolofoil && (
                      <span className={styles.tagMuted}> · Holofoil</span>
                    )}
                    {item.isRedacted && (
                      <span className={styles.tagMuted}> · Redacted</span>
                    )}
                  </span>
                  <span className={styles.entitySub}>{item.subtitle}</span>
                </span>
                <span className={styles.entityHash}>{item.hash}</span>
              </button>
              {!isCurrent && (
                <button
                  type="button"
                  className={styles.smallBtn}
                  onClick={() => onDiffVariant({ table: item.table, hash: item.hash })}
                  title="Compare fields against current definition"
                >
                  <DiffIcon size={13} />
                  Diff
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
