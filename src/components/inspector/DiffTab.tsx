import { memo, useCallback, useMemo, type MutableRefObject, type ReactNode } from 'react';
import type { DefinitionDetailPayload, DefinitionRef, SearchResultItem } from '../../types/manifest';
import { getShortTableName } from '../../manifest/tables';
import { useDiffBucketStore, type DiffBucketItem, type NewDiffBucketItem } from '../../stores/diffBucket';
import { useExplorerStore } from '../../stores/explorer';
import { useSettingsStore } from '../../stores/settings';
import { CheckIcon, CloseIcon, DiffIcon, PlusIcon, SwapIcon, TrashIcon } from '../../ui/Icons';
import { Popover } from '../../ui/Popover';
import { Select, type SelectOption } from '../../ui/Select';
import { Skeleton } from '../../ui/Skeleton';
import { BungieIcon } from '../BungieIcon';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import { JsonTree } from './JsonTree';
import { JsonDiffView } from './JsonDiffView';
import styles from './DiffTab.module.scss';

export interface DiffTabProps {
  baseDetail: DefinitionDetailPayload | null;
  targetDetail: DefinitionDetailPayload | null;
  baseLoading: boolean;
  targetLoading: boolean;
  activeItem: NewDiffBucketItem | null;
  bucketOpen: boolean;
  setBucketOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  bucketTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  onNavigateRef: (ref: DefinitionRef, inNewTab?: boolean) => void;
  onCopy: (text: string, label: string) => void;
}

function bucketLabel(item: DiffBucketItem): string {
  return item.name.trim() || `${getShortTableName(item.table)} #${item.hash}`;
}

function triggerLabel(item: DiffBucketItem): ReactNode {
  const name = item.name.trim();
  const prefix = name || `${getShortTableName(item.table)}\u00a0`;

  return (
    <span className={`${styles.triggerValue} ${!name ? styles.triggerValueUnnamed : ''}`}>
      <span className={styles.triggerName}>{prefix}</span>
      <span className={styles.triggerHash}>{name ? item.hash : `#${item.hash}`}</span>
    </span>
  );
}

function optionFor(item: DiffBucketItem): SelectOption<string> {
  return {
    value: item.key,
    label: bucketLabel(item),
    keywords: `${item.table} ${getShortTableName(item.table)} ${item.hash} ${item.subtitle}`,
    renderOption: (_option, state) => (
      <span className={styles.selectOption}>
        <BungieIcon icon={item.icon} size={22} />
        <span className={styles.selectOptionText}>
          <strong>{bucketLabel(item)}</strong>
          <small>{getShortTableName(item.table)} · {item.hash}</small>
        </span>
        {state.current ? <CheckIcon size={13} /> : null}
      </span>
    ),
  };
}

function toBucketItem(item: SearchResultItem): NewDiffBucketItem {
  return {
    table: item.table,
    hash: item.hash,
    name: item.name,
    subtitle: item.subtitle,
    ...(item.icon ? { icon: item.icon } : {}),
  };
}

export const DiffTab = memo(function DiffTab({
  baseDetail,
  targetDetail,
  baseLoading,
  targetLoading,
  activeItem,
  bucketOpen,
  setBucketOpen,
  bucketTriggerRef,
  onNavigateRef,
  onCopy,
}: DiffTabProps): ReactNode {
  const items = useDiffBucketStore((state) => state.items);
  const baseKey = useDiffBucketStore((state) => state.baseKey);
  const targetKey = useDiffBucketStore((state) => state.targetKey);
  const addItem = useDiffBucketStore((state) => state.addItem);
  const addItems = useDiffBucketStore((state) => state.addItems);
  const removeItem = useDiffBucketStore((state) => state.removeItem);
  const clearAll = useDiffBucketStore((state) => state.clearAll);
  const setBase = useDiffBucketStore((state) => state.setBase);
  const setTarget = useDiffBucketStore((state) => state.setTarget);
  const swapBaseTarget = useDiffBucketStore((state) => state.swapBaseTarget);
  const openDiffTab = useDiffBucketStore((state) => state.openDiffTab);
  const query = useExplorerStore((state) => state.query);
  const deepSearch = useExplorerStore((state) => state.deepSearch);
  const filters = useExplorerStore((state) => state.filters);
  const searchResults = useExplorerStore((state) => state.results);
  const pushNotice = useExplorerStore((state) => state.pushNotice);
  const setMobileInspectorOpen = useExplorerStore((state) => state.setMobileInspectorOpen);
  const mode = useSettingsStore((state) => state.explorerDiffViewMode);
  const setMode = useSettingsStore((state) => state.setExplorerDiffViewMode);
  const layout = useSettingsStore((state) => state.explorerDiffLayout);
  const setLayout = useSettingsStore((state) => state.setExplorerDiffLayout);
  const imageScaling = useSettingsStore((state) => state.imageScaling);
  const baseItem = items.find((item) => item.key === baseKey) ?? null;
  const targetItem = items.find((item) => item.key === targetKey) ?? null;
  const hasActiveSearchOrFilter =
    query.trim().length > 0 ||
    deepSearch ||
    filters.table !== 'all' ||
    filters.tierTypes.length > 0 ||
    filters.damageTypes.length > 0 ||
    filters.classTypes.length > 0 ||
    filters.itemTypes.length > 0 ||
    filters.itemCategoryHashes.length > 0 ||
    filters.includeUnnamed ||
    filters.onlyRedacted;

  const selectOptions = useMemo(() => items.map(optionFor), [items]);
  const mergedResolvedRefs = useMemo(
    () => ({
      ...(baseDetail?.resolvedRefs ?? {}),
      ...(targetDetail?.resolvedRefs ?? {}),
    }),
    [baseDetail?.resolvedRefs, targetDetail?.resolvedRefs],
  );
  const activeItemAlreadyInBucket =
    activeItem !== null &&
    items.some((item) => item.key === `${activeItem.table}:${activeItem.hash >>> 0}`);
  const addActive = useCallback(() => {
    if (!activeItem || activeItemAlreadyInBucket) return;
    addItem(activeItem);
    pushNotice({ tone: 'info', message: 'Added active tab to Diff bucket' });
  }, [activeItem, activeItemAlreadyInBucket, addItem, pushNotice]);
  const addSearchResults = useCallback(() => {
    const result = addItems(searchResults.map(toBucketItem), { cap: 100 });
    openDiffTab(true);
    setMobileInspectorOpen(true);
    pushNotice({
      tone: 'info',
      message:
        result.addedCount === 0
          ? 'All matching results are already in the Diff bucket'
          : result.truncated || searchResults.length > 100
            ? `Added ${result.addedCount} of first 100 results to Diff bucket`
            : `Added ${result.addedCount} ${result.addedCount === 1 ? 'result' : 'results'} to Diff bucket`,
    });
  }, [addItems, openDiffTab, pushNotice, searchResults, setMobileInspectorOpen]);
  const openBucketItem = useCallback(
    (item: DiffBucketItem, inNewTab = false) => {
      onNavigateRef(
        {
          table: item.table,
          hash: item.hash,
          label: item.name || undefined,
          icon: item.icon,
        },
        inNewTab,
      );
      setBucketOpen(false);
    },
    [onNavigateRef, setBucketOpen],
  );
  const showDiffEmptyActions = (items.length < 2);

  const modeToggle = (
    <div className={styles.modeToggle} role="group" aria-label="Diff view">
      {(['diff', 'formatted'] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={mode === view}
          className={mode === view ? styles.modeActive : ''}
          onClick={() => setMode(view)}
        >
          {view === 'diff' ? 'Diff' : 'Formatted'}
        </button>
      ))}
    </div>
  );

  const chooseBase = (key: string): void => setBase(key || null);
  const chooseTarget = (key: string): void => setTarget(key || null);
  const loading = Boolean(baseItem && targetItem && baseKey !== targetKey && (baseLoading || targetLoading));
  const filter = '';

  return (
    <section className={styles.diffTab} aria-label="Compare definitions">
      <header className={styles.compareHeader}>
        <label className={styles.selectGroup}>
          <span>Base</span>
          <Select
            className={styles.itemSelect}
            value={baseKey ?? ''}
            options={selectOptions}
            aria-label="Base definition"
            disabled={items.length === 0}
            displayLabel={baseItem ? triggerLabel(baseItem) : 'Choose base'}
            minPopupWidth={356}
            searchable={items.length > 8}
            searchPlaceholder="Search bucket…"
            onChange={chooseBase}
          />
        </label>
        <button
          type="button"
          className={styles.swapButton}
          onClick={swapBaseTarget}
          aria-label="Swap base and target"
          title="Swap base and target"
          disabled={!baseItem || !targetItem}
        >
          <SwapIcon size={14} />
        </button>
        <label className={styles.selectGroup}>
          <span>Target</span>
          <Select
            className={styles.itemSelect}
            value={targetKey ?? ''}
            options={selectOptions}
            aria-label="Target definition"
            disabled={items.length === 0}
            displayLabel={targetItem ? triggerLabel(targetItem) : 'Choose target'}
            minPopupWidth={356}
            searchable={items.length > 8}
            searchPlaceholder="Search bucket…"
            onChange={chooseTarget}
          />
        </label>
        <button
          ref={bucketTriggerRef}
          type="button"
          className={styles.bucketButton}
          aria-haspopup="dialog"
          aria-expanded={bucketOpen}
          onClick={(event) => {
            bucketTriggerRef.current = event.currentTarget;
            setBucketOpen((open) => !open);
          }}
        >
          <DiffIcon size={13} />
          <span>Bucket ({items.length})</span>
        </button>
        <Popover
          open={bucketOpen}
          onClose={() => setBucketOpen(false)}
          anchorRef={bucketTriggerRef}
          align="end"
          label="Diff bucket"
          width="min(30rem, calc(100vw - 1rem))"
        >
          <div className={styles.bucketPanel}>
            {items.length === 0 ? (
              <p className={styles.bucketEmpty}>No entries in the Diff bucket.</p>
            ) : (
              <div className={styles.bucketList}>
                {items.map((item) => (
                  <div className={styles.bucketRow} key={item.key}>
                    <button
                      type="button"
                      className={styles.bucketItem}
                      onClick={(event) => openBucketItem(item, event.ctrlKey || event.metaKey)}
                      onMouseDown={preventMiddleClickAutoScroll}
                      onAuxClick={(event) =>
                        activateOnMiddleClick(event, () => openBucketItem(item, true))
                      }
                      title="Open in a regular inspector tab"
                    >
                      <BungieIcon icon={item.icon} size={20} />
                      <span>
                        <strong>{bucketLabel(item)}</strong>
                        <small>{getShortTableName(item.table)} · {item.hash}</small>
                      </span>
                    </button>
                    <span className={styles.assignActions}>
                      <button
                        type="button"
                        className={`${styles.baseTargetBtn} ${
                          item.key === baseKey ? styles.baseTargetBtnActive : ''
                        }`}
                        onClick={() => setBase(item.key)}
                        aria-pressed={item.key === baseKey}
                        title="Set as Base"
                        aria-label={`Set ${bucketLabel(item)} as Base`}
                      >
                        Base
                      </button>
                      <button
                        type="button"
                        className={`${styles.baseTargetBtn} ${
                          item.key === targetKey ? styles.baseTargetBtnActive : ''
                        }`}
                        onClick={() => setTarget(item.key)}
                        aria-pressed={item.key === targetKey}
                        title="Set as Target"
                        aria-label={`Set ${bucketLabel(item)} as Target`}
                      >
                        Target
                      </button>
                    </span>
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeItem(item.key)}
                      aria-label={`Remove ${bucketLabel(item)} from Diff bucket`}
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.bucketFooter}>
              {activeItem && !activeItemAlreadyInBucket ? (
                <button type="button" onClick={addActive}><PlusIcon size={12} /> Active tab</button>
              ) : null}
              {hasActiveSearchOrFilter && searchResults.length > 0 ? (
                <button type="button" onClick={addSearchResults}>
                  <PlusIcon size={12} /> Search results ({searchResults.length > 100 ? 'up to 100' : searchResults.length})
                </button>
              ) : null}
              {items.length > 0 ? (
                <button type="button" className={styles.clearButton} onClick={clearAll}>
                  <TrashIcon size={12} /> Clear
                </button>
              ) : null}
            </div>
          </div>
        </Popover>
      </header>

      {items.length === 0 ? (
        <div className={styles.emptyState}>
          <DiffIcon size={22} />
          <strong>Add definitions to compare</strong>
          <span>Build a bucket from the active tab or your current search results.</span>
          <div className={styles.emptyActions}>
            {activeItem && !activeItemAlreadyInBucket ? <button type="button" onClick={addActive}><PlusIcon size={13} /> Add active tab</button> : null}
            {hasActiveSearchOrFilter && searchResults.length > 0 ? (
              <button type="button" onClick={addSearchResults}><PlusIcon size={13} /> Add search results ({Math.min(searchResults.length, 100)})</button>
            ) : null}
          </div>
        </div>
      ) : items.length === 1 ? (
        <div className={styles.emptyState}>
          <BungieIcon icon={items[0]?.icon} size={30} />
          <strong>{items[0] ? bucketLabel(items[0]) : 'One entry selected'}</strong>
          <span>Add another definition to compare its fields.</span>
          <div className={styles.emptyActions}>
            {activeItem && !activeItemAlreadyInBucket ? <button type="button" onClick={addActive}><PlusIcon size={13} /> Add active tab</button> : null}
            {hasActiveSearchOrFilter && searchResults.length > 0 ? (
              <button type="button" onClick={addSearchResults}><PlusIcon size={13} /> Add search results ({Math.min(searchResults.length, 100)})</button>
            ) : null}
          </div>
        </div>
      ) : !baseItem || !targetItem ? (
        <div className={styles.emptyState}>
          <strong>Select a base and target</strong>
          <span>Choose two different entries from the bucket to compare.</span>
          {showDiffEmptyActions && activeItem && !activeItemAlreadyInBucket ? <button type="button" onClick={addActive}><PlusIcon size={13} /> Add active tab</button> : null}
        </div>
      ) : baseItem.key === targetItem.key ? (
        <div className={styles.emptyState}>
          <strong>Same entry selected</strong>
          <span>Choose two different items from the bucket to compare.</span>
        </div>
      ) : loading || !baseDetail || !targetDetail ? (
        <div className={styles.loadingState} aria-label="Loading comparison">
          <Skeleton height="1.5rem" width="42%" />
          <Skeleton height="1rem" width="78%" />
          <Skeleton height="1rem" width="67%" />
          <Skeleton height="1rem" width="85%" />
        </div>
      ) : (
        <div className={styles.viewer}>
          {mode === 'diff' ? (
            <JsonDiffView
              before={baseDetail.data}
              after={targetDetail.data}
              filter={filter}
              layout={layout}
              onLayoutChange={setLayout}
              onCopy={onCopy}
              toolbarLeading={modeToggle}
            />
          ) : (
            <JsonTree
              key={`${baseKey}:${targetKey}`}
              data={targetDetail.data}
              diffBefore={baseDetail.data}
              resolvedRefs={mergedResolvedRefs}
              onNavigateRef={onNavigateRef}
              onCopy={onCopy}
              imageScaling={imageScaling}
              toolbarLeading={modeToggle}
            />
          )}
        </div>
      )}
    </section>
  );
});
