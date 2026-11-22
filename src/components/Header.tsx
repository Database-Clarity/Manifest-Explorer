/// <reference types="vite/client" />
import {
  useEffect,
  useLayoutEffect,
  memo,
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
import {
  CHANGELOG,
  computeChangelogOpenState,
  readLastSeenChangelogVersion,
} from '../data/changelog';
import type { BungieLocale } from '../types/manifest';
import { BUNGIE_LOCALES } from '../types/manifest';
import { useCollectorStore } from '../stores/collector';
import { useExplorerStore } from '../stores/explorer';
import { useSettingsStore } from '../stores/settings';
import { countQueryFilterTokens } from '../utils/queryTokens';
import {
  BookmarkIcon,
  CloseIcon,
  FilterIcon,
  HelpIcon,
  ManifestMark,
  SearchIcon,
  SettingsIcon,
} from '../ui/Icons';
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
  searchInputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onCheckUpdates: () => void;
  onClearCache: () => void;
  onLoadAllTables: () => void;
  onOpenHelp: () => void;
  onOpenChangelog?: () => void;
  onLocaleChange: (locale: BungieLocale) => void;
  onSelectTable: (table: string) => void;
}

type MenuName = 'filters' | 'collector' | 'settings';
type MenuSource = 'desktop' | 'mobile' | 'settings';

interface MenuState {
  name: MenuName;
  source: MenuSource;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/**
 * Active filter count for the Filters button badge: structured filter tokens
 * currently in the query (each chip writes one) plus the popover-only
 * "include unnamed definitions" toggle.
 */
function countActiveFilters(
  query: string,
  includeUnnamed: boolean,
  deepSearch: boolean,
  tableFilter: string,
  isMobileViewport: boolean,
): number {
  return (
    countQueryFilterTokens(query) +
    (includeUnnamed ? 1 : 0) +
    (deepSearch ? 1 : 0) +
    (isMobileViewport && tableFilter !== 'all' ? 1 : 0)
  );
}

function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function hasUnseenChangelog(): boolean {
  return (
    computeChangelogOpenState(readLastSeenChangelogVersion(), CHANGELOG).unseenVersions.length > 0
  );
}

/** Stable empty list so the closed autocomplete state never allocates. */
const EMPTY_SUGGESTIONS: readonly SearchSuggestion[] = [];

function resizeSearchTextarea(input: HTMLTextAreaElement, focused: boolean): void {
  input.style.height = '';
  if (!focused) {
    input.style.overflowY = 'hidden';
    return;
  }

  const maxHeight = Number.parseFloat(window.getComputedStyle(input).maxHeight) || 120;
  const contentHeight = input.scrollHeight;
  const desiredHeight = Math.min(contentHeight, maxHeight);
  input.style.height = `${desiredHeight}px`;
  input.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
}

export const Header = memo(function Header({
  searchInputRef,
  onCheckUpdates,
  onClearCache,
  onLoadAllTables,
  onOpenHelp,
  onOpenChangelog,
  onLocaleChange,
  onSelectTable,
}: HeaderProps): ReactNode {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 700px)').matches,
  );
  const [searchCaret, setSearchCaret] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const suggestionListId = useId();

  const filtersDesktopRef = useRef<HTMLButtonElement>(null);
  const collectorDesktopRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);

  const query = useExplorerStore((state) => state.query);
  const setQuery = useExplorerStore((state) => state.setQuery);
  const deepSearch = useExplorerStore((state) => state.deepSearch);
  const tableFilter = useExplorerStore((state) => state.filters.table);
  const includeUnnamed = useExplorerStore((state) => state.filters.includeUnnamed);
  const setTableFilter = useExplorerStore((state) => state.setTableFilter);
  const setMobileInspectorOpen = useExplorerStore((state) => state.setMobileInspectorOpen);
  const tables = useExplorerStore((state) => state.tables);
  const filterCatalog = useExplorerStore((state) => state.filterCatalog);

  const locale = useSettingsStore((state) => state.locale);

  const collectedCount = useCollectorStore((state) => state.items.length);
  const collectMode = useCollectorStore((state) => state.collectMode);

  const activeFilterCount = countActiveFilters(
    query,
    includeUnnamed,
    deepSearch,
    tableFilter,
    isMobileViewport,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 700px)');
    const updateViewport = () => setIsMobileViewport(media.matches);
    updateViewport();
    media.addEventListener('change', updateViewport);
    return () => media.removeEventListener('change', updateViewport);
  }, []);

  useLayoutEffect(() => {
    const input = searchInputRef.current;
    if (!(input instanceof HTMLTextAreaElement)) return;

    resizeSearchTextarea(input, searchFocused);
  }, [query, searchFocused, isMobileViewport, searchInputRef]);

  useEffect(() => {
    const input = searchInputRef.current;
    if (!(input instanceof HTMLTextAreaElement)) return;

    const resizeSearch = () =>
      resizeSearchTextarea(input, document.activeElement === input);
    window.addEventListener('resize', resizeSearch);
    return () => window.removeEventListener('resize', resizeSearch);
  }, [searchInputRef]);

  // Tokenizing the catalog (115 sources, 28 seasons, categories) only matters
  // while the dropdown can actually appear; skip it whenever the input is not
  // focused or the list was dismissed with Escape.
  const suggestions: readonly SearchSuggestion[] = useMemo(
    () =>
      searchFocused && !suggestionsDismissed
        ? buildSearchSuggestions(query, searchCaret, filterCatalog, tables)
        : EMPTY_SUGGESTIONS,
    [searchFocused, suggestionsDismissed, query, searchCaret, filterCatalog, tables],
  );
  const autocompleteOpen = searchFocused && !suggestionsDismissed && suggestions.length > 0;
  const activeSuggestionIndex =
    autocompleteOpen && suggestionIndex >= 0 && suggestionIndex < suggestions.length
      ? suggestionIndex
      : -1;

  const filtersAnchorRef = filtersDesktopRef;
  const filtersAlign = menu?.name === 'filters' && menu.source === 'mobile' ? 'end' : 'start';
  const collectorAnchorRef =
    menu?.name === 'collector' && menu.source === 'settings' ? settingsRef : collectorDesktopRef;

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
  function syncSearchCaret(input: HTMLInputElement | HTMLTextAreaElement): number {
    const caret = input.selectionStart ?? input.value.length;
    if (caret !== searchCaret) {
      setSearchCaret(caret);
      setSuggestionIndex(-1);
    }
    return caret;
  }

  function handleSearchChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const value = event.target.value.replace(/\r?\n+/g, ' ');
    setQuery(value);
    setSearchCaret(Math.min(event.target.selectionStart ?? value.length, value.length));
    setSuggestionIndex(-1);
    setSuggestionsDismissed(false);
  }

  function handleSearchFocus(event: FocusEvent<HTMLTextAreaElement>): void {
    setSearchFocused(true);
    setSearchCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
    setSuggestionsDismissed(false);
  }

  function handleSearchBlur(): void {
    setSearchFocused(false);
    setSuggestionIndex(-1);
    setSuggestionsDismissed(false);
  }

  function handleSearchClick(event: MouseEvent<HTMLTextAreaElement>): void {
    syncSearchCaret(event.currentTarget);
  }

  function handleSearchKeyUp(event: KeyboardEvent<HTMLTextAreaElement>): void {
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

  function handleSearchKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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

    if (event.key === 'Enter') {
      if (open && suggestionIndex >= 0 && suggestionIndex < current.length) {
        const chosen = current[suggestionIndex];
        if (chosen) {
          event.preventDefault();
          event.stopPropagation();
          acceptSuggestion(chosen);
          return;
        }
      }
      event.preventDefault();
      if (isMobileViewport) input.blur();
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

  }

  const filtersOpen = menu?.name === 'filters';
  const collectorOpen = menu?.name === 'collector';
  const settingsOpen = menu?.name === 'settings';

  return (
    <>
      <header className={styles.header}>
        <div
          className={cx(
            styles.bar,
            searchFocused && isMobileViewport && styles.barSearchFocused,
          )}
        >
          <button
            type="button"
            className={styles.brand}
            onClick={handleBrandClick}
            aria-label="Manifest Explorer home"
            title="Manifest Explorer"
          >
            <span className={styles.brandMark}>
              <ManifestMark size={22} />
            </span>
            <span className={styles.brandText}>Manifest Explorer</span>
          </button>

          <a
            className={styles.clarityAttribution}
            href="https://d2clarity.com"
            target="_blank"
            rel="noopener noreferrer"
            title="A Clarity project — visit d2clarity.com"
          >
            by Clarity
          </a>

          <div className={styles.searchCluster}>
            <div className={styles.searchField}>
              <SearchIcon size={14} className={styles.searchIcon} />
              <textarea
                ref={searchInputRef as RefObject<HTMLTextAreaElement | null>}
                rows={1}
                className={styles.searchInput}
                value={query}
                onChange={handleSearchChange}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
                onClick={handleSearchClick}
                onKeyDown={handleSearchKeyDown}
                onKeyUp={handleSearchKeyUp}
                placeholder={
                  isMobileViewport
                    ? deepSearch
                      ? 'Deep search JSON…'
                      : 'Search name/hash…'
                    : deepSearch
                      ? 'Deep search inside JSON keys & values…'
                      : 'Search name, hash, or (damage:solar or damage:arc) tier:exotic…'
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
                wrap="soft"
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
                suggestions={suggestions}
                highlightIndex={activeSuggestionIndex}
                onHighlight={setSuggestionIndex}
                onAccept={acceptSuggestion}
              />
            </div>

            <button
              ref={filtersDesktopRef}
              type="button"
              className={cx(
                styles.iconBtn,
                styles.filtersBtn,
                activeFilterCount > 0 && styles.iconBtnOn,
              )}
              onClick={() => toggleMenu('filters', isMobileViewport ? 'mobile' : 'desktop')}
              aria-label={
                activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'
              }
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
              title="Filters — table scope and search tokens like is:enhanced"
            >
              <FilterIcon size={15} />
              {activeFilterCount > 0 && (
                <span className={styles.badge} aria-hidden="true">
                  {formatBadge(activeFilterCount)}
                </span>
              )}
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
            className={cx(styles.iconBtn, styles.settingsBtn)}
            onClick={() => toggleMenu('settings', 'desktop')}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            title="Settings"
          >
            <SettingsIcon size={15} />
          </button>
        </div>

      </header>

      <FiltersPopover
        open={filtersOpen}
        onClose={closeMenu}
        anchorRef={filtersAnchorRef}
        align={filtersAlign}
        onSelectTable={onSelectTable}
        onLoadAllTables={onLoadAllTables}
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
        onOpenChangelog={onOpenChangelog}
        onOpenHelp={onOpenHelp}
        onOpenCollector={() => setMenu({ name: 'collector', source: 'settings' })}
        hasUnseenChangelog={hasUnseenChangelog()}
        onLocaleChange={onLocaleChange}
      />
    </>
  );
});
