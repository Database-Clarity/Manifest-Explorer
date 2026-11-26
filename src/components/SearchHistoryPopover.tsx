/// <reference types="vite/client" />
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { getShortTableName } from '../manifest/tables';
import {
  MAX_NAME_LENGTH,
  useSearchHistoryStore,
  type SearchHistoryEntry,
} from '../stores/searchHistory';
import { ClearSearchInput } from '../ui/ClearSearchInput';
import {
  ClockIcon,
  CloseIcon,
  PencilIcon,
  StarFilledIcon,
  StarIcon,
  TrashIcon,
} from '../ui/Icons';
import { Popover } from '../ui/Popover';
import styles from './SearchHistoryPopover.module.scss';

export interface SearchHistoryPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  onRunEntry: (entry: SearchHistoryEntry) => void;
  onOpenHelp: () => void;
  restoreFocus?: boolean;
}

type SortMode = 'recent' | 'usage' | 'alpha';

const SORT_OPTIONS: ReadonlyArray<readonly [SortMode, string]> = [
  ['recent', 'Recent'],
  ['usage', 'Most used'],
  ['alpha', 'A–Z'],
];

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}

function entryLabel(entry: SearchHistoryEntry): string {
  return entry.name?.trim() || entry.query.trim();
}

function pluralSearches(count: number): string {
  return `${count} ${count === 1 ? 'search' : 'searches'}`;
}

function relativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (elapsed < 45_000) return 'just now';
  if (elapsed < hour) return `${Math.max(1, Math.round(elapsed / minute))}m ago`;
  if (elapsed < day) return `${Math.max(1, Math.round(elapsed / hour))}h ago`;
  if (elapsed < week) return `${Math.max(1, Math.round(elapsed / day))}d ago`;
  if (elapsed < month) return `${Math.max(1, Math.round(elapsed / week))}w ago`;
  if (elapsed < year) return `${Math.max(1, Math.round(elapsed / month))}mo ago`;
  return `${Math.max(1, Math.round(elapsed / year))}y ago`;
}

function compareEntries(a: SearchHistoryEntry, b: SearchHistoryEntry, sort: SortMode): number {
  if (sort === 'usage') {
    return b.usageCount - a.usageCount || b.lastUsage - a.lastUsage;
  }
  if (sort === 'alpha') {
    return (
      entryLabel(a).localeCompare(entryLabel(b), undefined, { sensitivity: 'base' }) ||
      b.lastUsage - a.lastUsage
    );
  }
  return b.lastUsage - a.lastUsage;
}

function sortEntries(entries: SearchHistoryEntry[], sort: SortMode): SearchHistoryEntry[] {
  return [...entries].sort((a, b) => compareEntries(a, b, sort));
}

/**
 * Zero-cost shell: while the popover is closed nothing below mounts, so no
 * history subscription or row tree renders on unrelated search keystrokes.
 */
export function SearchHistoryPopover(props: SearchHistoryPopoverProps): ReactNode {
  if (!props.open) {
    return null;
  }
  return <SearchHistoryPopoverBody {...props} />;
}

function SearchHistoryPopoverBody({
  open,
  onClose,
  anchorRef,
  onRunEntry,
  onOpenHelp,
  restoreFocus,
}: SearchHistoryPopoverProps): ReactNode {
  const entries = useSearchHistoryStore((state) => state.entries);
  const toggleSaved = useSearchHistoryStore((state) => state.toggleSaved);
  const rename = useSearchHistoryStore((state) => state.rename);
  const remove = useSearchHistoryStore((state) => state.remove);
  const clearRecent = useSearchHistoryStore((state) => state.clearRecent);

  const [sort, setSort] = useState<SortMode>('recent');
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [clearConfirm, setClearConfirm] = useState(false);
  const [status, setStatus] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlurRef = useRef(false);

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (normalizedFilter.length === 0) {
      return entries;
    }
    return entries.filter((entry) => {
      if (entry.query.toLowerCase().includes(normalizedFilter)) {
        return true;
      }
      return (entry.name ?? '').toLowerCase().includes(normalizedFilter);
    });
  }, [entries, normalizedFilter]);

  const savedEntries = useMemo(
    () => sortEntries(filteredEntries.filter((entry) => entry.saved), sort),
    [filteredEntries, sort],
  );
  const recentEntries = useMemo(
    () => sortEntries(filteredEntries.filter((entry) => !entry.saved), sort),
    [filteredEntries, sort],
  );
  const recentCount = entries.reduce(
    (count, entry) => (entry.saved ? count : count + 1),
    0,
  );
  const showFilter = entries.length > 6 || filter.length > 0;

  useEffect(() => {
    if (renamingId === null) {
      return;
    }
    const input = renameInputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    input.select();
  }, [renamingId]);

  function startRename(entry: SearchHistoryEntry): void {
    skipRenameBlurRef.current = false;
    setClearConfirm(false);
    setRenamingId(entry.id);
    setRenameDraft(entry.name ?? '');
  }

  function cancelRename(): void {
    skipRenameBlurRef.current = true;
    setRenamingId(null);
    setStatus('Rename cancelled');
  }

  function commitRename(): void {
    if (renamingId === null) {
      return;
    }
    const id = renamingId;
    const value = renameDraft.trim();
    const entry = entries.find((candidate) => candidate.id === id);
    const hadName = Boolean(entry?.name);
    rename(id, value);
    setStatus(
      value.length > 0
        ? `Renamed${entry ? ` ${entryLabel(entry)}` : ''} to ${value}`
        : hadName
          ? 'Removed search name'
          : 'No name added',
    );
    setRenamingId(null);
  }

  function handleRenameBlur(): void {
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false;
      return;
    }
    commitRename();
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitRename();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelRename();
    }
  }

  function handleToggleSaved(entry: SearchHistoryEntry): void {
    const willSave = !entry.saved;
    toggleSaved(entry.id);
    setStatus(
      willSave
        ? `Saved search ${entryLabel(entry)}`
        : `Removed ${entryLabel(entry)} from saved searches`,
    );
  }

  function handleDelete(entry: SearchHistoryEntry): void {
    if (renamingId === entry.id) {
      setRenamingId(null);
    }
    remove(entry.id);
    setStatus(`Deleted search ${entryLabel(entry)}`);
  }

  function handleRun(entry: SearchHistoryEntry): void {
    onRunEntry(entry);
    onClose();
  }

  function handleClearRecent(): void {
    if (recentCount === 0) {
      setClearConfirm(false);
      return;
    }
    const count = recentCount;
    clearRecent();
    setClearConfirm(false);
    setStatus(`Cleared ${pluralSearches(count)}`);
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      if (renamingId !== null) {
        event.preventDefault();
        event.stopPropagation();
        cancelRename();
      }
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const buttons = Array.from(
      panel.querySelectorAll<HTMLButtonElement>('[data-run-search]'),
    );
    if (buttons.length === 0) {
      return;
    }

    event.preventDefault();
    const active = document.activeElement;
    let index = buttons.findIndex((button) => button === active);
    if (index < 0) {
      index = event.key === 'ArrowDown' ? -1 : 0;
    }
    const nextIndex =
      event.key === 'ArrowDown'
        ? (index + 1) % buttons.length
        : (index - 1 + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }

  function renderEntry(entry: SearchHistoryEntry): ReactNode {
    const label = entryLabel(entry);
    const renaming = renamingId === entry.id;
    const tableName =
      entry.scope.table !== 'all' ? getShortTableName(entry.scope.table) : '';

    return (
      <li key={entry.id} className={styles.row}>
        <button
          type="button"
          className={cx(styles.iconBtn, styles.starBtn, entry.saved && styles.starOn)}
          aria-pressed={entry.saved}
          aria-label={
            entry.saved ? `Unsave search ${label}` : `Save search ${label}`
          }
          title={entry.saved ? 'Unsave search' : 'Save search'}
          onClick={() => handleToggleSaved(entry)}
        >
          {entry.saved ? <StarFilledIcon size={14} /> : <StarIcon size={14} />}
        </button>

        {renaming ? (
          <div className={styles.renameWrap}>
            <input
              ref={renameInputRef}
              className={styles.renameInput}
              value={renameDraft}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Name this search…"
              aria-label={`Name for ${label}`}
              autoComplete="off"
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
            />
          </div>
        ) : (
          <button
            type="button"
            className={styles.runBtn}
            data-run-search={entry.id}
            aria-label={`Run search ${label}`}
            onClick={() => handleRun(entry)}
          >
            {entry.name ? (
              <span className={styles.entryName}>{entry.name}</span>
            ) : null}
            <span
              className={cx(styles.query, !entry.name && styles.queryPrimary)}
            >
              {entry.query}
            </span>
            <span className={styles.meta}>
              <span className={styles.metaText}>
                {entry.usageCount}× · {relativeTime(entry.lastUsage)}
              </span>
              {entry.scope.deepSearch ? (
                <span className={cx(styles.pill, styles.pillDeep)}>Deep</span>
              ) : null}
              {tableName ? (
                <span className={styles.pill} title={entry.scope.table}>
                  {tableName}
                </span>
              ) : null}
            </span>
          </button>
        )}

        <div className={styles.actions}>
          {!renaming ? (
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={`Rename search ${label}`}
              title="Rename search"
              onClick={() => startRename(entry)}
            >
              <PencilIcon size={13} />
            </button>
          ) : null}
          <button
            type="button"
            className={cx(styles.iconBtn, styles.deleteBtn)}
            aria-label={`Delete search ${label}`}
            title="Delete search"
            onClick={() => handleDelete(entry)}
          >
            <TrashIcon size={13} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="start"
      label="Search history"
      width="min(34rem, calc(100vw - 1rem))"
      restoreFocus={restoreFocus}
      panelClassName={styles.popoverFlush}
      initialFocusRef={panelRef}
    >
      <div
        ref={panelRef}
        className={styles.body}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 className={styles.title}>Search history</h2>
            <span className={styles.count}>{pluralSearches(entries.length)}</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close search history"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className={styles.toolbar}>
          <div className={styles.sortTrack} role="group" aria-label="Sort searches">
            {SORT_OPTIONS.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={cx(
                  styles.sortItem,
                  sort === mode && styles.sortItemActive,
                )}
                aria-pressed={sort === mode}
                onClick={() => setSort(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {showFilter ? (
            <ClearSearchInput
              wrapperClassName={styles.filterWrap}
              className={styles.filterInput}
              value={filter}
              onValueChange={setFilter}
              placeholder="Filter history…"
              aria-label="Filter search history"
              clearLabel="Clear history filter"
              autoComplete="off"
            />
          ) : null}
        </div>

        <div className={styles.scroll}>
          {entries.length === 0 ? (
            <div className={styles.empty}>
              <p>
                No search history yet. Run a search or press Enter to save it
                here.
              </p>
              <button
                type="button"
                className={styles.helpBtn}
                onClick={() => {
                  onOpenHelp();
                  onClose();
                }}
              >
                Search syntax help
              </button>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className={styles.empty}>
              <p>No searches match “{filter.trim()}”.</p>
              <button
                type="button"
                className={styles.helpBtn}
                onClick={() => setFilter('')}
              >
                Clear filter
              </button>
            </div>
          ) : (
            <>
              {savedEntries.length > 0 ? (
                <section className={styles.section} aria-labelledby="search-history-saved">
                  <h3 id="search-history-saved" className={styles.sectionTitle}>
                    <StarFilledIcon size={11} />
                    <span>Saved</span>
                    <span className={styles.sectionCount}>{savedEntries.length}</span>
                  </h3>
                  <ul className={styles.list}>{savedEntries.map(renderEntry)}</ul>
                </section>
              ) : null}

              {recentEntries.length > 0 ? (
                <section className={styles.section} aria-labelledby="search-history-recent">
                  <h3 id="search-history-recent" className={styles.sectionTitle}>
                    <ClockIcon size={11} />
                    <span>Recent</span>
                    <span className={styles.sectionCount}>{recentEntries.length}</span>
                  </h3>
                  <ul className={styles.list}>{recentEntries.map(renderEntry)}</ul>
                </section>
              ) : null}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <span className={styles.hint}>
            {renamingId !== null ? 'Enter save · Esc cancel' : 'Enter run · Esc close'}
          </span>
          <div className={styles.footerActions}>
            {clearConfirm ? (
              <div
                className={styles.confirm}
                role="group"
                aria-label="Confirm clear recent searches"
              >
                <span className={styles.confirmLabel}>
                  Clear {recentCount} recent?
                </span>
                <button
                  type="button"
                  className={styles.confirmClear}
                  onClick={handleClearRecent}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className={styles.confirmCancel}
                  onClick={() => setClearConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            ) : recentCount > 0 ? (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => setClearConfirm(true)}
              >
                Clear recent
              </button>
            ) : null}
          </div>
        </footer>

        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </Popover>
  );
}
