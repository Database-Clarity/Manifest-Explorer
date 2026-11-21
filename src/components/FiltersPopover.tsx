/// <reference types="vite/client" />
import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { FilterOption, SearchFilters } from '../types/manifest';
import {
  CLASS_FILTER_OPTIONS,
  DAMAGE_FILTER_OPTIONS,
  ITEM_TYPE_FILTER_OPTIONS,
  TIER_FILTER_OPTIONS,
} from '../manifest/enums';
import { useExplorerStore } from '../stores/explorer';
import { CheckIcon, SearchIcon } from '../ui/Icons';
import { Popover } from '../ui/Popover';
import styles from './FiltersPopover.module.scss';

export interface FiltersPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}

const DAMAGE_DOT: Readonly<Record<number, string>> = {
  1: 'var(--el-kinetic)',
  2: 'var(--el-arc)',
  3: 'var(--el-solar)',
  4: 'var(--el-void)',
  5: 'var(--el-prismatic)',
  6: 'var(--el-stasis)',
  7: 'var(--el-strand)',
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

function toggleValue(values: number[], value: number): number[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function matchesOption(option: FilterOption, query: string): boolean {
  return query.length === 0 || option.label.toLowerCase().includes(query);
}

export function FiltersPopover({ open, onClose, anchorRef }: FiltersPopoverProps): ReactNode {
  const [categoryQuery, setCategoryQuery] = useState('');

  const filters: SearchFilters = useExplorerStore((state) => state.filters);
  const setFilters = useExplorerStore((state) => state.setFilters);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const categories = useExplorerStore((state) => state.filterCatalog.categories);

  const normalizedCategoryQuery = categoryQuery.trim().toLowerCase();
  const filteredCategories = useMemo(
    () => categories.filter((option) => matchesOption(option, normalizedCategoryQuery)),
    [categories, normalizedCategoryQuery],
  );

  function handleReset(): void {
    resetFilters();
    setCategoryQuery('');
  }

  function renderChip(
    option: FilterOption,
    selected: boolean,
    onToggle: () => void,
    dotColor?: string,
  ): ReactNode {
    return (
      <button
        key={`${option.value}-${option.label}`}
        type="button"
        className={cx(styles.chip, selected && styles.chipOn)}
        aria-pressed={selected}
        onClick={onToggle}
      >
        {dotColor !== undefined && (
          <span
            className={styles.elementDot}
            style={{ background: dotColor }}
            aria-hidden="true"
          />
        )}
        <span>{option.label}</span>
      </button>
    );
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="end"
      label="Search filters"
      width="20rem"
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <h2 className={styles.title}>Filters</h2>
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            Reset filters
          </button>
        </div>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Tier</h3>
          <div className={styles.chips}>
            {TIER_FILTER_OPTIONS.map((option) =>
              renderChip(
                option,
                filters.tierTypes.includes(option.value),
                () => setFilters({ tierTypes: toggleValue(filters.tierTypes, option.value) }),
              ),
            )}
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Damage</h3>
          <div className={styles.chips}>
            {DAMAGE_FILTER_OPTIONS.map((option) =>
              renderChip(
                option,
                filters.damageTypes.includes(option.value),
                () => setFilters({ damageTypes: toggleValue(filters.damageTypes, option.value) }),
                DAMAGE_DOT[option.value] ?? 'var(--text3)',
              ),
            )}
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Class</h3>
          <div className={styles.chips}>
            {CLASS_FILTER_OPTIONS.map((option) =>
              renderChip(
                option,
                filters.classTypes.includes(option.value),
                () => setFilters({ classTypes: toggleValue(filters.classTypes, option.value) }),
              ),
            )}
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Item type</h3>
          <div className={styles.chips}>
            {ITEM_TYPE_FILTER_OPTIONS.map((option) =>
              renderChip(
                option,
                filters.itemTypes.includes(option.value),
                () => setFilters({ itemTypes: toggleValue(filters.itemTypes, option.value) }),
              ),
            )}
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Item category</h3>
          <div className={styles.searchWrap}>
            <SearchIcon size={12} className={styles.searchIcon} />
            <input
              type="search"
              className={styles.categorySearch}
              value={categoryQuery}
              onChange={(event) => setCategoryQuery(event.target.value)}
              placeholder="Find a category…"
              aria-label="Find an item category"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {filteredCategories.length > 0 ? (
            <div className={styles.categoryList}>
              {filteredCategories.map((option) => {
                const selected = filters.itemCategoryHashes.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cx(styles.categoryRow, selected && styles.categoryRowOn)}
                    aria-pressed={selected}
                    onClick={() =>
                      setFilters({
                        itemCategoryHashes: toggleValue(
                          filters.itemCategoryHashes,
                          option.value,
                        ),
                      })
                    }
                  >
                    <span className={styles.categoryCheck} aria-hidden="true">
                      {selected && <CheckIcon size={11} />}
                    </span>
                    <span className={styles.categoryName}>{option.label}</span>
                    {option.count !== undefined && (
                      <span className={styles.categoryCount}>
                        {NUMBER_FORMAT.format(option.count)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={styles.emptyCategories}>No categories match that search.</p>
          )}
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Options</h3>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={filters.includeUnnamed}
              onChange={(event) => setFilters({ includeUnnamed: event.target.checked })}
            />
            <span>Include unnamed definitions</span>
          </label>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={filters.onlyRedacted}
              onChange={(event) => setFilters({ onlyRedacted: event.target.checked })}
            />
            <span>Only redacted definitions</span>
          </label>
        </section>

        <div className={styles.hint}>
          <code>tier:exotic damage:solar -engram</code>
        </div>
      </div>
    </Popover>
  );
}
