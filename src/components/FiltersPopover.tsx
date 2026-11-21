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
  /** Item matches for this option; shown subtly inside the chip when > 0. */
  count?: number;
}

/**
 * Curated from a live-manifest audit (Lite + Full boots): every chip here
 * matches real items. Dropped tokens matched nothing or were noise —
 * `is:holofoil`/`is:redacted` (stripped from Lite), `is:featured` (no matches
 * anywhere), `has:watermark` (half the manifest) — and `is:artifact` is
 * superseded by the dedicated Artifact Perks table in the Tables rail.
 */
const HIGHLIGHT_OPTIONS: readonly TokenOption[] = [
  { token: 'is:enhanced', label: 'Enhanced' },
  { token: 'is:adept', label: 'Adept' },
  { token: 'is:craftable', label: 'Craftable' },
  { token: 'is:catalyst', label: 'Catalyst' },
  { token: 'is:ornament', label: 'Ornament' },
  { token: 'has:lore', label: 'Has lore' },
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
  { token: 'source:ironbanner', label: 'Iron Banner' },
  { token: 'source:nightfall', label: 'Nightfall' },
  { token: 'source:strikes', label: 'Strikes' },
  { token: 'source:crucible', label: 'Crucible' },
  { token: 'source:gambit', label: 'Gambit' },
  { token: 'source:eververse', label: 'Eververse' },
  { token: 'source:seasonpass', label: 'Season Pass' },
  { token: 'source:events', label: 'Events' },
  { token: 'source:exoticquest', label: 'Exotic Mission' },
  { token: 'source:lostsectors', label: 'Lost Sectors' },
  { token: 'source:legendaryengram', label: 'World Drops' },
];

const LATEST_SEASON_OPTION: TokenOption = { token: 'season:latest', label: 'Latest season' };

interface SourceFilterOption {
  key: string;
  label: string;
  count: number;
  aliases?: string[];
}

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
  const [sourceQuery, setSourceQuery] = useState('');
  const [collapsibleOpen, setCollapsibleOpen] = useState<Record<string, boolean>>({});

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
  const sources: readonly SourceFilterOption[] =
    (filterCatalog as { sources?: SourceFilterOption[] }).sources ?? [];
  const categories = filterCatalog.categories;

  const normalizedCategoryQuery = categoryQuery.trim().toLowerCase();
  const normalizedSourceQuery = sourceQuery.trim().toLowerCase();
  const filteredCategories = useMemo(
    () =>
      categories.filter((option) =>
        normalizedCategoryQuery.length === 0
          ? true
          : option.label.toLowerCase().includes(normalizedCategoryQuery),
      ),
    [categories, normalizedCategoryQuery],
  );
  const filteredSources = useMemo(
    () =>
      sources.filter((source) => {
        if (normalizedSourceQuery.length === 0) {
          return true;
        }
        return [source.label, source.key, ...(source.aliases ?? [])].some((value) =>
          value.toLowerCase().includes(normalizedSourceQuery),
        );
      }),
    [sources, normalizedSourceQuery],
  );

  // Skip seasons with no indexed items so empty rows never clutter the list.
  // Seasons without a computed count are kept (treated as non-empty).
  const visibleSeasons = seasons.filter((option) => (option.count ?? 1) > 0);

  function toggleToken(token: string): void {
    setQuery(toggleQueryToken(query, token));
  }

  function handleReset(): void {
    setQuery(clearQueryFilterTokens(query));
    resetFilters();
    setCategoryQuery('');
    setSourceQuery('');
  }

  function renderTokenChip(option: TokenOption, onToggle?: () => void): ReactNode {
    const selected = hasQueryToken(query, option.token);
    return (
      <button
        key={option.token}
        type="button"
        className={cx(styles.chip, selected && styles.chipOn)}
        aria-pressed={selected}
        title={option.token}
        onClick={() => {
          toggleToken(option.token);
          onToggle?.();
        }}
      >
        {option.dot !== undefined && (
          <span
            className={styles.elementDot}
            style={{ background: option.dot }}
            aria-hidden="true"
          />
        )}
        <span>{option.label}</span>
        {option.count !== undefined && option.count > 0 && (
          <span className={styles.chipCount}>{NUMBER_FORMAT.format(option.count)}</span>
        )}
      </button>
    );
  }

  function renderChipGroup(title: string, options: readonly TokenOption[]): ReactNode {
    return (
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{title}</h3>
        <div className={styles.chips}>{options.map((option) => renderTokenChip(option))}</div>
      </section>
    );
  }

  function renderCollapsible(
    summary: string,
    options: readonly TokenOption[],
  ): ReactNode {
    const hasSelected = options.some((option) => hasQueryToken(query, option.token));
    const isOpen = hasSelected || collapsibleOpen[summary] === true;

    return (
      <details className={styles.collapsible} open={isOpen}>
        <summary
          className={styles.collapsibleSummary}
          onClick={(event) => {
            event.preventDefault();
            if (!hasSelected) {
              setCollapsibleOpen((current) => ({ ...current, [summary]: !isOpen }));
            }
          }}
        >
          <ChevronRightIcon size={11} className={styles.summaryChevron} />
          {summary}
        </summary>
        <div className={styles.collapsibleBody}>
          <div className={styles.chips}>
            {options.map((option) =>
              renderTokenChip(option, () =>
                setCollapsibleOpen((current) => ({ ...current, [summary]: true })),
              ),
            )}
          </div>
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
      width="min(46rem, calc(100vw - 1.5rem))"
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

        <div className={styles.columns}>
          <div className={styles.col}>
            {renderChipGroup('Highlights & flags', HIGHLIGHT_OPTIONS)}
            {renderChipGroup('Tier', TIER_OPTIONS)}
            {renderChipGroup('Damage', DAMAGE_OPTIONS)}

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>Ammo &amp; slot</h3>
              <div className={styles.chips}>
                {AMMO_OPTIONS.map((option) => renderTokenChip(option))}
              </div>
              <div className={styles.chips}>
                {SLOT_OPTIONS.map((option) => renderTokenChip(option))}
              </div>
            </section>

            {renderChipGroup('Class', CLASS_OPTIONS)}
            {renderChipGroup('Item type', TYPE_OPTIONS)}

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>Weapon</h3>
              {renderCollapsible('Weapon subtype', SUBTYPE_OPTIONS)}
            </section>
          </div>

          <div className={styles.col}>
            <section className={styles.group}>
              <h3 className={styles.groupTitle}>Season / expansion</h3>
              <div className={styles.chips}>{renderTokenChip(LATEST_SEASON_OPTION)}</div>
              {visibleSeasons.length > 0 &&
                renderCollapsible(
                  'All seasons',
                  visibleSeasons.map((option) => ({
                    token: `season:${option.value}`,
                    label: option.label,
                    count: option.count,
                  })),
                )}
            </section>

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>Source</h3>
              <div className={styles.chips}>
                {SOURCE_OPTIONS.map((option) => renderTokenChip(option))}
              </div>
              <div className={styles.searchWrap}>
                <SearchIcon size={12} className={styles.searchIcon} />
                <input
                  type="search"
                  className={styles.optionSearch}
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.target.value)}
                  placeholder="Find a raid, dungeon, destination, vendor…"
                  aria-label="Find a source"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {filteredSources.length > 0 ? (
                <div className={styles.optionList}>
                  {filteredSources.map((source) => {
                    const token = `source:${source.key}`;
                    const selected = hasQueryToken(query, token);
                    return (
                      <button
                        key={source.key}
                        type="button"
                        className={cx(styles.optionRow, selected && styles.categoryRowOn)}
                        aria-pressed={selected}
                        title={token}
                        onClick={() => toggleToken(token)}
                      >
                        <span className={styles.optionCheck} aria-hidden="true">
                          {selected && <CheckIcon size={11} />}
                        </span>
                        <span className={styles.optionName}>{source.label}</span>
                        <span className={styles.optionCount}>
                          {NUMBER_FORMAT.format(source.count)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyOptions}>No sources match that search.</p>
              )}
            </section>

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>Item category</h3>
              <div className={styles.searchWrap}>
                <SearchIcon size={12} className={styles.searchIcon} />
                <input
                  type="search"
                  className={styles.optionSearch}
                  value={categoryQuery}
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="Find a category…"
                  aria-label="Find an item category"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {filteredCategories.length > 0 ? (
                <div className={styles.optionList}>
                  {filteredCategories.map((option) => {
                    const token = categoryToken(option.label);
                    const selected = hasQueryToken(query, token);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={cx(styles.optionRow, selected && styles.categoryRowOn)}
                        aria-pressed={selected}
                        title={token}
                        onClick={() => toggleToken(token)}
                      >
                        <span className={styles.optionCheck} aria-hidden="true">
                          {selected && <CheckIcon size={11} />}
                        </span>
                        <span className={styles.optionName}>{option.label}</span>
                        {option.count !== undefined && (
                          <span className={styles.optionCount}>
                            {NUMBER_FORMAT.format(option.count)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyOptions}>No categories match that search.</p>
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
          </div>
        </div>

        <div className={styles.hint}>
          <code>tier:exotic damage:solar is:enhanced season:latest cat:"Hand Cannon"</code>
        </div>
      </div>
    </Popover>
  );
}
