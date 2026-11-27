import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import * as manifestClient from '../../manifest/client';
import {
  fetchHistoryVersionsIndex,
  getHistoryRevision,
  fetchItemHistory,
  fetchManifestRelease,
  reconstructRemovedSnapshot,
  reconstructRevisionSnapshot,
  type HistoryManifestIndex,
  type HistoryVersionMeta,
  type ItemRevision,
  type ManifestReleaseSummary,
  type ReleaseItemTuple,
  type ReleaseTableChanges,
} from '../../manifest/history';
import { getFriendlyTableName, getShortTableName } from '../../manifest/tables';
import type { DefinitionRef, DefinitionDetailPayload } from '../../types/manifest';
import { useSettingsStore } from '../../stores/settings';
import {
  createHistoryOverviewWorkspace,
  useHistoryWorkspaceStore,
  type HistoryOverviewWorkspace,
  type HistoryWorkspaceEntry,
} from '../../stores/historyWorkspace';
import {
  manifestReleaseSearchTerms,
  resolveManifestReleaseName,
} from '../../data/manifestReleases';
import {
  manifestPatchNoteSearchTerms,
  resolveManifestPatchNote,
} from '../../data/manifestPatchNotes';
import { BungieIcon } from '../BungieIcon';
import { JsonDiffView } from '../inspector/JsonDiffView';
import { JsonTree } from '../inspector/JsonTree';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  MaximizeIcon,
  MinimizeIcon,
} from '../../ui/Icons';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import { Select } from '../../ui/Select';
import { getTierColorVar } from '../../ui/rarity';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import { scrollTabIntoView } from '../../utils/scrollTabIntoView';
import {
  formatBucketEntryCount,
  isBucketExpanded,
} from './historyBuckets';
import styles from './ManifestHistoryPage.module.scss';

export interface ManifestHistoryPageProps {
  versionIndex: number | null;
  onSelectVersion: (versionIndex: number, replace?: boolean) => void;
  onNavigateExplorer: (table: string, hash: number) => void;
}

type ChangeKind = keyof ReleaseTableChanges;
type ChangedEntry = HistoryWorkspaceEntry;

const CHANGE_KINDS: ReadonlyArray<{ value: ChangeKind | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'a', label: 'Added' },
  { value: 'm', label: 'Modified' },
  { value: 'r', label: 'Removed' },
  { value: 'u', label: 'Unclassified' },
  { value: 'c', label: 'Reclassified' },
];

const KIND_NAMES: Record<ChangeKind, string> = {
  a: 'Added',
  m: 'Modified',
  r: 'Removed',
  u: 'Unclassified',
  c: 'Reclassified',
};

function friendlyTableName(table: string): string {
  if (table === 'DestinyInventoryItemDefinition' || table === 'DestinyInventoryItemLiteDefinition') {
    return 'Items';
  }
  if (table === 'DestinySandboxPerkDefinition') return 'Sandbox Perks';
  if (table === 'DestinyRecordDefinition') return 'Triumphs / Records';
  return getFriendlyTableName(table);
}

const RELEASE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const RELEASE_DATE_NO_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatDate(date: string, includeYear = true): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return (includeYear ? RELEASE_DATE_FORMATTER : RELEASE_DATE_NO_YEAR_FORMATTER).format(parsed);
}

function versionLabel(version: HistoryVersionMeta): string {
  return `${formatDate(version.date)} · ${version.version ?? version.id}`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatKindCount(kind: ChangeKind, count: number): string {
  return `${formatCount(count)} ${KIND_NAMES[kind].toLowerCase()}`;
}

const EMPTY_OVERVIEW_WORKSPACE: HistoryOverviewWorkspace =
  createHistoryOverviewWorkspace();

const RELEASE_KINDS: readonly ChangeKind[] = ['a', 'm', 'r', 'u', 'c'];
const releaseTupleSearchText = new WeakMap<ReleaseItemTuple, Map<string, string>>();
// Re-created `ChangedEntry` objects defeat `memo(EntryCard)` and churn hundreds
// of objects on every search keystroke. Cache one entry per release tuple/kind;
// the release object identity bounds the cache lifetime.
const releaseEntryCache = new WeakMap<
  ManifestReleaseSummary,
  WeakMap<ReleaseItemTuple, Map<string, ChangedEntry>>
>();

function countReleaseKinds(
  tables: Record<string, ReleaseTableChanges>,
): Record<ChangeKind, number> {
  const counts: Record<ChangeKind, number> = { a: 0, m: 0, r: 0, u: 0, c: 0 };
  for (const changes of Object.values(tables)) {
    for (const kind of RELEASE_KINDS) {
      counts[kind] += changes[kind]?.length ?? 0;
    }
  }
  return counts;
}

function entryFromReleaseTuple(
  release: ManifestReleaseSummary,
  table: string,
  kind: ChangeKind,
  tuple: ReleaseItemTuple,
  date = release.date,
): ChangedEntry {
  let entriesByTuple = releaseEntryCache.get(release);
  if (!entriesByTuple) {
    entriesByTuple = new WeakMap();
    releaseEntryCache.set(release, entriesByTuple);
  }
  let entriesByKind = entriesByTuple.get(tuple);
  if (!entriesByKind) {
    entriesByKind = new Map();
    entriesByTuple.set(tuple, entriesByKind);
  }
  const cacheKey = `${table}:${kind}:${date}`;
  const cached = entriesByKind.get(cacheKey);
  if (cached) {
    return cached;
  }

  const tableLabel = friendlyTableName(table);
  const entry: ChangedEntry = {
    key: `${table}:${tuple[0]}:${kind}`,
    table,
    hash: tuple[0] >>> 0,
    name: tuple[1] || `${tableLabel} ${tuple[0]}`,
    subtitle: tuple[2] || tableLabel,
    icon: tuple[3],
    tierType: tuple[4],
    ...(tuple[5] === undefined ? {} : { changedFields: tuple[5] }),
    kind,
    versionIndex: release.v,
    date,
    ...(release.version === undefined ? {} : { version: release.version }),
  };
  entriesByKind.set(cacheKey, entry);
  return entry;
}

function tupleSearchText(tuple: ReleaseItemTuple, table: string): string {
  let byTable = releaseTupleSearchText.get(tuple);
  if (!byTable) {
    byTable = new Map();
    releaseTupleSearchText.set(tuple, byTable);
  }
  const cached = byTable.get(table);
  if (cached !== undefined) return cached;
  const tableLabel = friendlyTableName(table);
  const text =
    `${tuple[1] || `${tableLabel} ${tuple[0]}`} ${tuple[2] || tableLabel} ${tuple[0]} ${table} ${tableLabel}`
      .toLowerCase();
  byTable.set(table, text);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyText(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch(() => {});
  }
}

function KindBadge({ kind }: { kind: ChangeKind }): ReactNode {
  return (
    <span className={`${styles.kindBadge} ${styles[`kind${kind.toUpperCase()}`]}`}>
      {KIND_NAMES[kind]}
    </span>
  );
}

const EntryCard = memo(function EntryCard({
  entry,
  onOpen,
  isActive,
}: {
  entry: ChangedEntry;
  onOpen: (entry: ChangedEntry, focus?: boolean) => void;
  isActive: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      className={isActive ? `${styles.entryCard} ${styles.entryCardActive}` : styles.entryCard}
      aria-current={isActive ? 'true' : undefined}
      onClick={(event) => onOpen(entry, !(event.ctrlKey || event.metaKey))}
      onMouseDown={preventMiddleClickAutoScroll}
      onAuxClick={(event) => {
        activateOnMiddleClick(event, () => onOpen(entry, false));
      }}
      title={`Open ${entry.name} history diff`}
    >
      <BungieIcon icon={entry.icon} size={36} />
      <span className={styles.entryInfo}>
        <strong>{entry.name}</strong>
        <span className={styles.entryMeta}>
          <span className={styles.entrySubtitle} style={{ color: getTierColorVar(entry.tierType) }}>
            {entry.subtitle}
          </span>
          <span className={styles.entryHash}>{entry.hash}</span>
        </span>
      </span>
      <span className={styles.entryBadges}>
        <KindBadge kind={entry.kind} />
        {typeof entry.changedFields === 'number' && (
          <span className={styles.fieldCount}>
            {formatCount(entry.changedFields)} {entry.changedFields === 1 ? 'field' : 'fields'}
          </span>
        )}
      </span>
    </button>
  );
});

const ReleaseOverview = memo(function ReleaseOverview({
  release,
  activeVersion,
  onOpenEntry,
  activeKey,
  isActive,
}: {
  release: ManifestReleaseSummary;
  activeVersion: HistoryVersionMeta | null;
  onOpenEntry: (entry: ChangedEntry, focus?: boolean) => void;
  activeKey: string | null;
  isActive: boolean;
}): ReactNode {
  const releaseDate = activeVersion?.date ?? release.date;
  const patchNote = resolveManifestPatchNote(releaseDate);
  const overviewScrollRef = useRef<HTMLDivElement | null>(null);
  const overviewScrollTopRef = useRef<number | null>(null);
  const savedOverview = useHistoryWorkspaceStore(
    (state) => state.overviews[String(release.v)],
  );
  const overviewWorkspace = savedOverview ?? EMPTY_OVERVIEW_WORKSPACE;
  const updateOverview = useHistoryWorkspaceStore((state) => state.updateOverview);
  const kindFilter = overviewWorkspace.kindFilter;
  const search = overviewWorkspace.search;
  const searchKey = useDeferredValue(search).trim();
  // Typing must stay instant on releases with 61k entries: the cheap input
  // update renders immediately while the expensive tuple filtering below runs
  // at a lower priority against the deferred query.
  const deferredSearch = searchKey;
  const isSearching = searchKey.length > 0;
  const manualBucketOverrides = overviewWorkspace.manualBucketOverrides;
  const searchBucketOverrides =
    overviewWorkspace.searchBucketState.query === searchKey
      ? overviewWorkspace.searchBucketState.overrides
      : {};
  useEffect(() => {
    if (overviewWorkspace.searchBucketState.query !== searchKey) {
      updateOverview(release.v, {
        searchBucketState: { query: searchKey, overrides: {} },
      });
    }
  }, [overviewWorkspace.searchBucketState.query, release.v, searchKey, updateOverview]);
  const openBucketOverrides = isSearching ? searchBucketOverrides : manualBucketOverrides;
  const showCounts = overviewWorkspace.visibleCategoryCounts;
  const allKindCounts = useMemo(() => countReleaseKinds(release.tables), [release]);
  const allEntryCount = RELEASE_KINDS.reduce(
    (total, kind) => total + allKindCounts[kind],
    0,
  );
  const groups = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const tables = Object.entries(release.tables).map(([table, changes]) => {
      const tuplesByKind = {} as Record<ChangeKind, readonly ReleaseItemTuple[]>;
      const countsByKind: Record<ChangeKind, number> = {
        a: 0,
        m: 0,
        r: 0,
        u: 0,
        c: 0,
      };

      for (const kind of RELEASE_KINDS) {
        const tuples = changes[kind] ?? [];
        if (kindFilter !== 'all' && kindFilter !== kind) {
          tuplesByKind[kind] = [];
          continue;
        }
        const matchingTuples = query
          ? tuples.filter((tuple) => tupleSearchText(tuple, table).includes(query))
          : tuples;
        tuplesByKind[kind] = matchingTuples;
        countsByKind[kind] = matchingTuples.length;
      }
      const count = RELEASE_KINDS.reduce(
        (total, kind) => total + countsByKind[kind],
        0,
      );
      return { table, tuplesByKind, countsByKind, count };
    });
    return tables
      .filter((group) => group.count > 0)
      .sort((a, b) =>
        friendlyTableName(a.table).localeCompare(friendlyTableName(b.table)),
      );
  }, [deferredSearch, kindFilter, release]);
  const allVisibleGroupsOpen =
    groups.length > 0 &&
    groups.every((group) =>
      isBucketExpanded(group.table, openBucketOverrides, isSearching),
    );

  const setBucketOpen = useCallback(
    (table: string, open: boolean) => {
      if (isSearching) {
        updateOverview(release.v, (current) => ({
          ...current,
          searchBucketState: {
            query: searchKey,
            overrides: {
              ...(current.searchBucketState.query === searchKey
                ? current.searchBucketState.overrides
                : {}),
              [table]: open,
            },
          },
        }));
      } else {
        updateOverview(release.v, (current) => ({
          ...current,
          manualBucketOverrides: {
            ...current.manualBucketOverrides,
            [table]: open,
          },
        }));
      }
    },
    [isSearching, release.v, searchKey, updateOverview],
  );

  const setVisibleGroupsOpen = useCallback(
    (open: boolean) => {
      const visibleOverrides = Object.fromEntries(
        groups.map((group) => [group.table, open]),
      );
      if (isSearching) {
        updateOverview(release.v, (current) => ({
          ...current,
          searchBucketState: {
            query: searchKey,
            overrides: {
              ...(current.searchBucketState.query === searchKey
                ? current.searchBucketState.overrides
                : {}),
              ...visibleOverrides,
            },
          },
        }));
      } else {
        updateOverview(release.v, (current) => ({
          ...current,
          manualBucketOverrides: {
            ...current.manualBucketOverrides,
            ...visibleOverrides,
          },
        }));
      }
    },
    [groups, isSearching, release.v, searchKey, updateOverview],
  );

  const handleOverviewScroll = useCallback(() => {
    if (isActive && overviewScrollRef.current) {
      overviewScrollTopRef.current = overviewScrollRef.current.scrollTop;
    }
  }, [isActive]);
  const handleOpenEntry = useCallback(
    (entry: ChangedEntry, focus?: boolean) => {
      if (overviewScrollRef.current) {
        overviewScrollTopRef.current = overviewScrollRef.current.scrollTop;
      }
      onOpenEntry(entry, focus);
    },
    [onOpenEntry],
  );

  useLayoutEffect(() => {
    if (isActive && overviewScrollRef.current) {
      const scrollTop = overviewScrollTopRef.current ?? overviewWorkspace.scrollTop;
      overviewScrollTopRef.current = scrollTop;
      overviewScrollRef.current.scrollTop = scrollTop;
    }
  }, [isActive, release.v]);

  useEffect(
    () => () => {
      const scrollTop =
        overviewScrollRef.current?.scrollTop ??
        overviewScrollTopRef.current ??
        overviewWorkspace.scrollTop;
      if (scrollTop !== undefined) {
        updateOverview(release.v, {
          scrollTop,
        });
      }
    },
    [overviewWorkspace.scrollTop, release.v, updateOverview],
  );

  return (
    <div
      ref={overviewScrollRef}
      className={styles.overviewScroll}
      onScroll={handleOverviewScroll}
    >
      <header className={styles.releaseHeader}>
        <div>
          <h2
            className={styles.releaseHeading}
            title={
              release.version
                ? `Bungie version ${release.version}`
                : `Version index ${release.v}`
            }
          >
            <span>{formatDate(releaseDate)}</span>
            {resolveManifestReleaseName(releaseDate) && (
              <span className={styles.releaseBadge}>
                {resolveManifestReleaseName(releaseDate)}
              </span>
            )}
          </h2>
          <div className={styles.releaseMetadata}>
            <p>{release.version ? `Bungie version ${release.version}` : `Version index ${release.v}`}</p>
            {patchNote && (
              <a
                className={styles.patchNotesLink}
                href={patchNote.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{patchNote.label} patch notes</span>
                <ExternalLinkIcon size={12} />
              </a>
            )}
          </div>
          {activeVersion?.gapBefore && (
            <div className={styles.archiveGapNotice} role="note">
              This release follows a gap in the archived manifest history.
            </div>
          )}
        </div>
      </header>

      <div className={styles.overviewControls}>
        <div className={styles.kindFilters} role="group" aria-label="Filter changes by kind">
          {CHANGE_KINDS.filter(({ value }) => {
            if (value !== 'u' && value !== 'c') return true;
            return kindFilter === value || allKindCounts[value] > 0;
          }).map(({ value, label }) => (
            <button
              type="button"
              key={value}
              className={kindFilter === value ? styles.kindFilterActive : styles.kindFilter}
              aria-pressed={kindFilter === value}
              onClick={() => updateOverview(release.v, { kindFilter: value })}
            >
              {label}
              <span>
                {value === 'all'
                  ? formatCount(allEntryCount)
                  : formatCount(allKindCounts[value])}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.overviewSearchRow}>
          {groups.length > 0 && (
            <button
              type="button"
              className={styles.expandGroups}
              onClick={() => setVisibleGroupsOpen(!allVisibleGroupsOpen)}
            >
              {allVisibleGroupsOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
          <ClearSearchInput
            className={styles.entrySearch}
            wrapperClassName={styles.entrySearchField}
            value={search}
            onValueChange={(nextSearch) =>
              updateOverview(release.v, { search: nextSearch })
            }
            placeholder="Search name, subtitle, hash, or table…"
            aria-label="Search changed entries"
            clearLabel="Clear entry search"
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <p className={styles.emptyMessage}>No changed entries match this filter.</p>
      ) : (
        <div className={styles.tableGroups}>
          {groups.map((group) => {
            const { table } = group;
            const showLimit = showCounts[table] ?? 120;
            const isOpen = isBucketExpanded(table, openBucketOverrides, isSearching);
            const shown: ChangedEntry[] = [];
            if (isOpen) {
              for (const kind of RELEASE_KINDS) {
                for (const tuple of group.tuplesByKind[kind]) {
                  if (shown.length >= showLimit) break;
                  shown.push(entryFromReleaseTuple(release, table, kind, tuple, releaseDate));
                }
                if (shown.length >= showLimit) break;
              }
            }
            const groupId = `history-group-${release.v}-${encodeURIComponent(table)}`;
            return (
              <section className={styles.tableGroup} key={table}>
                <button
                  type="button"
                  className={styles.tableGroupSummary}
                  aria-expanded={isOpen}
                  aria-controls={groupId}
                  onClick={() => setBucketOpen(table, !isOpen)}
                >
                  <span className={styles.tableGroupTitle}>
                    <ChevronRightIcon
                      className={
                        isOpen
                          ? `${styles.bucketChevron} ${styles.bucketChevronOpen}`
                          : styles.bucketChevron
                      }
                      size={14}
                    />
                    <span className={styles.tableGroupName}>{friendlyTableName(table)}</span>
                    <span className={styles.entryTotal}>
                      {formatBucketEntryCount(group.count)}
                    </span>
                  </span>
                  <span className={styles.tableGroupAside}>
                    <span className={styles.tableKindCounts}>
                      {RELEASE_KINDS.map((kind) => {
                        const count = group.countsByKind[kind];
                        return count > 0 ? (
                          <span
                            key={kind}
                            className={`${styles.tableKindCount} ${styles[`tableKindCount${kind.toUpperCase()}`]}`}
                          >
                            {formatKindCount(kind, count)}
                          </span>
                        ) : null;
                      })}
                    </span>
                    {group.count > 1 && (
                      <span className={styles.diffBar} aria-hidden="true">
                        {RELEASE_KINDS.map((kind) => {
                          if (kind === 'c') return null;
                          const count =
                            kind === 'u'
                              ? group.countsByKind.u + group.countsByKind.c
                              : group.countsByKind[kind];
                          if (count === 0) return null;
                          const barKind = kind === 'u' ? 'other' : kind;
                          return (
                            <span
                              key={kind}
                              className={styles[`diffBar${barKind.toUpperCase()}`]}
                              style={{ width: `${(count / group.count) * 100}%` }}
                            />
                          );
                        })}
                      </span>
                    )}
                  </span>
                </button>
                <div id={groupId} className={styles.tableGroupContent}>
                  {isOpen && (
                    <>
                      <div className={styles.entryGrid}>
                        {shown.map((entry) => (
                          <EntryCard
                            entry={entry}
                            onOpen={handleOpenEntry}
                            isActive={entry.key === activeKey}
                            key={entry.key}
                          />
                        ))}
                      </div>
                      {group.count > shown.length && (
                        <div className={styles.showMoreActions}>
                          {group.count - shown.length > 250 && (
                            <button
                              type="button"
                              className={styles.showMore}
                              onClick={() =>
                                updateOverview(release.v, (current) => ({
                                  ...current,
                                  visibleCategoryCounts: {
                                    ...current.visibleCategoryCounts,
                                    [table]: Math.min(group.count, showLimit + 250),
                                  },
                                }))
                              }
                            >
                              Show 250 more
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.showMore}
                            onClick={() =>
                              updateOverview(release.v, (current) => ({
                                ...current,
                                visibleCategoryCounts: {
                                  ...current.visibleCategoryCounts,
                                  [table]: group.count,
                                },
                              }))
                            }
                          >
                            Show all ({formatCount(group.count - shown.length)} remaining)
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
});

const EntryDiffPanel = memo(function EntryDiffPanel({
  entry,
  onNavigateExplorer,
}: {
  entry: ChangedEntry;
  onNavigateExplorer: (table: string, hash: number) => void;
}): ReactNode {
  const mode = useSettingsStore((state) => state.historyEntryViewMode);
  const setDiffLayout = useSettingsStore((state) => state.setHistoryDiffLayout);
  const diffLayout = useSettingsStore((state) => state.historyDiffLayout);
  const [definition, setDefinition] = useState<DefinitionDetailPayload | null>(null);
  const [revisions, setRevisions] = useState<ItemRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const imageScaling = useSettingsStore((state) => state.imageScaling);

  useEffect(() => {
    let active = true;
    setDefinition(null);
    setRevisions([]);
    setHistoryError(null);
    setLoading(true);
    void Promise.all([
      manifestClient.getDefinition(entry.table, entry.hash, true).catch(() => null),
      fetchItemHistory(entry.table, entry.hash),
    ]).then(([detail, history]) => {
      if (!active) return;
      setDefinition(detail);
      setRevisions(history.revisions);
      setHistoryError(history.available ? null : history.error ?? 'Item history is unavailable.');
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [entry.hash, entry.table]);

  // One reconstruction per `(table, hash, versionIndex)` per fetched revision
  // set. `readSnapshot` is stable for as long as the tab stays open, so
  // switching Diff/Formatted/JSON or moving between open entry tabs is a lookup.
  const snapshotCache = useMemo(() => new Map<string, unknown>(), [definition, revisions]);
  const readSnapshot = useCallback(
    <T,>(key: string, build: () => T): T => {
      if (snapshotCache.has(key)) {
        return snapshotCache.get(key) as T;
      }
      const value = build();
      snapshotCache.set(key, value);
      return value;
    },
    [snapshotCache],
  );

  const snapshots = useMemo(() => {
    const prefix = `${entry.table}:${entry.hash}`;
    const removalAtRelease = revisions.find(
      (revision) => revision.v === entry.versionIndex && revision.k === 'r',
    );
    const latestRemoval = [...revisions]
      .filter((revision) => revision.k === 'r')
      .sort((a, b) => b.v - a.v)[0];

    if (removalAtRelease) {
      return {
        before: readSnapshot(`${prefix}:removed@${entry.versionIndex}`, () =>
          reconstructRemovedSnapshot(revisions, entry.versionIndex),
        ),
        after: null,
      };
    }
    if (definition) {
      return {
        before: readSnapshot(`${prefix}:revision@${entry.versionIndex - 1}`, () =>
          reconstructRevisionSnapshot(
            definition.data,
            revisions,
            entry.versionIndex - 1,
          ),
        ),
        after: readSnapshot(`${prefix}:revision@${entry.versionIndex}`, () =>
          reconstructRevisionSnapshot(definition.data, revisions, entry.versionIndex),
        ),
      };
    }
    if (!latestRemoval) return { before: null, after: null };

    const removedBase = readSnapshot<Record<string, unknown> | null>(
      `${prefix}:removed@${latestRemoval.v}`,
      () => reconstructRemovedSnapshot(revisions, latestRemoval.v),
    );
    if (!removedBase) return { before: null, after: null };
    const beforeRemovalRevisions = revisions.filter((revision) => revision.v < latestRemoval.v);
    if (entry.versionIndex > latestRemoval.v) return { before: null, after: null };
    return {
      before: readSnapshot(`${prefix}:removed-revision@${entry.versionIndex - 1}`, () =>
        reconstructRevisionSnapshot(
          removedBase,
          beforeRemovalRevisions,
          entry.versionIndex - 1,
        ),
      ),
      after:
        entry.versionIndex === latestRemoval.v
          ? null
          : readSnapshot(`${prefix}:removed-revision@${entry.versionIndex}`, () =>
              reconstructRevisionSnapshot(
                removedBase,
                beforeRemovalRevisions,
                entry.versionIndex,
              ),
            ),
    };
  }, [definition, entry.hash, entry.table, entry.versionIndex, readSnapshot, revisions]);

  const treeData = isRecord(snapshots.after) ? snapshots.after : {};
  const resolvedRefs = definition?.resolvedRefs ?? {};
  const displayProperties = definition?.data.displayProperties;
  const displayIcon =
    isRecord(displayProperties) && typeof displayProperties.icon === 'string'
      ? displayProperties.icon
      : undefined;
  const handleNavigateRef = useCallback(
    (ref: DefinitionRef) => onNavigateExplorer(ref.table, ref.hash),
    [onNavigateExplorer],
  );
  const entryModeToggle = <EntryModeToggle />;

  return (
    <div className={styles.entryPanel}>
      <header className={styles.entryHeader}>
        <BungieIcon icon={entry.icon || displayIcon} size={48} />
        <div className={styles.entryTitle}>
          <span className={styles.eyebrow}>{friendlyTableName(entry.table)} · {entry.hash}</span>
          <h2>{entry.name}</h2>
          <span className={styles.entryVersionLine}>
            {formatDate(entry.date)}{entry.version ? ` · ${entry.version}` : ''}
          </span>
        </div>
        <KindBadge kind={entry.kind} />
        <button
          type="button"
          className={styles.openExplorer}
          onClick={() => onNavigateExplorer(entry.table, entry.hash)}
          onMouseDown={preventMiddleClickAutoScroll}
          onAuxClick={(event) =>
            activateOnMiddleClick(event, () =>
              onNavigateExplorer(entry.table, entry.hash),
            )
          }
        >
          <ExternalLinkIcon size={13} />
          Open in Explorer
        </button>
      </header>

      {loading ? (
        <div className={styles.entryState}>Loading definition and archived revisions…</div>
      ) : mode === 'diff' ? (
        <div className={`${styles.entryContent} ${styles.entryContentDiff}`}>
          {historyError && (
            <div className={styles.historyNotice} role="status">
              {historyError} {definition ? 'Showing the current definition where available.' : ''}
            </div>
          )}
          <JsonDiffView
            before={snapshots.before}
            after={snapshots.after}
            defaultLayout="split"
            layout={diffLayout}
            onLayoutChange={setDiffLayout}
            toolbarLeading={entryModeToggle}
            onCopy={(text) => copyText(text)}
          />
        </div>
      ) : mode === 'formatted' ? (
        <div className={styles.entryContent}>
          <JsonTree
            data={treeData}
            resolvedRefs={resolvedRefs}
            onNavigateRef={handleNavigateRef}
            onCopy={(text) => copyText(text)}
            imageScaling={imageScaling}
            embedded
            diffBefore={snapshots.before}
            hideSearch
            toolbarLeading={entryModeToggle}
          />
        </div>
      ) : null}
    </div>
  );
});

const EntryModeToggle = memo(function EntryModeToggle(): ReactNode {
  const mode = useSettingsStore((state) => state.historyEntryViewMode);
  const setMode = useSettingsStore((state) => state.setHistoryEntryViewMode);
  return (
    <div className={styles.entryModes} role="group" aria-label="Entry view">
      {(['diff', 'formatted'] as const).map((view) => (
        <button
          type="button"
          key={view}
          aria-pressed={mode === view}
          className={mode === view ? styles.entryModeActive : styles.entryMode}
          onClick={() => setMode(view)}
        >
          {view === 'diff' ? 'Diff' : 'Formatted'}
        </button>
      ))}
    </div>
  );
});

function HistoryEntryTabs({
  tabs,
  activeKey,
  onSelectEntry,
  onCloseEntry,
  isMobile,
  mobileInspectorOpen,
}: {
  tabs: ChangedEntry[];
  activeKey: string | null;
  onSelectEntry: (key: string) => void;
  onCloseEntry: (key: string) => void;
  isMobile: boolean;
  mobileInspectorOpen: boolean;
}): ReactNode {
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const nameCounts = new Map<string, number>();
  for (const entry of tabs) {
    nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  }

  useLayoutEffect(() => {
    const scrollActiveTab = (): void => {
      const container = tabsRef.current;
      const tab = activeTabRef.current;
      if (container && tab) scrollTabIntoView(container, tab);
    };
    scrollActiveTab();

    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(scrollActiveTab);
      return () => window.cancelAnimationFrame(frame);
    }

    const timer = window.setTimeout(scrollActiveTab, 0);
    return () => window.clearTimeout(timer);
  }, [activeKey, tabs.length, isMobile, mobileInspectorOpen]);

  return (
    <div
      className={styles.entryTabs}
      ref={tabsRef}
      role="tablist"
      aria-label="History entry diffs"
    >
      {tabs.map((entry) => {
        const tableAndHash = `${entry.table}:${entry.hash}`;
        return (
          <div
            ref={activeKey === entry.key ? activeTabRef : undefined}
            className={
              activeKey === entry.key
                ? `${styles.entryTab} ${styles.entryTabActive}`
                : styles.entryTab
            }
            key={entry.key}
            onMouseDown={preventMiddleClickAutoScroll}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                event.stopPropagation();
                onCloseEntry(entry.key);
              }
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeKey === entry.key}
              aria-label={`${entry.name}, ${entry.table}, hash ${entry.hash}`}
              className={styles.entryTabSelect}
              onClick={() => onSelectEntry(entry.key)}
              title={`${entry.name} (${tableAndHash})`}
            >
              <BungieIcon icon={entry.icon} size={19} />
              <span>{entry.name}</span>
              {(nameCounts.get(entry.name) ?? 0) > 1 && (
                <span className={styles.entryTabCategory}>
                  {getShortTableName(entry.table)}
                </span>
              )}
            </button>
            <button
              type="button"
              className={styles.closeEntryTab}
              aria-label={`Close ${entry.name} history tab`}
              onClick={() => onCloseEntry(entry.key)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const ManifestHistoryPage = memo(function ManifestHistoryPage({
  versionIndex,
  onSelectVersion,
  onNavigateExplorer,
}: ManifestHistoryPageProps): ReactNode {
  const [index, setIndex] = useState<HistoryManifestIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [release, setRelease] = useState<ManifestReleaseSummary | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const lastVersionIndex = useHistoryWorkspaceStore((state) => state.lastVersionIndex);
  const setLastVersionIndex = useHistoryWorkspaceStore((state) => state.setLastVersionIndex);
  const tabs = useHistoryWorkspaceStore((state) => state.tabs);
  const activeKey = useHistoryWorkspaceStore((state) => state.activeKey);
  const setWorkspaceTabs = useHistoryWorkspaceStore((state) => state.setTabs);
  const mobileInspectorOpen = useHistoryWorkspaceStore(
    (state) => state.mobileInspectorOpen,
  );
  const setMobileInspectorOpen = useHistoryWorkspaceStore(
    (state) => state.setMobileInspectorOpen,
  );
  const inspectorMaximized = useHistoryWorkspaceStore(
    (state) => state.inspectorMaximized,
  );
  const setInspectorMaximized = useHistoryWorkspaceStore(
    (state) => state.setInspectorMaximized,
  );
  const overviewWidth = useHistoryWorkspaceStore((state) => state.overviewWidth);
  const setOverviewWidth = useHistoryWorkspaceStore((state) => state.setOverviewWidth);
  const tabState = { tabs, activeKey };
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 700px)').matches,
  );
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const overviewPaneRef = useRef<HTMLElement | null>(null);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const previousMobileInspectorOpenRef = useRef(false);

  const versions = useMemo(
    () => [...(index?.versions ?? [])].sort((a, b) => b.i - a.i),
    [index],
  );
  const activeVersionIndex =
    versions.find((version) => version.i === versionIndex)?.i ??
    (versionIndex === null
      ? versions.find((version) => version.i === lastVersionIndex)?.i
      : undefined) ??
    versions[0]?.i ??
    null;
  const activeVersion = versions.find((version) => version.i === activeVersionIndex) ?? null;
  const activeVersionPosition = versions.findIndex((version) => version.i === activeVersionIndex);
  const olderVersion = versions[activeVersionPosition + 1] ?? null;
  const newerVersion = activeVersionPosition > 0 ? versions[activeVersionPosition - 1] : null;
  const latestIndex = versions.reduce((maximum, version) => Math.max(maximum, version.i), 0);
  const historyRevision = getHistoryRevision(index);
  const minOverviewWidth = Math.min(352, workspaceWidth * 0.38);
  const maxOverviewWidth = Math.max(
    minOverviewWidth,
    Math.min(workspaceWidth * 0.65, workspaceWidth - 328),
  );
  const effectiveOverviewWidth =
    overviewWidth === null
      ? workspaceWidth * 0.42
      : Math.max(minOverviewWidth, Math.min(maxOverviewWidth, overviewWidth));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 700px)');
    const update = (): void => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const wasOpen = previousMobileInspectorOpenRef.current;
    previousMobileInspectorOpenRef.current = mobileInspectorOpen;
    if (
      !isMobile ||
      !mobileInspectorOpen ||
      wasOpen ||
      !(window.location.pathname === '/history' ||
        window.location.pathname.startsWith('/history/'))
    ) {
      return;
    }

    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as Record<string, unknown>)
        : {};
    if (currentState.historyDiffSheet === true) return;
    window.history.pushState(
      { ...currentState, historyDiffSheet: true },
      '',
      window.location.href,
    );
  }, [isMobile, mobileInspectorOpen]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent): void => {
      if (
        !isMobile ||
        !(window.location.pathname === '/history' ||
          window.location.pathname.startsWith('/history/'))
      ) {
        return;
      }
      const poppedState = isRecord(event.state) ? event.state : {};
      if (poppedState.historyDiffSheet === true) {
        if (tabState.tabs.length > 0) setMobileInspectorOpen(true);
      } else if (mobileInspectorOpen) {
        setMobileInspectorOpen(false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isMobile, mobileInspectorOpen, tabState.tabs.length]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = (): void => setWorkspaceWidth(workspace.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(workspace);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchHistoryVersionsIndex()
      .then((nextIndex) => {
        if (!active) return;
        setIndex(nextIndex);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load manifest history.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (activeVersionIndex !== null) {
      setLastVersionIndex(activeVersionIndex);
    }
  }, [activeVersionIndex, setLastVersionIndex]);

  useEffect(() => {
    if (!versions.length) return;
    if (activeVersionIndex !== null && activeVersionIndex !== versionIndex) {
      onSelectVersion(activeVersionIndex, true);
    }
  }, [activeVersionIndex, onSelectVersion, versionIndex, versions.length]);

  useEffect(() => {
    if (activeVersionIndex === null || latestIndex === 0) return;
    let active = true;
    setRelease(null);
    setReleaseError(null);
    setReleaseLoading(true);
    void fetchManifestRelease(activeVersionIndex, latestIndex, historyRevision)
      .then((nextRelease) => {
        if (active) setRelease(nextRelease);
      })
      .catch((error: unknown) => {
        if (active) {
          setReleaseError(error instanceof Error ? error.message : 'Unable to load release changes.');
        }
      })
      .finally(() => {
        if (active) setReleaseLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeVersionIndex, historyRevision, latestIndex]);

  const openEntry = useCallback(
    (entry: ChangedEntry, focus = true) => {
      const alreadyOpen = tabs.some((tab) => tab.key === entry.key);
      setWorkspaceTabs(
        alreadyOpen ? tabs : [...tabs, entry],
        focus ? entry.key : activeKey ?? entry.key,
      );
      if (focus && isMobile) setMobileInspectorOpen(true);
    },
    [activeKey, isMobile, setMobileInspectorOpen, setWorkspaceTabs, tabs],
  );

  const closeEntry = useCallback(
    (key: string) => {
      const index = tabs.findIndex((entry) => entry.key === key);
      const nextTabs = tabs.filter((entry) => entry.key !== key);
      const nextActiveKey =
        activeKey === key ? nextTabs[Math.max(0, index - 1)]?.key ?? null : activeKey;
      setWorkspaceTabs(nextTabs, nextActiveKey);
      if (tabs.length <= 1) {
        const currentState = window.history.state;
        if (isMobile && isRecord(currentState) && currentState.historyDiffSheet === true) {
          window.history.back();
        }
        setMobileInspectorOpen(false);
        setInspectorMaximized(false);
      }
    },
    [
      activeKey,
      isMobile,
      setInspectorMaximized,
      setMobileInspectorOpen,
      setWorkspaceTabs,
      tabs,
    ],
  );

  const selectEntryTab = useCallback(
    (key: string) => {
      setWorkspaceTabs(tabs, key);
      if (isMobile) setMobileInspectorOpen(true);
    },
    [isMobile, setMobileInspectorOpen, setWorkspaceTabs, tabs],
  );

  const closeMobileInspector = useCallback(() => {
    const currentState = window.history.state;
    if (isRecord(currentState) && currentState.historyDiffSheet === true) {
      window.history.back();
    }
    setMobileInspectorOpen(false);
  }, []);

  const toggleInspectorMaximized = useCallback(() => {
    setInspectorMaximized(!inspectorMaximized);
  }, [inspectorMaximized, setInspectorMaximized]);

  const handleResizePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const currentWidth =
      overviewPaneRef.current?.getBoundingClientRect().width ??
      workspaceRef.current?.getBoundingClientRect().width ?? 0;
    resizeStartRef.current = { x: event.clientX, width: currentWidth };
  }, []);

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const proposed = start.width + event.clientX - start.x;
      setOverviewWidth(
        Math.max(minOverviewWidth, Math.min(maxOverviewWidth, proposed)),
      );
    },
    [maxOverviewWidth, minOverviewWidth, setOverviewWidth],
  );

  const handleResizePointerUp = useCallback(() => {
    resizeStartRef.current = null;
  }, []);

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const currentWidth = overviewWidth ?? effectiveOverviewWidth;
      const delta = event.key === 'ArrowRight' ? step : -step;
      setOverviewWidth(
        Math.max(minOverviewWidth, Math.min(maxOverviewWidth, currentWidth + delta)),
      );
    },
    [
      effectiveOverviewWidth,
      maxOverviewWidth,
      minOverviewWidth,
      overviewWidth,
      setOverviewWidth,
    ],
  );

  const versionOptions = useMemo(
    () =>
      versions.map((version) => {
        const releaseName = resolveManifestReleaseName(version.date);
        const patchNote = resolveManifestPatchNote(version.date);
        const buildLabel = version.version ?? version.id;
        const optionLabel =
          patchNote || releaseName
            ? [formatDate(version.date), patchNote?.label, releaseName]
                .filter(Boolean)
                .join(' · ')
            : `${formatDate(version.date)} · ${buildLabel}`;
        const counts = version.counts;
        const countRows = [
          { key: 'a', label: 'add', count: counts?.a ?? version.added ?? 0 },
          { key: 'm', label: 'mod', count: counts?.m ?? version.modified ?? 0 },
          { key: 'r', label: 'rem', count: counts?.r ?? version.removed ?? 0 },
        ] as const;
        return {
          value: String(version.i),
          label: optionLabel,
          keywords: [
            formatDate(version.date),
            version.date,
            version.version ?? '',
            version.id,
            version.i,
            manifestReleaseSearchTerms(version.date),
            manifestPatchNoteSearchTerms(version.date),
          ].join(' '),
          title: [
            formatDate(version.date),
            patchNote?.label,
            releaseName,
            `Bungie version ${buildLabel}`,
          ].filter(Boolean).join(' · '),
          renderOption: () => (
            <div className={styles.versionOption}>
              <span className={styles.versionOptionTop}>
                <span className={styles.versionOptionDate}>{formatDate(version.date)}</span>
                {releaseName && (
                  <span className={styles.versionOptionRelease}>{releaseName}</span>
                )}
                {patchNote && (
                  <span className={styles.versionOptionPatch}>{patchNote.label}</span>
                )}
                <span className={styles.versionOptionCounts}>
                  {countRows.map(({ key, label, count }) =>
                    count > 0 ? (
                      <span
                        className={`${styles.versionOptionCount} ${styles[`versionOptionCount${key.toUpperCase()}`]}`}
                        key={key}
                      >
                        {formatCount(count)} {label}
                      </span>
                    ) : null,
                  )}
                </span>
              </span>
              <span className={styles.versionOptionBuild}>
                {version.version ?? version.id}
              </span>
            </div>
          ),
        };
      }),
    [versions],
  );

  return (
    <section className={styles.historyPage} aria-label="Manifest history explorer">
      <main
        className={styles.historyWorkspace}
        ref={workspaceRef}
        data-mobile-inspector-open={isMobile && mobileInspectorOpen ? 'true' : undefined}
      >
        <section
          ref={overviewPaneRef}
          className={
            tabState.tabs.length === 0
              ? `${styles.overviewPane} ${styles.overviewPaneFull}`
              : styles.overviewPane
          }
          hidden={(isMobile && mobileInspectorOpen) || (!isMobile && inspectorMaximized)}
          style={
            !isMobile && tabState.tabs.length > 0 && !inspectorMaximized
              ? ({ '--history-overview-width': `${effectiveOverviewWidth}px` } as CSSProperties)
              : undefined
          }
          aria-label="Release changes"
        >
          <header className={styles.versionPickerBar}>
            <div className={styles.versionPickerGroup}>
              <button
                type="button"
                className={styles.versionStep}
                onClick={() => olderVersion && onSelectVersion(olderVersion.i)}
                disabled={!olderVersion}
                aria-label="Older release"
                title={olderVersion ? formatDate(olderVersion.date) : 'Oldest archived release'}
              >
                <ChevronLeftIcon size={15} />
              </button>
              <Select
                className={styles.versionSelect}
                value={String(activeVersionIndex ?? '')}
                onChange={(value) => onSelectVersion(Number(value))}
                options={versionOptions}
                searchable
                maxPopupWidth="34rem"
                searchPlaceholder="Search updates, releases, dates, or builds..."
                aria-label="Select manifest version"
                title={
                  versionOptions.find((option) => option.value === String(activeVersionIndex))
                    ?.title ?? 'Select manifest version'
                }
              />
              <button
                type="button"
                className={styles.versionStep}
                onClick={() => newerVersion && onSelectVersion(newerVersion.i)}
                disabled={!newerVersion}
                aria-label="Newer release"
                title={newerVersion ? formatDate(newerVersion.date) : 'Latest archived release'}
              >
                <ChevronRightIcon size={15} />
              </button>
            </div>
            {isMobile && tabState.tabs.length > 0 && !mobileInspectorOpen && (
              <button
                type="button"
                className={styles.mobileTabsButton}
                onClick={() => setMobileInspectorOpen(true)}
                aria-label={`Return to open tabs, ${tabState.tabs.length}`}
                title={`Open tabs (${tabState.tabs.length})`}
              >
                Tabs ({tabState.tabs.length})
              </button>
            )}
          </header>
          <div className={styles.overviewContent}>
            {loadError ? (
              <div className={styles.pageState} role="alert">{loadError}</div>
            ) : !index ? (
              <div className={styles.pageState}>Loading archived manifest versions…</div>
            ) : releaseLoading ? (
              <div className={styles.pageState}>
                Loading changes for {activeVersion ? versionLabel(activeVersion) : 'selected version'}…
              </div>
            ) : releaseError ? (
              <div className={styles.pageState} role="alert">
                <strong>Release changes unavailable</strong>
                <span>{releaseError}</span>
              </div>
            ) : release ? (
              <ReleaseOverview
                release={release}
                activeVersion={activeVersion}
                onOpenEntry={openEntry}
                activeKey={tabState.activeKey}
                isActive={!isMobile || !mobileInspectorOpen}
              />
            ) : (
              <div className={styles.pageState}>Choose a manifest version to explore.</div>
            )}
          </div>
        </section>
        {tabState.tabs.length > 0 && !isMobile && !inspectorMaximized && (
          <div
            className={styles.resizeHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize release changes pane"
            aria-valuemin={Math.round(minOverviewWidth)}
            aria-valuemax={Math.round(maxOverviewWidth)}
            aria-valuenow={Math.round(effectiveOverviewWidth)}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onKeyDown={handleResizeKeyDown}
          />
        )}
        {tabState.tabs.length > 0 && (
          <section
            className={[
              styles.entryInspector,
              !isMobile && inspectorMaximized ? styles.entryInspectorMaximized : '',
              isMobile && mobileInspectorOpen ? styles.entryInspectorMobileOpen : '',
            ].filter(Boolean).join(' ')}
            aria-label="History diff inspector"
          >
            <header className={styles.inspectorBar}>
              {isMobile && mobileInspectorOpen && (
                <button
                  type="button"
                  className={styles.mobileBackButton}
                  onClick={closeMobileInspector}
                  aria-label="Back to release changes"
                  title="Back to release changes"
                >
                  <ArrowLeftIcon size={15} />
                  <span>Back</span>
                </button>
              )}
              <HistoryEntryTabs
                tabs={tabState.tabs}
                activeKey={tabState.activeKey}
                onSelectEntry={selectEntryTab}
                onCloseEntry={closeEntry}
                isMobile={isMobile}
                mobileInspectorOpen={mobileInspectorOpen}
              />
              {!isMobile && (
                <button
                  type="button"
                  className={styles.maximizeButton}
                  onClick={toggleInspectorMaximized}
                  aria-label={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
                  title={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
                >
                  {inspectorMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
                </button>
              )}
            </header>
            <div className={styles.diffPanels}>
              {tabState.tabs.map((entry) => (
                <div
                  className={styles.diffPanelSlot}
                  hidden={tabState.activeKey !== entry.key}
                  key={entry.key}
                  role="tabpanel"
                >
                  <EntryDiffPanel entry={entry} onNavigateExplorer={onNavigateExplorer} />
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </section>
  );
});
