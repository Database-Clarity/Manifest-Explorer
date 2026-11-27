/// <reference types="vite/client" />
import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { FilterOption, TableStatus } from '../types/manifest';
import { getFriendlyTableName, getShortTableName } from '../manifest/tables';
import { hasPositiveTableScopeInQuery, isUnnamedIncluded } from '../manifest/query';
import { useExplorerStore } from '../stores/explorer';
import {
  FUZZINESS_MAX,
  FUZZINESS_MIN,
  FUZZINESS_STEP,
  fuzzinessLevel,
  useSettingsStore,
} from '../stores/settings';
import { CheckIcon, ChevronRightIcon, SearchIcon } from '../ui/Icons';
import { ClearSearchInput } from '../ui/ClearSearchInput';
import { Popover } from '../ui/Popover';
import {
  clearQueryFilterTokens,
  countQueryFilterTokens,
  hasQueryToken,
  toggleQueryToken,
  toggleQueryTokenInGroup,
  type FilterGroupId,
} from '../utils/queryTokens';
import styles from './FiltersPopover.module.scss';

export interface FiltersPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  onSelectTable?: (table: string) => void;
  onLoadAllTables?: () => void;
  /** Panel alignment for the active anchor. */
  align?: 'start' | 'end';
}

interface TokenOption {
  /** Exact query token this chip toggles, e.g. `is:enhanced` or `source:"exotic mission"`. */
  token: string;
  label: string;
  /** Element-dot colour for element chips. */
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
 * `is:artifactperk` stays: the table scopes the view, while this chip matches
 * perk records directly and ORs with `season:`/other flags in the search bar.
 */
const HIGHLIGHT_OPTIONS: readonly TokenOption[] = [
  { token: 'is:enhanced', label: 'Enhanced' },
  { token: 'is:artifactperk', label: 'Artifact Perk' },
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

const ELEMENT_OPTIONS: readonly TokenOption[] = [
  { token: 'element:kinetic', label: 'Kinetic', dot: 'var(--el-kinetic)' },
  { token: 'element:arc', label: 'Arc', dot: 'var(--el-arc)' },
  { token: 'element:solar', label: 'Solar', dot: 'var(--el-solar)' },
  { token: 'element:void', label: 'Void', dot: 'var(--el-void)' },
  { token: 'element:stasis', label: 'Stasis', dot: 'var(--el-stasis)' },
  { token: 'element:strand', label: 'Strand', dot: 'var(--el-strand)' },
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

interface TablePickerOption {
  key: string;
  table?: TableStatus;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const TABLE_GROUP_ORDER: ReadonlyArray<TableStatus['group']> = [
  'primary',
  'gameplay',
  'world',
  'progression',
  'system',
];
const UNFOLDABLE_TABLES: ReadonlySet<string> = new Set(['ArtifactPerks']);

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/** Builds the exact `cat:` token for a category label, quoting values with whitespace. */
function categoryToken(label: string): string {
  return /\s/.test(label) ? `cat:"${label}"` : `cat:${label}`;
}

/** Mirrors the table picker dedupe so Lite/full siblings never appear twice. */
function dedupeTables(tables: TableStatus[]): TableStatus[] {
  const byShortName = new Map<string, TableStatus>();

  for (const table of tables) {
    const key = getShortTableName(table.name);

    if (UNFOLDABLE_TABLES.has(table.name)) {
      byShortName.set(key, table);
      continue;
    }

    const existing = byShortName.get(key);
    if (!existing) {
      byShortName.set(key, table);
      continue;
    }

    const existingRank = existing.loaded ? 2 : existing.loading ? 1 : 0;
    const tableRank = table.loaded ? 2 : table.loading ? 1 : 0;
    if (
      tableRank > existingRank ||
      (tableRank === existingRank && !table.name.endsWith('LiteDefinition'))
    ) {
      byShortName.set(key, table);
    }
  }

  return [...byShortName.values()];
}

/** Mirrors the table picker matching for canonical, short, and friendly names. */
function matchesTableFilter(table: TableStatus, filter: string): boolean {
  if (filter.length === 0) return true;
  const compactFilter = filter.replace(/\s+/g, '');
  const names = [table.name, table.shortName, getFriendlyTableName(table.name)];
  return names.some((name) => {
    const normalized = name.toLowerCase();
    return normalized.includes(filter) || normalized.replace(/\s+/g, '').includes(compactFilter);
  });
}

function pinnedFirst<T>(
  items: readonly T[],
  pinnedKeys: ReadonlySet<string>,
  getKey: (item: T) => string,
): T[] {
  const pinned: T[] = [];
  const remaining: T[] = [];
  for (const item of items) {
    (pinnedKeys.has(getKey(item)) ? pinned : remaining).push(item);
  }
  return [...pinned, ...remaining];
}

/**
 * Zero-cost shell: while the popover is closed nothing below mounts, so no
 * store subscription, catalog filter, or chip scan runs on search keystrokes.
 * `Popover` runs its focus-restore cleanup on unmount (see its `open`-gated
 * effect), so Escape, outside-click, and anchor-toggle closing all still
 * return focus to the anchor button exactly as before.
 */
export function FiltersPopover(props: FiltersPopoverProps): ReactNode {
  if (!props.open) {
    return null;
  }
  return <FiltersPopoverBody {...props} />;
}

function FiltersPopoverBody({
  open,
  onClose,
  anchorRef,
  onSelectTable,
  onLoadAllTables,
  align = 'start',
}: FiltersPopoverProps): ReactNode {
  const [categoryQuery, setCategoryQuery] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [tableDropdownOpen, setTableDropdownOpen] = useState(false);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(true);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(true);
  const [collapsibleOpen, setCollapsibleOpen] = useState<Record<string, boolean>>({});

  const query = useExplorerStore((state) => state.query);
  const setQuery = useExplorerStore((state) => state.setQuery);
  const setFilters = useExplorerStore((state) => state.setFilters);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const setTableFilter = useExplorerStore((state) => state.setTableFilter);
  const filters = useExplorerStore((state) => state.filters);
  const filterCatalog = useExplorerStore((state) => state.filterCatalog);
  const tables = useExplorerStore((state) => state.tables);
  const indexedEntryCount = useExplorerStore((state) => state.manifestStatus.indexedEntryCount);
  const deepSearch = useExplorerStore((state) => state.deepSearch);
  const toggleDeepSearch = useExplorerStore((state) => state.toggleDeepSearch);

  const fuzzySearch = useSettingsStore((state) => state.fuzzySearch);
  const fuzziness = useSettingsStore((state) => state.fuzziness);
  const groupBy = useSettingsStore((state) => state.groupBy);
  const setGroupBy = useSettingsStore((state) => state.setGroupBy);
  const setFuzzySearch = useSettingsStore((state) => state.setFuzzySearch);
  const setFuzziness = useSettingsStore((state) => state.setFuzziness);

  // `FilterCatalog.seasons` lands from a parallel change; read it defensively
  // so this file compiles cleanly no matter which side merges first.
  const seasons: readonly FilterOption[] =
    (filterCatalog as { seasons?: FilterOption[] }).seasons ?? [];
  const sources: readonly SourceFilterOption[] =
    (filterCatalog as { sources?: SourceFilterOption[] }).sources ?? [];
  const categories = filterCatalog.categories;
  const tableFilter = filters.table;
  const uniqueTables = useMemo(() => dedupeTables(tables), [tables]);
  const orderedTables = useMemo(
    () =>
      [...uniqueTables].sort(
        (a, b) => TABLE_GROUP_ORDER.indexOf(a.group) - TABLE_GROUP_ORDER.indexOf(b.group),
      ),
    [uniqueTables],
  );
  const querySelectedTable = uniqueTables.find((table) =>
    hasQueryToken(query, `table:${getShortTableName(table.name)}`),
  );
  const selectedTableKey =
    tableFilter === 'all'
      ? (querySelectedTable?.name ?? 'all')
      : (uniqueTables.find(
          (table) => getShortTableName(table.name) === getShortTableName(tableFilter),
        )?.name ?? tableFilter);
  const activeTableLabel =
    tableFilter === 'all'
      ? (querySelectedTable?.shortName ?? 'All tables')
      : (uniqueTables.find(
          (table) => getShortTableName(table.name) === getShortTableName(tableFilter),
        )?.shortName ?? getFriendlyTableName(tableFilter));
  const hasUnloadedTables = uniqueTables.some((table) => !table.loaded);

  // Snapshots are intentionally initialized once when this open-only body mounts.
  // They are refreshed only by opening a searchable details section or editing
  // its search field, never by changing a selected row.
  const [pinnedSources, setPinnedSources] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        sources
          .filter((source) => hasQueryToken(query, `source:${source.key}`))
          .map((source) => source.key),
      ),
  );
  const [pinnedCategories, setPinnedCategories] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        categories
          .filter((option) => hasQueryToken(query, categoryToken(option.label)))
          .map((option) => String(option.value)),
      ),
  );
  const [pinnedTables, setPinnedTables] = useState<ReadonlySet<string>>(
    () => new Set([selectedTableKey]),
  );

  const normalizedCategoryQuery = categoryQuery.trim().toLowerCase();
  const normalizedSourceQuery = sourceQuery.trim().toLowerCase();
  const normalizedTableQuery = tableQuery.trim().toLowerCase();
  const filteredCategories = useMemo(
    () => {
      const filtered = categories.filter((option) =>
        normalizedCategoryQuery.length === 0
          ? true
          : option.label.toLowerCase().includes(normalizedCategoryQuery),
      );
      return pinnedFirst(filtered, pinnedCategories, (option) => String(option.value));
    },
    [categories, normalizedCategoryQuery, pinnedCategories],
  );
  const filteredSources = useMemo(
    () => {
      const filtered = sources.filter((source) => {
        if (normalizedSourceQuery.length === 0) {
          return true;
        }
        return [source.label, source.key, ...(source.aliases ?? [])].some((value) =>
          value.toLowerCase().includes(normalizedSourceQuery),
        );
      });
      return pinnedFirst(filtered, pinnedSources, (source) => source.key);
    },
    [sources, normalizedSourceQuery, pinnedSources],
  );
  const filteredTableOptions = useMemo(() => {
    const options: TablePickerOption[] = [];
    if (normalizedTableQuery.length === 0 || 'all tables'.includes(normalizedTableQuery)) {
      options.push({ key: 'all' });
    }
    for (const table of orderedTables) {
      if (matchesTableFilter(table, normalizedTableQuery)) {
        options.push({ key: table.name, table });
      }
    }
    return pinnedFirst(options, pinnedTables, (option) => option.key);
  }, [orderedTables, normalizedTableQuery, pinnedTables]);

  // Skip seasons with no indexed items so empty rows never clutter the list.
  // Seasons without a computed count are kept (treated as non-empty).
  const visibleSeasons = seasons.filter((option) => (option.count ?? 1) > 0);

  const fuzzinessPercent = Math.round(fuzziness * 100);
  const fuzzinessTier = fuzzinessLevel(fuzziness);
  const tableScoped = tableFilter !== 'all' || hasPositiveTableScopeInQuery(query);
  const effectiveIncludeUnnamed = isUnnamedIncluded(filters, query);
  // Reset used to sit in the header even with nothing to clear. Only offer it
  // when a store filter, table scope, unnamed override, or query filter token
  // would actually change.
  const hasResettableFilters =
    tableFilter !== 'all' ||
    filters.tierTypes.length > 0 ||
    filters.damageTypes.length > 0 ||
    filters.classTypes.length > 0 ||
    filters.itemTypes.length > 0 ||
    filters.itemCategoryHashes.length > 0 ||
    filters.includeUnnamed ||
    filters.onlyRedacted ||
    filters.unnamedMode !== 'auto' ||
    countQueryFilterTokens(query) > 0;

  function refreshPinnedSources(): void {
    setPinnedSources(
      new Set(
        sources
          .filter((source) => hasQueryToken(query, `source:${source.key}`))
          .map((source) => source.key),
      ),
    );
  }

  function refreshPinnedCategories(): void {
    setPinnedCategories(
      new Set(
        categories
          .filter((option) => hasQueryToken(query, categoryToken(option.label)))
          .map((option) => String(option.value)),
      ),
    );
  }

  function refreshPinnedTables(): void {
    setPinnedTables(new Set([selectedTableKey]));
  }

  function handleSelectTable(table: string): void {
    if (onSelectTable) {
      onSelectTable(table);
    } else {
      setTableFilter(table);
    }
  }

  function toggleTableOption(table: TableStatus): void {
    const token = `table:${getShortTableName(table.name)}`;
    const querySelected = hasQueryToken(query, token);
    const stateSelected =
      tableFilter !== 'all' &&
      getShortTableName(table.name) === getShortTableName(tableFilter);

    if (querySelected) {
      setQuery(toggleQueryToken(query, token));
      if (stateSelected) handleSelectTable('all');
      return;
    }
    handleSelectTable(table.name);
  }

  function toggleToken(token: string, groupId: FilterGroupId): void {
    setQuery(toggleQueryTokenInGroup(query, token, groupId));
  }

  function handleReset(): void {
    setQuery(clearQueryFilterTokens(query));
    resetFilters();
    setCategoryQuery('');
    setSourceQuery('');
    setTableQuery('');
    setPinnedSources(new Set());
    setPinnedCategories(new Set());
    setPinnedTables(new Set(['all']));
  }

  function renderTokenChip(
    option: TokenOption,
    groupId: FilterGroupId,
    onToggle?: () => void,
  ): ReactNode {
    const selected = hasQueryToken(query, option.token);
    return (
      <button
        key={option.token}
        type="button"
        className={cx(styles.chip, selected && styles.chipOn)}
        aria-pressed={selected}
        title={option.token}
        onClick={() => {
          toggleToken(option.token, groupId);
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

  function renderChipGroup(
    title: string,
    options: readonly TokenOption[],
    groupId: FilterGroupId,
  ): ReactNode {
    return (
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{title}</h3>
        <div className={styles.chips}>
          {options.map((option) => renderTokenChip(option, groupId))}
        </div>
      </section>
    );
  }

  function renderCollapsible(
    summary: string,
    options: readonly TokenOption[],
    groupId: FilterGroupId,
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
              renderTokenChip(
                option,
                groupId,
                () => setCollapsibleOpen((current) => ({ ...current, [summary]: true })),
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
          <div className={styles.optionsInline} role="group" aria-label="Search options">
            <label
              className={styles.checkRow}
              title="Include definitions without a display name (shown automatically when viewing a specific table)"
            >
              <input
                type="checkbox"
                checked={effectiveIncludeUnnamed}
                onChange={(event) => {
                  const checked = event.target.checked;
                  if (checked) {
                    setFilters({
                      includeUnnamed: true,
                      unnamedMode: tableScoped ? 'auto' : 'always',
                    });
                  } else if (tableScoped) {
                    setFilters({ includeUnnamed: false, unnamedMode: 'never' });
                  } else {
                    setFilters({ includeUnnamed: false, unnamedMode: 'auto' });
                  }
                }}
                aria-label="Include unnamed definitions"
              />
              <span>Unnamed</span>
            </label>
            <label className={styles.checkRow} title="Fuzzy search (match typos)">
              <input
                type="checkbox"
                checked={fuzzySearch}
                onChange={(event) => setFuzzySearch(event.target.checked)}
                aria-label="Fuzzy search (match typos)"
              />
              <span>Fuzzy</span>
            </label>
            <label
              className={styles.checkRow}
              title="Scan raw JSON keys and values across definitions"
            >
              <input
                type="checkbox"
                checked={deepSearch}
                onChange={toggleDeepSearch}
                aria-label="Deep Search"
              />
              <span>Deep Search</span>
            </label>
            <label
              className={styles.checkRow}
              title={
                tableScoped
                  ? 'Group by table is available only when searching all tables.'
                  : deepSearch
                    ? 'Grouping is unavailable in Deep Search.'
                    : 'Group results into manifest table sections'
              }
            >
              <input
                type="checkbox"
                checked={groupBy === 'table'}
                disabled={tableScoped || deepSearch}
                onChange={(event) => setGroupBy(event.target.checked ? 'table' : 'none')}
                aria-label="Group by table"
              />
              <span>Group by table</span>
            </label>
            {fuzzySearch && (
              <div className={styles.fuzzinessInline}>
                <input
                  type="range"
                  className={styles.range}
                  min={FUZZINESS_MIN}
                  max={FUZZINESS_MAX}
                  step={FUZZINESS_STEP}
                  value={fuzziness}
                  onChange={(event) => setFuzziness(Number(event.target.value))}
                  aria-label="Fuzziness"
                  aria-valuetext={`${fuzzinessPercent}% · ${fuzzinessTier}`}
                  title="Fuzziness"
                />
                <output
                  className={styles.fuzzinessReadout}
                  title={`Fuzziness: ${fuzzinessPercent}% · ${fuzzinessTier}`}
                  aria-label="Fuzziness"
                  aria-live="off"
                >
                  {fuzzinessPercent}%
                </output>
              </div>
            )}
          </div>
          {hasResettableFilters ? (
            <button type="button" className={styles.resetBtn} onClick={handleReset}>
              Reset filters
            </button>
          ) : null}
        </div>

        <section className={cx(styles.group, styles.tableGroup)}>
          <details
            className={styles.searchableOptions}
            open={tableDropdownOpen}
            onToggle={(event) => {
              const nextOpen = event.currentTarget.open;
              setTableDropdownOpen(nextOpen);
              if (nextOpen) refreshPinnedTables();
            }}
          >
            <summary className={styles.searchableSummary}>
              <span className={styles.groupTitle}>Table</span>
              <span className={styles.tableSelection}>· {activeTableLabel}</span>
              <ChevronRightIcon size={11} className={styles.summaryChevron} />
            </summary>
            <div className={styles.searchableBody}>
              <p className={styles.tableDescription}>
                Bungie’s manifest splits game data into separate definition tables (items, perks,
                stats, activities, etc.).
              </p>
              <div className={styles.searchWrap}>
                <SearchIcon size={12} className={styles.searchIcon} />
                <ClearSearchInput
                  className={styles.optionSearch}
                  wrapperClassName={styles.searchField}
                  value={tableQuery}
                  onValueChange={(value) => {
                    setTableQuery(value);
                    refreshPinnedTables();
                  }}
                  placeholder="Filter tables…"
                  aria-label="Filter tables"
                  clearLabel="Clear table filter"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className={styles.optionList}>
                {filteredTableOptions.map((option) => {
                  if (option.key === 'all') {
                    const selected = tableFilter === 'all' && querySelectedTable === undefined;
                    return (
                      <button
                        key="all"
                        type="button"
                        className={cx(styles.optionRow, selected && styles.categoryRowOn)}
                        onClick={() => handleSelectTable('all')}
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span className={styles.optionCheck} aria-hidden="true">
                          {selected && <CheckIcon size={11} />}
                        </span>
                        <span className={styles.optionName}>All tables</span>
                        <span className={styles.optionCount}>
                          {NUMBER_FORMAT.format(indexedEntryCount)}
                        </span>
                      </button>
                    );
                  }

                  const table = option.table;
                  if (!table) return null;
                  const selected =
                    hasQueryToken(query, `table:${getShortTableName(table.name)}`) ||
                    (tableFilter !== 'all' &&
                      getShortTableName(table.name) === getShortTableName(tableFilter));
                  return (
                    <button
                      key={table.name}
                      type="button"
                      className={cx(styles.optionRow, selected && styles.categoryRowOn)}
                      onClick={() => toggleTableOption(table)}
                      aria-current={selected ? 'true' : undefined}
                      title={table.name}
                    >
                      <span className={styles.optionCheck} aria-hidden="true">
                        {selected && <CheckIcon size={11} />}
                      </span>
                      <span className={styles.optionName}>{table.shortName}</span>
                      <span className={styles.optionCount}>
                        {table.loaded
                          ? NUMBER_FORMAT.format(table.count)
                          : table.loading
                            ? 'Loading'
                            : 'Load'}
                      </span>
                    </button>
                  );
                })}
                {filteredTableOptions.length === 0 && (
                  <p className={styles.emptyOptions}>
                    No tables match “{tableQuery.trim()}”.
                  </p>
                )}
              </div>
              {hasUnloadedTables && onLoadAllTables && (
                <div className={styles.tableFooter}>
                  <button
                    type="button"
                    className={styles.tableFooterBtn}
                    onClick={onLoadAllTables}
                  >
                    Load all tables
                  </button>
                </div>
              )}
            </div>
          </details>
        </section>

        <div className={styles.columns}>
          <div className={styles.col}>
            {renderChipGroup('Highlights & flags', HIGHLIGHT_OPTIONS, 'highlights')}
            {renderChipGroup('Tier', TIER_OPTIONS, 'tier')}
            {renderChipGroup('Element', ELEMENT_OPTIONS, 'damage')}

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>Ammo &amp; slot</h3>
              <div className={styles.chips}>
                {AMMO_OPTIONS.map((option) => renderTokenChip(option, 'ammo'))}
              </div>
              <div className={styles.chips}>
                {SLOT_OPTIONS.map((option) => renderTokenChip(option, 'slot'))}
              </div>
            </section>

            {renderChipGroup('Class', CLASS_OPTIONS, 'class')}
            {renderChipGroup('Item type', TYPE_OPTIONS, 'type')}

            <section className={styles.group}>
              {renderCollapsible('Weapon subtype', SUBTYPE_OPTIONS, 'subtype')}
            </section>
          </div>

          <div className={styles.col}>
            <section className={styles.group}>
              {renderCollapsible(
                'Season / expansion',
                [
                  LATEST_SEASON_OPTION,
                  ...visibleSeasons.map((option) => ({
                    token: `season:${option.value}`,
                    label: option.label,
                    count: option.count,
                  })),
                ],
                'season',
              )}
            </section>

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>Source</h3>
              <div className={styles.chips}>
                {SOURCE_OPTIONS.map((option) => renderTokenChip(option, 'source'))}
              </div>
              <details
                className={styles.searchableOptions}
                open={sourceDropdownOpen}
                onToggle={(event) => {
                  const nextOpen = event.currentTarget.open;
                  setSourceDropdownOpen(nextOpen);
                  if (nextOpen) refreshPinnedSources();
                }}
              >
                <summary className={styles.searchableSummary}>
                  <span className={styles.groupTitle}>Browse sources</span>
                  <ChevronRightIcon size={11} className={styles.summaryChevron} />
                </summary>
                <div className={styles.searchableBody}>
                  <div className={styles.searchWrap}>
                    <SearchIcon size={12} className={styles.searchIcon} />
                    <ClearSearchInput
                      className={styles.optionSearch}
                      wrapperClassName={styles.searchField}
                      value={sourceQuery}
                      onValueChange={(value) => {
                        setSourceQuery(value);
                        refreshPinnedSources();
                      }}
                      placeholder="Find a raid, dungeon, destination, vendor…"
                      aria-label="Find a source"
                      clearLabel="Clear source search"
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
                            onClick={() => toggleToken(token, 'source')}
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
                </div>
              </details>
            </section>

            <section className={styles.group}>
              <details
                className={styles.searchableOptions}
                open={categoryDropdownOpen}
                onToggle={(event) => {
                  const nextOpen = event.currentTarget.open;
                  setCategoryDropdownOpen(nextOpen);
                  if (nextOpen) refreshPinnedCategories();
                }}
              >
                <summary className={styles.searchableSummary}>
                  <span className={styles.groupTitle}>Item category</span>
                  <ChevronRightIcon size={11} className={styles.summaryChevron} />
                </summary>
                <div className={styles.searchableBody}>
                  <div className={styles.searchWrap}>
                    <SearchIcon size={12} className={styles.searchIcon} />
                    <ClearSearchInput
                      className={styles.optionSearch}
                      wrapperClassName={styles.searchField}
                      value={categoryQuery}
                      onValueChange={(value) => {
                        setCategoryQuery(value);
                        refreshPinnedCategories();
                      }}
                      placeholder="Find a category…"
                      aria-label="Find an item category"
                      clearLabel="Clear category search"
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
                            onClick={() => toggleToken(token, 'category')}
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
                </div>
              </details>
            </section>
          </div>
        </div>
      </div>
    </Popover>
  );
}
