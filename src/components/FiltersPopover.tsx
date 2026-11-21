/// <reference types="vite/client" />
import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { FilterOption } from '../types/manifest';
import { useExplorerStore } from '../stores/explorer';
import { CheckIcon, ChevronRightIcon, SearchIcon } from '../ui/Icons';
import { Popover } from '../ui/Popover';
import {
  clearQueryFilterTokens,
  hasQueryToken,
  toggleQueryToken,
} from '../utils/queryTokens';
import styles from './FiltersPopover.module.scss';

export interface FiltersPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Panel alignment for the active anchor (search cluster vs mobile toolbar). */
  align?: 'start' | 'end';
}

interface TokenOption {
  /** Exact query token this chip toggles, e.g. `is:enhanced` or `source:"exotic mission"`. */
  token: string;
  label: string;
  /** Element-dot colour for damage chips. */
  dot?: string;
}

const HIGHLIGHT_OPTIONS: readonly TokenOption[] = [
  { token: 'is:enhanced', label: 'Enhanced' },
  { token: 'is:artifact', label: 'Active artifact' },
  { token: 'is:adept', label: 'Adept' },
  { token: 'is:craftable', label: 'Craftable' },
  { token: 'is:holofoil', label: 'Holofoil' },
  { token: 'is:featured', label: 'Featured' },
  { token: 'is:catalyst', label: 'Catalyst' },
  { token: 'is:ornament', label: 'Ornament' },
  { token: 'has:lore', label: 'Has lore' },
  { token: 'has:watermark', label: 'Has watermark' },
  { token: 'is:redacted', label: 'Redacted' },
];

const TIER_OPTIONS: readonly TokenOption[] = [
  { token: 'tier:exotic', label: 'Exotic' },
  { token: 'tier:legendary', label: 'Legendary' },
  { token: 'tier:rare', label: 'Rare' },
  { token: 'tier:uncommon', label: 'Uncommon' },
  { token: 'tier:common', label: 'Common' },
];

const DAMAGE_OPTIONS: readonly TokenOption[] = [
  { token: 'damage:kinetic', label: 'Kinetic', dot: 'var(--el-kinetic)' },
  { token: 'damage:arc', label: 'Arc', dot: 'var(--el-arc)' },
  { token: 'damage:solar', label: 'Solar', dot: 'var(--el-solar)' },
  { token: 'damage:void', label: 'Void', dot: 'var(--el-void)' },
  { token: 'damage:stasis', label: 'Stasis', dot: 'var(--el-stasis)' },
  { token: 'damage:strand', label: 'Strand', dot: 'var(--el-strand)' },
];

const AMMO_OPTIONS: readonly TokenOption[] = [
  { token: 'ammo:primary', label: 'Primary' },
  { token: 'ammo:special', label: 'Special' },
  { token: 'ammo:heavy', label: 'Heavy' },
];

const SLOT_OPTIONS: readonly TokenOption[] = [
  { token: 'slot:kinetic', label: 'Kinetic' },
  { token: 'slot:energy', label: 'Energy' },
  { token: 'slot:power', label: 'Power' },
  { token: 'slot:helmet', label: 'Helmet' },
  { token: 'slot:gauntlets', label: 'Gauntlets' },
  { token: 'slot:chest', label: 'Chest' },
  { token: 'slot:legs', label: 'Legs' },
  { token: 'slot:classitem', label: 'Class Item' },
];

const CLASS_OPTIONS: readonly TokenOption[] = [
  { token: 'class:titan', label: 'Titan' },
  { token: 'class:hunter', label: 'Hunter' },
  { token: 'class:warlock', label: 'Warlock' },
];

const TYPE_OPTIONS: readonly TokenOption[] = [
  { token: 'type:weapon', label: 'Weapon' },
  { token: 'type:armor', label: 'Armor' },
  { token: 'type:mod', label: 'Mod' },
  { token: 'type:shader', label: 'Shader' },
  { token: 'type:emblem', label: 'Emblem' },
  { token: 'type:quest', label: 'Quest' },
  { token: 'type:subclass', label: 'Subclass' },
  { token: 'type:ghost', label: 'Ghost' },
  { token: 'type:ship', label: 'Ship' },
  { token: 'type:sparrow', label: 'Sparrow' },
  { token: 'type:consumable', label: 'Consumable' },
  { token: 'type:engram', label: 'Engram' },
  { token: 'type:bounty', label: 'Bounty' },
  { token: 'type:emote', label: 'Emote' },
  { token: 'type:finisher', label: 'Finisher' },
  { token: 'type:pattern', label: 'Pattern' },
];

const SUBTYPE_OPTIONS: readonly TokenOption[] = [
  { token: 'subtype:autorifle', label: 'Auto' },
  { token: 'subtype:handcannon', label: 'Hand Cannon' },
  { token: 'subtype:pulserifle', label: 'Pulse' },
  { token: 'subtype:scout', label: 'Scout' },
  { token: 'subtype:smg', label: 'SMG' },
  { token: 'subtype:sidearm', label: 'Sidearm' },
  { token: 'subtype:bow', label: 'Bow' },
  { token: 'subtype:shotgun', label: 'Shotgun' },
  { token: 'subtype:sniper', label: 'Sniper' },
  { token: 'subtype:fusion', label: 'Fusion' },
  { token: 'subtype:glaive', label: 'Glaive' },
  { token: 'subtype:trace', label: 'Trace' },
  { token: 'subtype:grenadelauncher', label: 'Grenade' },
  { token: 'subtype:rocket', label: 'Rocket' },
  { token: 'subtype:sword', label: 'Sword' },
  { token: 'subtype:lfr', label: 'Linear' },
  { token: 'subtype:machinegun', label: 'Machine Gun' },
];

const SOURCE_OPTIONS: readonly TokenOption[] = [
  { token: 'source:raid', label: 'Raid' },
  { token: 'source:dungeon', label: 'Dungeon' },
  { token: 'source:trials', label: 'Trials' },
  { token: 'source:crucible', label: 'Crucible' },
  { token: 'source:vanguard', label: 'Vanguard' },
  { token: 'source:gambit', label: 'Gambit' },
  { token: 'source:eververse', label: 'Eververse' },
  { token: 'source:"exotic mission"', label: 'Exotic Mission' },
];

const LATEST_SEASON_OPTION: TokenOption = { token: 'season:latest', label: 'Latest season' };

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/** Builds the exact `cat:` token for a category label, quoting values with whitespace. */
function categoryToken(label: string): string {
  return /\s/.test(label) ? `cat:"${label}"` : `cat:${label}`;
}

export function FiltersPopover({
  open,
  onClose,
  anchorRef,
  align = 'start',
}: FiltersPopoverProps): ReactNode {
  const [categoryQuery, setCategoryQuery] = useState('');

  const query = useExplorerStore((state) => state.query);
  const setQuery = useExplorerStore((state) => state.setQuery);
  const setFilters = useExplorerStore((state) => state.setFilters);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const filterCatalog = useExplorerStore((state) => state.filterCatalog);
  const includeUnnamed = useExplorerStore((state) => state.filters.includeUnnamed);

  // `FilterCatalog.seasons` lands from a parallel change; read it defensively
  // so this file compiles cleanly no matter which side merges first.
  const seasons: readonly FilterOption[] =
    (filterCatalog as { seasons?: FilterOption[] }).seasons ?? [];
  const categories = filterCatalog.categories;

  const normalizedCategoryQuery = categoryQuery.trim().toLowerCase();
  const filteredCategories = useMemo(
    () =>
      categories.filter((option) =>
        normalizedCategoryQuery.length === 0
          ? true
          : option.label.toLowerCase().includes(normalizedCategoryQuery),
      ),
    [categories, normalizedCategoryQuery],
  );

  function toggleToken(token: string): void {
    setQuery(toggleQueryToken(query, token));
  }

  function handleReset(): void {
    setQuery(clearQueryFilterTokens(query));
    resetFilters();
    setCategoryQuery('');
  }

  function renderTokenChip(option: TokenOption): ReactNode {
    const selected = hasQueryToken(query, option.token);
    return (
      <button
        key={option.token}
        type="button"
        className={cx(styles.chip, selected && styles.chipOn)}
        aria-pressed={selected}
        title={option.token}
        onClick={() => toggleToken(option.token)}
      >
        {option.dot !== undefined && (
          <span
            className={styles.elementDot}
            style={{ background: option.dot }}
            aria-hidden="true"
          />
        )}
        <span>{option.label}</span>
      </button>
    );
  }

  function renderChipGroup(title: string, options: readonly TokenOption[]): ReactNode {
    return (
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{title}</h3>
        <div className={styles.chips}>{options.map(renderTokenChip)}</div>
      </section>
    );
  }

  function renderCollapsible(
    summary: string,
    options: readonly TokenOption[],
  ): ReactNode {
    return (
      <details className={styles.collapsible}>
        <summary className={styles.collapsibleSummary}>
          <ChevronRightIcon size={11} className={styles.summaryChevron} />
          {summary}
        </summary>
        <div className={styles.collapsibleBody}>
          <div className={styles.chips}>{options.map(renderTokenChip)}</div>
        </div>
      </details>
    );
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align={align}
      label="Search filters"
      width="24rem"
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <h2 className={styles.title}>Filters</h2>
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            Reset filters
          </button>
        </div>
        <p className={styles.lede}>
          Every chip writes its exact syntax into the search bar — edit, combine, and share
          from there.
        </p>

        {renderChipGroup('Highlights & flags', HIGHLIGHT_OPTIONS)}
        {renderChipGroup('Tier', TIER_OPTIONS)}
        {renderChipGroup('Damage', DAMAGE_OPTIONS)}

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Ammo &amp; slot</h3>
          <div className={styles.chips}>{AMMO_OPTIONS.map(renderTokenChip)}</div>
          <div className={styles.chips}>{SLOT_OPTIONS.map(renderTokenChip)}</div>
        </section>

        {renderChipGroup('Class', CLASS_OPTIONS)}
        {renderChipGroup('Item type', TYPE_OPTIONS)}

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Weapon</h3>
          {renderCollapsible('Weapon subtype', SUBTYPE_OPTIONS)}
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Season / expansion</h3>
          <div className={styles.chips}>{renderTokenChip(LATEST_SEASON_OPTION)}</div>
          {seasons.length > 0 &&
            renderCollapsible(
              'All seasons',
              seasons.map((option) => ({
                token: `season:${option.value}`,
                label: option.label,
              })),
            )}
        </section>

        {renderChipGroup('Source', SOURCE_OPTIONS)}

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
                const token = categoryToken(option.label);
                const selected = hasQueryToken(query, token);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cx(styles.categoryRow, selected && styles.categoryRowOn)}
                    aria-pressed={selected}
                    title={token}
                    onClick={() => toggleToken(token)}
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
              checked={includeUnnamed}
              onChange={(event) => setFilters({ includeUnnamed: event.target.checked })}
            />
            <span>Include unnamed definitions</span>
          </label>
        </section>

        <div className={styles.hint}>
          <code>tier:exotic damage:solar is:enhanced cat:"Hand Cannon"</code>
        </div>
      </div>
    </Popover>
  );
}
