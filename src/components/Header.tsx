/// <reference types="vite/client" />
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { BungieLocale, SortMode, TableStatus } from '../types/manifest';
import { BUNGIE_LOCALES } from '../types/manifest';
import { getShortTableName } from '../manifest/tables';
import { useCollectorStore } from '../stores/collector';
import { useExplorerStore } from '../stores/explorer';
import { useSettingsStore } from '../stores/settings';
import { countQueryFilterTokens } from '../utils/queryTokens';
import {
  BookmarkIcon,
  ChevronDownIcon,
  ClarityMark,
  CloseIcon,
  FilterIcon,
  HelpIcon,
  SearchIcon,
  SettingsIcon,
} from '../ui/Icons';
import { Popover } from '../ui/Popover';
import { CollectorPopover } from './CollectorPopover';
import { FiltersPopover } from './FiltersPopover';
import {
  SearchAutocomplete,
  applySearchSuggestion,
  buildSearchSuggestions,
  type SearchSuggestion,
} from './SearchAutocomplete';
import { SettingsPopover } from './SettingsPopover';
import styles from './Header.module.scss';

export interface HeaderProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  onCheckUpdates: () => void;
  onClearCache: () => void;
  onLoadAllTables: () => void;
  onOpenHelp: () => void;
  onLocaleChange: (locale: BungieLocale) => void;
  onSelectTable: (table: string) => void;
}

type MenuName = 'filters' | 'collector' | 'settings' | 'tables';
type MenuSource = 'desktop' | 'mobile';

interface MenuState {
  name: MenuName;
  source: MenuSource;
}

const TABLE_GROUP_ORDER: ReadonlyArray<readonly [TableStatus['group'], string]> = [
  ['primary', 'Primary'],
  ['gameplay', 'Gameplay'],
  ['world', 'World'],
  ['progression', 'Progression'],
  ['system', 'System'],
];

const SORT_OPTIONS: ReadonlyArray<readonly [SortMode, string]> = [
  ['relevance', 'Relevance'],
  ['name-asc', 'Name ↑'],
  ['name-desc', 'Name ↓'],
  ['hash-asc', 'Hash ↑'],
  ['hash-desc', 'Hash ↓'],
  ['index-desc', 'Index ↓'],
];

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/**
 * Active filter count for the Filters button badge: structured filter tokens
 * currently in the query (each chip writes one) plus the popover-only
 * "include unnamed definitions" toggle.
 */
function countActiveFilters(query: string, includeUnnamed: boolean): number {
  return countQueryFilterTokens(query) + (includeUnnamed ? 1 : 0);
}

function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * Virtual rail tables that own their own identity and must never fold into a
 * short-name sibling. The ArtifactPerks view ("Artifact Perks") is derived
 * from artifact definitions but is its own top-level destination in the
 * Primary rail, so it always keeps its own row.
 */
const UNFOLDABLE_TABLES: ReadonlySet<string> = new Set(['ArtifactPerks']);

/**
 * Display labels for virtual rail tables that may not be present in the
 * loaded table list yet (they land with the manifest-engine change that
 * introduces them), so the mobile Tables button never shows a raw id.
 */
const VIRTUAL_TABLE_LABELS: ReadonlyMap<string, string> = new Map([
  ['ArtifactPerks', 'Artifact Perks'],
]);

/** Folds the Lite inventory table into the full one so rows never repeat a short name. */
function dedupeTables(tables: TableStatus[]): TableStatus[] {
  const byShortName = new Map<string, TableStatus>();

  for (const table of tables) {
    const key = getShortTableName(table.name);

    if (UNFOLDABLE_TABLES.has(table.name)) {
      // Never merge virtual views into a similarly named sibling (e.g.
      // ArtifactPerks into Artifact): they stay visible in their rail group.
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
    if (tableRank > existingRank || (tableRank === existingRank && !table.name.endsWith('LiteDefinition'))) {
      byShortName.set(key, table);
    }
  }

  return [...byShortName.values()];
}

export function Header({
  searchInputRef,
  onCheckUpdates,
  onClearCache,
  onLoadAllTables,
  onOpenHelp,
  onLocaleChange,
  onSelectTable,
}: HeaderProps): ReactNode {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchCaret, setSearchCaret] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const suggestionListId = useId();

  const filtersDesktopRef = useRef<HTMLButtonElement>(null);
  const filtersMobileRef = useRef<HTMLButtonElement>(null);
  const collectorDesktopRef = useRef<HTMLButtonElement>(null);
  const collectorMobileRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const tablesRef = useRef<HTMLButtonElement>(null);

  const query = useExplorerStore((state) => state.query);
  const setQuery = useExplorerStore((state) => state.setQuery);
  const deepSearch = useExplorerStore((state) => state.deepSearch);
  const toggleDeepSearch = useExplorerStore((state) => state.toggleDeepSearch);
  const filters = useExplorerStore((state) => state.filters);
  const setTableFilter = useExplorerStore((state) => state.setTableFilter);
  const setMobileInspectorOpen = useExplorerStore((state) => state.setMobileInspectorOpen);
  const tables = useExplorerStore((state) => state.tables);
  const filterCatalog = useExplorerStore((state) => state.filterCatalog);
  const indexedEntryCount = useExplorerStore((state) => state.manifestStatus.indexedEntryCount);

  const locale = useSettingsStore((state) => state.locale);
  const sortMode = useSettingsStore((state) => state.sortMode);
  const setSortMode = useSettingsStore((state) => state.setSortMode);

  const collectedCount = useCollectorStore((state) => state.items.length);
  const collectMode = useCollectorStore((state) => state.collectMode);

  const activeFilterCount = countActiveFilters(query, filters.includeUnnamed);
  const uniqueTables = dedupeTables(tables);
  const hasUnloadedTables = uniqueTables.some((table) => !table.loaded);

  const suggestions = useMemo(
    () => buildSearchSuggestions(query, searchCaret, filterCatalog, tables),
    [query, searchCaret, filterCatalog, tables],
  );
  const autocompleteOpen = searchFocused && !suggestionsDismissed && suggestions.length > 0;
  const activeSuggestionIndex =
    autocompleteOpen && suggestionIndex >= 0 && suggestionIndex < suggestions.length
      ? suggestionIndex
      : -1;

  const groupedTables = TABLE_GROUP_ORDER.map(([group, label]) => ({
    group,
    label,
    tables: uniqueTables.filter((table) => table.group === group),
  })).filter((entry) => entry.tables.length > 0);

  const selectedTable = filters.table === 'all' ? null : uniqueTables.find((table) => table.name === filters.table);
  const activeTableLabel =
    filters.table === 'all'
      ? 'All tables'
      : (selectedTable?.shortName ??
        VIRTUAL_TABLE_LABELS.get(filters.table) ??
        getShortTableName(filters.table));

  const filtersAnchorRef =
    menu?.name === 'filters' && menu.source === 'mobile' ? filtersMobileRef : filtersDesktopRef;
  const filtersAlign = menu?.name === 'filters' && menu.source === 'mobile' ? 'end' : 'start';
  const collectorAnchorRef =
    menu?.name === 'collector' && menu.source === 'mobile' ? collectorMobileRef : collectorDesktopRef;

  function toggleMenu(name: MenuName, source: MenuSource): void {
    setMenu((current) =>
      current?.name === name && current.source === source ? null : { name, source },
    );
  }

  function closeMenu(): void {
    setMenu(null);
  }

  function handleBrandClick(): void {
    setMenu(null);
    setQuery('');
    setTableFilter('all');
    setMobileInspectorOpen(false);
  }

  function handleClearSearch(): void {
    setQuery('');
    searchInputRef.current?.focus();
  }

  /** Keeps the tracked caret in sync without resetting the highlight needlessly. */
  function syncSearchCaret(input: HTMLInputElement): number {
    const caret = input.selectionStart ?? input.value.length;
    if (caret !== searchCaret) {
      setSearchCaret(caret);
      setSuggestionIndex(-1);
    }
    return caret;
  }

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value);
    setSearchCaret(event.target.selectionStart ?? event.target.value.length);
    setSuggestionIndex(-1);
    setSuggestionsDismissed(false);
  }

  function handleSearchFocus(event: FocusEvent<HTMLInputElement>): void {
    setSearchFocused(true);
    setSearchCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
    setSuggestionsDismissed(false);
  }

  function handleSearchBlur(): void {
    setSearchFocused(false);
    setSuggestionIndex(-1);
    setSuggestionsDismissed(false);
  }

  function handleSearchClick(event: MouseEvent<HTMLInputElement>): void {
    syncSearchCaret(event.currentTarget);
  }

  function handleSearchKeyUp(event: KeyboardEvent<HTMLInputElement>): void {
    // These keys are handled in keydown; accepting moves the caret on the next
    // frame, so resyncing here would overwrite it with the stale position.
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Tab' ||
      event.key === 'Enter' ||
      event.key === 'Escape'
    ) {
      return;
    }
    syncSearchCaret(event.currentTarget);
  }

  function acceptSuggestion(suggestion: SearchSuggestion): void {
    const input = searchInputRef.current;
    const caret = input?.selectionStart ?? searchCaret;
    const result = applySearchSuggestion(query, caret, suggestion);

    setQuery(result.query);
    setSearchCaret(result.caret);
    setSuggestionIndex(-1);
    setSuggestionsDismissed(false);

    if (input) {
      input.focus();
      window.requestAnimationFrame(() => {
        input.setSelectionRange(result.caret, result.caret);
      });
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const caret = input.selectionStart ?? input.value.length;
    const current = buildSearchSuggestions(query, caret, filterCatalog, tables);
    const open = searchFocused && !suggestionsDismissed && current.length > 0;

    if (event.key === 'Escape') {
      if (open) {
        // Dismiss only the dropdown; leave the query and other dialogs alone.
        event.stopPropagation();
        setSuggestionsDismissed(true);
        setSuggestionIndex(-1);
      }
      return;
    }

    if (!open) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const forward = event.key === 'ArrowDown';
      setSuggestionIndex((index) => {
        const base = index >= 0 && index < current.length ? index : -1;
        if (forward) return base < 0 ? 0 : (base + 1) % current.length;
        return base < 0 ? current.length - 1 : (base - 1 + current.length) % current.length;
      });
      return;
    }

    if (event.key === 'Tab') {
      if (event.shiftKey) return;
      const index =
        suggestionIndex >= 0 && suggestionIndex < current.length ? suggestionIndex : 0;
      const chosen = current[index];
      if (!chosen) return;
      event.preventDefault();
      event.stopPropagation();
      acceptSuggestion(chosen);
      return;
    }

    if (event.key === 'Enter') {
      if (suggestionIndex < 0 || suggestionIndex >= current.length) return;
      const chosen = current[suggestionIndex];
      if (!chosen) return;
      event.preventDefault();
      event.stopPropagation();
      acceptSuggestion(chosen);
    }
  }

  function handleSelectTable(table: string): void {
    onSelectTable(table);
    setMenu(null);
  }

  function handleLoadAllTables(): void {
    onLoadAllTables();
    setMenu(null);
  }

  const filtersOpen = menu?.name === 'filters';
  const collectorOpen = menu?.name === 'collector';
  const settingsOpen = menu?.name === 'settings';
  const tablesOpen = menu?.name === 'tables';

  return (
    <>
      <header className={styles.header}>
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.brand}
            onClick={handleBrandClick}
            aria-label="Manifest Explorer home"
            title="Manifest Explorer"
          >
            <span className={styles.brandMark}>
              <ClarityMark size={20} />
            </span>
            <span className={styles.brandText}>Manifest Explorer</span>
          </button>

          <div className={styles.searchCluster}>
            <div className={styles.searchField}>
              <SearchIcon size={14} className={styles.searchIcon} />
              <input
                ref={searchInputRef}
                type="search"
                className={styles.searchInput}
                value={query}
                onChange={handleSearchChange}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
                onClick={handleSearchClick}
                onKeyDown={handleSearchKeyDown}
                onKeyUp={handleSearchKeyUp}
                placeholder={
                  deepSearch
                    ? 'Deep search inside JSON keys & values…'
                    : 'Search name, hash, tier:exotic, table:perk…'
                }
                aria-label={deepSearch ? 'Deep search inside manifest JSON' : 'Search the manifest'}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={autocompleteOpen}
                aria-controls={autocompleteOpen ? `${suggestionListId}-list` : undefined}
                aria-activedescendant={
                  activeSuggestionIndex >= 0
                    ? `${suggestionListId}-option-${activeSuggestionIndex}`
                    : undefined
                }
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  className={styles.clearSearch}
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <CloseIcon size={12} />
                </button>
              ) : (
                <kbd className={styles.kbd} aria-hidden="true" title="Shortcut: press / when not typing to jump here">
                  /
                </kbd>
              )}
              <SearchAutocomplete
                id={suggestionListId}
                suggestions={autocompleteOpen ? suggestions : []}
                highlightIndex={activeSuggestionIndex}
                onHighlight={setSuggestionIndex}
                onAccept={acceptSuggestion}
              />
            </div>

            <button
              ref={filtersDesktopRef}
              type="button"
              className={cx(styles.iconBtn, styles.desktopOnly, activeFilterCount > 0 && styles.iconBtnOn)}
              onClick={() => toggleMenu('filters', 'desktop')}
              aria-label={
                activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'
              }
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
              title="Filters — writes editable tokens like is:enhanced into the search bar"
            >
              <FilterIcon size={15} />
              {activeFilterCount > 0 && (
                <span className={styles.badge} aria-hidden="true">
                  {formatBadge(activeFilterCount)}
                </span>
              )}
            </button>

            <button
              type="button"
              className={cx(styles.deepBtn, deepSearch && styles.iconBtnOn)}
              onClick={toggleDeepSearch}
              aria-pressed={deepSearch}
              title="Deep Search — scan raw JSON keys and values across definitions instead of only names and descriptions"
            >
              Deep Search
            </button>
          </div>

          <select
            className={cx(styles.locale, styles.desktopOnly)}
            value={locale}
            onChange={(event) => onLocaleChange(event.target.value as BungieLocale)}
            aria-label="Manifest language"
            title="Manifest language"
          >
            {BUNGIE_LOCALES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            ref={collectorDesktopRef}
            type="button"
            className={cx(styles.iconBtn, styles.desktopOnly, collectMode && styles.iconBtnOn)}
            onClick={() => toggleMenu('collector', 'desktop')}
            aria-label={
              collectedCount > 0 ? `Collected items, ${collectedCount}` : 'Collected items'
            }
            aria-expanded={collectorOpen}
            aria-haspopup="dialog"
            title="Collected items"
          >
            <BookmarkIcon size={15} />
            {collectedCount > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {formatBadge(collectedCount)}
              </span>
            )}
          </button>

          <button
            type="button"
            className={cx(styles.iconBtn, styles.desktopOnly)}
            onClick={() => {
              setMenu(null);
              onOpenHelp();
            }}
            aria-label="Keyboard shortcuts and search help"
            title="Keyboard shortcuts and search help"
          >
            <HelpIcon size={15} />
          </button>

          <button
            ref={settingsRef}
            type="button"
            className={styles.iconBtn}
            onClick={() => toggleMenu('settings', 'desktop')}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            title="Settings"
          >
            <SettingsIcon size={15} />
          </button>
        </div>

        <div className={styles.toolbar}>
          <button
            ref={tablesRef}
            type="button"
            className={cx(styles.toolBtn, styles.tablesBtn)}
            onClick={() => toggleMenu('tables', 'mobile')}
            aria-label={`Tables, ${activeTableLabel}`}
            aria-expanded={tablesOpen}
            aria-haspopup="dialog"
          >
            <span className={styles.tablesLabel}>{activeTableLabel}</span>
            <ChevronDownIcon size={13} className={styles.tablesChevron} />
          </button>

          <button
            ref={filtersMobileRef}
            type="button"
            className={cx(styles.iconBtn, activeFilterCount > 0 && styles.iconBtnOn)}
            onClick={() => toggleMenu('filters', 'mobile')}
            aria-label={
              activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'
            }
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            title="Filters"
          >
            <FilterIcon size={15} />
            {activeFilterCount > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {formatBadge(activeFilterCount)}
              </span>
            )}
          </button>

          <select
            className={styles.sortSelect}
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            aria-label="Sort results"
            title="Sort results"
          >
            {SORT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <button
            ref={collectorMobileRef}
            type="button"
            className={cx(styles.iconBtn, collectMode && styles.iconBtnOn)}
            onClick={() => toggleMenu('collector', 'mobile')}
            aria-label={
              collectedCount > 0 ? `Collected items, ${collectedCount}` : 'Collected items'
            }
            aria-expanded={collectorOpen}
            aria-haspopup="dialog"
            title="Collected items"
          >
            <BookmarkIcon size={15} />
            {collectedCount > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {formatBadge(collectedCount)}
              </span>
            )}
          </button>
        </div>
      </header>

      <Popover
        open={tablesOpen}
        onClose={closeMenu}
        anchorRef={tablesRef}
        align="start"
        label="Tables"
        width="16rem"
      >
        <div className={styles.menuSection}>
          <button
            type="button"
            className={cx(styles.menuRow, filters.table === 'all' && styles.menuRowSelected)}
            onClick={() => handleSelectTable('all')}
            aria-current={filters.table === 'all' ? 'true' : undefined}
          >
            <span className={styles.menuRowName}>All tables</span>
            <span className={styles.menuRowMeta}>{NUMBER_FORMAT.format(indexedEntryCount)}</span>
          </button>
        </div>

        {groupedTables.map((group) => (
          <section key={group.group} className={styles.menuSection}>
            <h2 className={styles.menuTitle}>{group.label}</h2>
            {group.tables.map((table) => {
              const selected =
                filters.table !== 'all' &&
                getShortTableName(table.name) === getShortTableName(filters.table);
              return (
                <button
                  key={table.name}
                  type="button"
                  className={cx(styles.menuRow, selected && styles.menuRowSelected)}
                  onClick={() => handleSelectTable(table.name)}
                  aria-current={selected ? 'true' : undefined}
                  title={table.name}
                >
                  <span className={styles.menuRowName}>{table.shortName}</span>
                  <span className={styles.menuRowMeta}>
                    {table.loaded ? NUMBER_FORMAT.format(table.count) : 'Load'}
                  </span>
                </button>
              );
            })}
          </section>
        ))}

        {hasUnloadedTables && (
          <div className={styles.menuFooter}>
            <button type="button" className={styles.menuFooterBtn} onClick={handleLoadAllTables}>
              Load all tables
            </button>
          </div>
        )}
      </Popover>

      <FiltersPopover
        open={filtersOpen}
        onClose={closeMenu}
        anchorRef={filtersAnchorRef}
        align={filtersAlign}
      />

      <CollectorPopover
        open={collectorOpen}
        onClose={closeMenu}
        anchorRef={collectorAnchorRef}
      />

      <SettingsPopover
        open={settingsOpen}
        onClose={closeMenu}
        anchorRef={settingsRef}
        onCheckUpdates={onCheckUpdates}
        onClearCache={onClearCache}
        onLoadAllTables={onLoadAllTables}
        onLocaleChange={onLocaleChange}
      />
    </>
  );
}
