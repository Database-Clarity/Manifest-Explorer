import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as manifestClient from '../../manifest/client';
import {
  fetchHistoryVersionsIndex,
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
import { getFriendlyTableName } from '../../manifest/tables';
import type { DefinitionRef, DefinitionDetailPayload } from '../../types/manifest';
import { useSettingsStore } from '../../stores/settings';
import { BungieIcon } from '../BungieIcon';
import { JsonDiffView } from '../inspector/JsonDiffView';
import { JsonTree } from '../inspector/JsonTree';
import { ChevronRightIcon, ExternalLinkIcon } from '../../ui/Icons';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import { getTierColorVar } from '../../ui/rarity';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import {
  formatBucketDiffLabel,
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
type EntryMode = 'diff' | 'pretty';

interface ChangedEntry {
  key: string;
  table: string;
  hash: number;
  name: string;
  subtitle: string;
  icon: string;
  tierType: number;
  changedFields?: number;
  kind: ChangeKind;
  versionIndex: number;
  date: string;
  version?: string;
}

interface EntryTabState {
  activeKey: string | null;
  tabs: ChangedEntry[];
}

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

const KIND_SIGNS: Record<ChangeKind, string> = {
  a: '+',
  m: '~',
  r: '−',
  u: '?',
  c: '↻',
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

function countsFor(version: HistoryVersionMeta): {
  a: number;
  m: number;
  r: number;
} | null {
  if (version.counts) {
    return { a: version.counts.a, m: version.counts.m, r: version.counts.r };
  }
  if (
    typeof version.added === 'number' &&
    typeof version.modified === 'number' &&
    typeof version.removed === 'number'
  ) {
    return { a: version.added, m: version.modified, r: version.removed };
  }
  return null;
}

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
  const cacheKey = `${table}:${kind}`;
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
    date: release.date,
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
      <span aria-hidden="true">{KIND_SIGNS[kind]}</span>
      {KIND_NAMES[kind]}
    </span>
  );
}

function VersionCounts({ version }: { version: HistoryVersionMeta }): ReactNode {
  const counts = countsFor(version);
  if (!counts) return null;
  return (
    <span className={styles.versionCounts} aria-label={`${counts.a} added, ${counts.m} modified, ${counts.r} removed`}>
      <span className={styles.countAdded}>+{counts.a}</span>
      <span className={styles.countModified}>~{counts.m}</span>
      <span className={styles.countRemoved}>−{counts.r}</span>
    </span>
  );
}

const VersionSidebar = memo(function VersionSidebar({
  versions,
  selectedIndex,
  search,
  onSearch,
  onSelect,
}: {
  versions: HistoryVersionMeta[];
  selectedIndex: number | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (index: number) => void;
}): ReactNode {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedSearch) return versions;
    return versions.filter((version) =>
      `${version.date} ${version.version ?? ''} ${version.id}`
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [normalizedSearch, versions]);

  return (
    <aside className={styles.sidebar} aria-label="Manifest versions">
      <div className={styles.sidebarHeading}>
        <div>
          <h1>Manifest history</h1>
          <span>{versions.length} archived versions</span>
        </div>
      </div>
      <label className={styles.versionSearchLabel}>
        <span className={styles.srOnly}>Search versions</span>
        <ClearSearchInput
          className={styles.versionSearch}
          wrapperClassName={styles.versionSearchField}
          value={search}
          onValueChange={onSearch}
          placeholder="Filter by date or version…"
          clearLabel="Clear version filter"
        />
      </label>
      <div className={styles.versionList} role="listbox" aria-label="Archived manifest versions">
        {filtered.map((version, position) => {
          const next = filtered[position + 1];
          return (
            <div key={version.i}>
              <button
                type="button"
                role="option"
                aria-selected={selectedIndex === version.i}
                className={
                  selectedIndex === version.i
                    ? `${styles.versionRow} ${styles.versionRowActive}`
                    : styles.versionRow
                }
                onClick={() => onSelect(version.i)}
                onMouseDown={preventMiddleClickAutoScroll}
                onAuxClick={(event) =>
                  activateOnMiddleClick(event, () => onSelect(version.i))
                }
              >
                <span className={styles.versionRowMain}>
                  <strong>{formatDate(version.date)}</strong>
                  <span className={styles.versionString}>{version.version ?? version.id}</span>
                </span>
                <VersionCounts version={version} />
              </button>
              {version.gapBefore && next && (
                <div className={styles.archiveGap} role="note">
                  <span />
                  Archive gap
                  <span />
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <p className={styles.emptyMessage}>No matching versions.</p>}
      </div>
    </aside>
  );
});

const EntryCard = memo(function EntryCard({
  entry,
  onOpen,
}: {
  entry: ChangedEntry;
  onOpen: (entry: ChangedEntry, focus?: boolean) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={styles.entryCard}
      onClick={(event) => onOpen(entry, !(event.ctrlKey || event.metaKey))}
      onMouseDown={preventMiddleClickAutoScroll}
      onAuxClick={(event) => {
        activateOnMiddleClick(event, () => onOpen(entry, false));
      }}
      title={`Open ${entry.name} full-page diff`}
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
            {entry.changedFields} {entry.changedFields === 1 ? 'field' : 'fields'}
          </span>
        )}
      </span>
    </button>
  );
});

const ReleaseOverview = memo(function ReleaseOverview({
  release,
  onOpenEntry,
}: {
  release: ManifestReleaseSummary;
  onOpenEntry: (entry: ChangedEntry, focus?: boolean) => void;
}): ReactNode {
  const [kindFilter, setKindFilter] = useState<ChangeKind | 'all'>('all');
  const [search, setSearch] = useState('');
  // Typing must stay instant on releases with 61k entries: the cheap input
  // update renders immediately while the expensive tuple filtering below runs
  // at a lower priority against the deferred query.
  const deferredSearch = useDeferredValue(search);
  const searchKey = deferredSearch.trim();
  const isSearching = searchKey.length > 0;
  const [manualBucketsState, setManualBucketsState] = useState<{
    versionIndex: number;
    overrides: Record<string, boolean>;
  }>(() => ({ versionIndex: release.v, overrides: {} }));
  const [searchBucketsState, setSearchBucketsState] = useState<{
    versionIndex: number;
    query: string;
    overrides: Record<string, boolean>;
  }>(() => ({ versionIndex: release.v, query: searchKey, overrides: {} }));
  useEffect(() => {
    setManualBucketsState({ versionIndex: release.v, overrides: {} });
  }, [release.v]);
  useEffect(() => {
    setSearchBucketsState({ versionIndex: release.v, query: searchKey, overrides: {} });
  }, [release.v, searchKey]);
  const manualBucketOverrides =
    manualBucketsState.versionIndex === release.v ? manualBucketsState.overrides : {};
  const searchBucketOverrides =
    searchBucketsState.versionIndex === release.v && searchBucketsState.query === searchKey
      ? searchBucketsState.overrides
      : {};
  const openBucketOverrides = isSearching ? searchBucketOverrides : manualBucketOverrides;
  const [showCountsState, setShowCountsState] = useState<{
    versionIndex: number;
    counts: Record<string, number>;
  }>(() => ({ versionIndex: release.v, counts: {} }));
  const showCounts =
    showCountsState.versionIndex === release.v ? showCountsState.counts : {};
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
        setSearchBucketsState((current) => ({
          versionIndex: release.v,
          query: searchKey,
          overrides: {
            ...(current.versionIndex === release.v && current.query === searchKey
              ? current.overrides
              : {}),
            [table]: open,
          },
        }));
      } else {
        setManualBucketsState((current) => ({
          versionIndex: release.v,
          overrides: {
            ...(current.versionIndex === release.v ? current.overrides : {}),
            [table]: open,
          },
        }));
      }
    },
    [isSearching, release.v, searchKey],
  );

  const setVisibleGroupsOpen = useCallback(
    (open: boolean) => {
      const visibleOverrides = Object.fromEntries(
        groups.map((group) => [group.table, open]),
      );
      if (isSearching) {
        setSearchBucketsState((current) => ({
          versionIndex: release.v,
          query: searchKey,
          overrides: {
            ...(current.versionIndex === release.v && current.query === searchKey
              ? current.overrides
              : {}),
            ...visibleOverrides,
          },
        }));
      } else {
        setManualBucketsState((current) => ({
          versionIndex: release.v,
          overrides: {
            ...(current.versionIndex === release.v ? current.overrides : {}),
            ...visibleOverrides,
          },
        }));
      }
    },
    [groups, isSearching, release.v, searchKey],
  );

  return (
    <div className={styles.overviewScroll}>
      <header className={styles.releaseHeader}>
        <div>
          <span className={styles.eyebrow}>Manifest release</span>
          <h2>{formatDate(release.date)}</h2>
          <p>{release.version ? `Bungie version ${release.version}` : `Version index ${release.v}`}</p>
        </div>
        <div className={styles.totalCounts} aria-label="Release change totals">
          <span className={styles.countAdded}>+{release.totals.a} Added</span>
          <span className={styles.countModified}>~{release.totals.m} Modified</span>
          <span className={styles.countRemoved}>−{release.totals.r} Removed</span>
          <span>{release.totals.u} Unclassified</span>
          <span>{release.totals.c} Reclassified</span>
        </div>
      </header>

      <div className={styles.overviewControls}>
        <div className={styles.kindFilters} role="group" aria-label="Filter changes by kind">
          {CHANGE_KINDS.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              className={kindFilter === value ? styles.kindFilterActive : styles.kindFilter}
              aria-pressed={kindFilter === value}
              onClick={() => setKindFilter(value)}
            >
              {label}
              <span>
                {value === 'all'
                  ? allEntryCount
                  : allKindCounts[value]}
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
            onValueChange={setSearch}
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
            const showLimit = showCounts[table] ?? 60;
            const isOpen = isBucketExpanded(table, openBucketOverrides, isSearching);
            const shown: ChangedEntry[] = [];
            if (isOpen) {
              for (const kind of RELEASE_KINDS) {
                for (const tuple of group.tuplesByKind[kind]) {
                  if (shown.length >= showLimit) break;
                  shown.push(entryFromReleaseTuple(release, table, kind, tuple));
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
                            {formatBucketDiffLabel(kind, count)}
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
                          <EntryCard entry={entry} onOpen={onOpenEntry} key={entry.key} />
                        ))}
                      </div>
                      {group.count > shown.length && (
                        <button
                          type="button"
                          className={styles.showMore}
                          onClick={() =>
                            setShowCountsState((current) => ({
                              versionIndex: release.v,
                              counts: {
                                ...(current.versionIndex === release.v ? current.counts : {}),
                                [table]: Math.min(group.count, showLimit + 60),
                              },
                            }))
                          }
                        >
                          Show {Math.min(60, group.count - shown.length)} more
                          <span> · {group.count - shown.length} remaining</span>
                        </button>
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
  const [mode, setMode] = useState<EntryMode>('diff');
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
  // switching Diff/Pretty/JSON or moving between open entry tabs is a lookup.
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
        <div className={styles.entryModes} role="group" aria-label="Entry view">
          {(['diff', 'pretty'] as const).map((view) => (
            <button
              type="button"
              key={view}
              aria-pressed={mode === view}
              className={mode === view ? styles.entryModeActive : styles.entryMode}
              onClick={() => setMode(view)}
            >
              {view === 'diff' ? 'Diff' : 'Pretty'}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className={styles.entryState}>Loading definition and archived revisions…</div>
      ) : mode === 'diff' ? (
        <div className={styles.entryContent}>
          {historyError && (
            <div className={styles.historyNotice} role="status">
              {historyError} {definition ? 'Showing the current definition where available.' : ''}
            </div>
          )}
          <JsonDiffView
            before={snapshots.before}
            after={snapshots.after}
            defaultLayout="split"
            onCopy={(text) => copyText(text)}
          />
        </div>
      ) : mode === 'pretty' ? (
        <div className={styles.entryContent}>
          <JsonTree
            data={treeData}
            resolvedRefs={resolvedRefs}
            onNavigateRef={handleNavigateRef}
            onCopy={(text) => copyText(text)}
            imageScaling={imageScaling}
            embedded
            diffBefore={snapshots.before}
          />
        </div>
      ) : null}
    </div>
  );
});

function HistoryWorkspaceTabs({
  state,
  onSelectOverview,
  onSelectEntry,
  onCloseEntry,
}: {
  state: EntryTabState;
  onSelectOverview: () => void;
  onSelectEntry: (key: string) => void;
  onCloseEntry: (key: string) => void;
}): ReactNode {
  return (
    <div className={styles.workspaceTabs} role="tablist" aria-label="History views">
      <button
        type="button"
        role="tab"
        aria-selected={state.activeKey === null}
        className={
          state.activeKey === null
            ? `${styles.workspaceTab} ${styles.workspaceTabActive}`
            : styles.workspaceTab
        }
        onClick={onSelectOverview}
      >
        Release overview
      </button>
      {state.tabs.map((entry) => (
        <div
          className={
            state.activeKey === entry.key
              ? `${styles.workspaceEntryTab} ${styles.workspaceTabActive}`
              : styles.workspaceEntryTab
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
            aria-selected={state.activeKey === entry.key}
            className={styles.workspaceEntrySelect}
            onClick={() => onSelectEntry(entry.key)}
          >
            <BungieIcon icon={entry.icon} size={19} />
            <span>{entry.name}</span>
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
      ))}
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
  const [versionSearch, setVersionSearch] = useState('');
  const [release, setRelease] = useState<ManifestReleaseSummary | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [tabState, setTabState] = useState<EntryTabState>({ activeKey: null, tabs: [] });

  const versions = useMemo(
    () => [...(index?.versions ?? [])].sort((a, b) => b.i - a.i),
    [index],
  );
  const activeVersionIndex =
    versions.find((version) => version.i === versionIndex)?.i ?? versions[0]?.i ?? null;
  const activeVersion = versions.find((version) => version.i === activeVersionIndex) ?? null;
  const latestIndex = versions.reduce((maximum, version) => Math.max(maximum, version.i), 0);

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
    void fetchManifestRelease(activeVersionIndex, latestIndex)
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
  }, [activeVersionIndex, latestIndex]);

  const openEntry = useCallback((entry: ChangedEntry, focus = true) => {
    setTabState((current) => {
      const existing = current.tabs.find((tab) => tab.key === entry.key);
      return {
        activeKey: focus ? entry.key : current.activeKey,
        tabs: existing ? current.tabs : [...current.tabs, entry],
      };
    });
  }, []);

  const closeEntry = useCallback((key: string) => {
    setTabState((current) => {
      const index = current.tabs.findIndex((entry) => entry.key === key);
      const tabs = current.tabs.filter((entry) => entry.key !== key);
      const activeKey =
        current.activeKey === key
          ? tabs[Math.max(0, index - 1)]?.key ?? null
          : current.activeKey;
      return { activeKey, tabs };
    });
  }, []);

  const selectOverview = useCallback(() => {
    setTabState((current) => ({ ...current, activeKey: null }));
  }, []);

  const selectEntryTab = useCallback((key: string) => {
    setTabState((current) => ({ ...current, activeKey: key }));
  }, []);

  const mobileVersions = useMemo(() => {
    const query = versionSearch.trim().toLowerCase();
    if (!query) return versions;
    return versions.filter((version) =>
      `${version.date} ${version.version ?? ''} ${version.id}`
        .toLowerCase()
        .includes(query),
    );
  }, [versionSearch, versions]);

  return (
    <section className={styles.historyPage} aria-label="Manifest history explorer">
      <VersionSidebar
        versions={versions}
        selectedIndex={activeVersionIndex}
        search={versionSearch}
        onSearch={setVersionSearch}
        onSelect={onSelectVersion}
      />

      <div className={styles.mobilePicker}>
        <ClearSearchInput
          className={styles.versionSearch}
          wrapperClassName={styles.versionSearchField}
          value={versionSearch}
          onValueChange={setVersionSearch}
          placeholder="Search versions…"
          aria-label="Search manifest versions"
          clearLabel="Clear version search"
        />
        <select
          value={activeVersionIndex ?? ''}
          onChange={(event) => onSelectVersion(Number(event.target.value))}
          aria-label="Select manifest version"
        >
          {mobileVersions.map((version) => (
            <option key={version.i} value={version.i}>
              {versionLabel(version)}
            </option>
          ))}
        </select>
      </div>

      <main className={styles.historyWorkspace}>
        <HistoryWorkspaceTabs
          state={tabState}
          onSelectOverview={selectOverview}
          onSelectEntry={selectEntryTab}
          onCloseEntry={closeEntry}
        />
        <div className={styles.tabPanels}>
          <div className={styles.panelSlot} hidden={tabState.activeKey !== null}>
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
              <ReleaseOverview release={release} onOpenEntry={openEntry} />
            ) : (
              <div className={styles.pageState}>Choose a manifest version to explore.</div>
            )}
          </div>
          {tabState.tabs.map((entry) => (
            <div
              className={styles.panelSlot}
              hidden={tabState.activeKey !== entry.key}
              key={entry.key}
              role="tabpanel"
            >
              <EntryDiffPanel entry={entry} onNavigateExplorer={onNavigateExplorer} />
            </div>
          ))}
        </div>
      </main>
    </section>
  );
});
