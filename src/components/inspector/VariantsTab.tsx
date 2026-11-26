import { memo, useState, type ReactNode } from 'react';
import type { DefinitionRef, VariantItem } from '../../types/manifest';
import { BungieIcon } from '../BungieIcon';
import { DiffIcon, ExternalLinkIcon } from '../../ui/Icons';
import { getTierColorVar } from '../../ui/rarity';
import { Skeleton } from '../../ui/Skeleton';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import styles from './InspectorTabs.module.scss';

/** Dummy, ornament, and shader families can run into the hundreds. */
const VARIANT_CHUNK_SIZE = 120;

export interface VariantsTabProps {
  currentRef: DefinitionRef;
  variants: VariantItem[];
  loading: boolean;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onDiffVariant: (variantRef: DefinitionRef) => void;
}

export const VariantsTab = memo(function VariantsTab({
  currentRef,
  variants,
  loading,
  onNavigateRef,
  onDiffVariant,
}: VariantsTabProps): ReactNode {
  const scopeKey = `${currentRef.table}:${currentRef.hash}:${variants.length}`;
  const [chunk, setChunk] = useState({ key: scopeKey, limit: VARIANT_CHUNK_SIZE });
  const limit = chunk.key === scopeKey ? chunk.limit : VARIANT_CHUNK_SIZE;
  const visible = variants.length > limit ? variants.slice(0, limit) : variants;
  const remaining = variants.length - visible.length;

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
    <div className={styles.scrollBody} data-inspector-scroll="true">
      <div className={styles.metaHeader}>
        {variants.length} definitions share this name family.
      </div>
      <div className={styles.entityList}>
        {visible.map((item) => {
          const isCurrent =
            item.hash === currentRef.hash && item.table === currentRef.table;
          const tierColor = getTierColorVar(item.tierType);
          const itemNavRef: DefinitionRef = {
            table: item.table,
            hash: item.hash,
            label: item.name || undefined,
            icon: item.icon,
          };
          return (
            <div
              key={`${item.table}:${item.hash}`}
              className={`${styles.variantRow} ${isCurrent ? styles.currentRow : ''}`}
            >
              <button
                type="button"
                className={styles.variantMain}
                title="Click to open in tab · Ctrl+Click or middle-click for new tab"
                onClick={(event) =>
                  onNavigateRef(
                    itemNavRef,
                    event.ctrlKey || event.metaKey || event.shiftKey,
                  )
                }
                onMouseDown={preventMiddleClickAutoScroll}
                onAuxClick={(event) => {
                  activateOnMiddleClick(event, () => onNavigateRef(itemNavRef, true));
                }}
              >
                <BungieIcon
                  icon={item.icon}
                  isEnhanced={item.isEnhanced}
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
                  <span
                    className={styles.entitySub}
                    style={tierColor ? { color: tierColor } : undefined}
                  >
                    {item.subtitle}
                  </span>
                </span>
              </button>
              <div className={styles.variantMeta}>
                <span className={styles.entityHash}>{item.hash}</span>
                <div className={styles.variantActions}>
                  <button
                    type="button"
                    className={styles.openInNewTabBtn}
                    aria-label={`Open ${item.name || `definition ${item.hash}`} in new tab`}
                    title={`Open ${item.name || `definition ${item.hash}`} in new tab`}
                    onClick={() => onNavigateRef(itemNavRef, true)}
                    onMouseDown={preventMiddleClickAutoScroll}
                    onAuxClick={(event) =>
                      activateOnMiddleClick(event, () => onNavigateRef(itemNavRef, true))
                    }
                  >
                    <ExternalLinkIcon size={14} />
                  </button>
                  {isCurrent ? (
                    <span className={styles.variantActionPlaceholder} aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => onDiffVariant(itemNavRef)}
                      title="Compare fields against current definition"
                    >
                      <DiffIcon size={13} />
                      Diff
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {remaining > 0 && (
        <div className={styles.inlineBtnGroup}>
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() =>
              setChunk({
                key: scopeKey,
                limit: Math.min(variants.length, limit + VARIANT_CHUNK_SIZE),
              })
            }
          >
            Show {Math.min(VARIANT_CHUNK_SIZE, remaining)} more (
            {remaining.toLocaleString()} remaining)
          </button>
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => setChunk({ key: scopeKey, limit: variants.length })}
          >
            Show all
          </button>
        </div>
      )}
    </div>
  );
});
