/// <reference types="vite/client" />
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { TableStatus } from '../types/manifest';
import {
  canonicalTableName,
  getFriendlyTableName,
  getShortTableName,
} from '../manifest/tables';
import { RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from '../stores/settings';
import { useExplorerStore } from '../stores/explorer';
import { DownloadIcon, PanelLeftIcon, SearchIcon } from '../ui/Icons';
import styles from './TableRail.module.scss';

export interface TableRailProps {
  width: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onResize: (width: number) => void;
  onSelectTable: (table: string) => void;
  onLoadTable: (table: string) => void;
  onLoadAllTables: () => void;
}

const CORE_RESEARCH_TABLES: readonly string[] = [
  'DestinyInventoryItemDefinition',
  'DestinySandboxPerkDefinition',
  'DestinyCollectibleDefinition',
  'DestinyRecordDefinition',
  'DestinyActivityDefinition',
  'DestinyPlugSetDefinition',
  'DestinyVendorDefinition',
  'DestinyLoreDefinition',
  'DestinyStatDefinition',
  'DestinyPresentationNodeDefinition',
  'DestinyObjectiveDefinition',
  'DestinyTraitDefinition',
  'DestinySeasonDefinition',
  'DestinyArtifactDefinition',
];

const CORE_TABLE_SET = new Set(CORE_RESEARCH_TABLES);
const CORE_TABLE_RANK = new Map(CORE_RESEARCH_TABLES.map((name, idx) => [name, idx]));

const TABLE_GROUP_ORDER: ReadonlyArray<readonly [TableStatus['group'], string]> = [
  ['gameplay', 'Gameplay'],
  ['world', 'World'],
  ['progression', 'Progression'],
  ['system', 'System'],
];

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

function clampRailWidth(width: number): number {
  return Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(width)));
}

function matchesFilter(table: TableStatus, filter: string): boolean {
  if (filter.length === 0) {
    return true;
  }
  return (
    table.name.toLowerCase().includes(filter) ||
    table.shortName.toLowerCase().includes(filter) ||
    getFriendlyTableName(table.name).toLowerCase().includes(filter)
  );
}

/** Folds the Lite inventory table into the full one so rows never repeat a short name. */
function dedupeTables(tables: TableStatus[]): TableStatus[] {
  const byShortName = new Map<string, TableStatus>();

  for (const table of tables) {
    const key = getShortTableName(table.name);
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

export function TableRail({
  width,
  collapsed,
  onToggleCollapse,
  onResize,
  onSelectTable,
  onLoadTable,
  onLoadAllTables,
}: TableRailProps): ReactNode {
  const [filterText, setFilterText] = useState('');
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const tables = useExplorerStore((state) => state.tables);
  const filters = useExplorerStore((state) => state.filters);
  const manifestStatus = useExplorerStore((state) => state.manifestStatus);

  const loadedCount =
    tables.length > 0
      ? tables.filter((table) => table.loaded).length
      : manifestStatus.loadedTableCount;
  const totalCount =
    tables.length > 0 ? tables.length : manifestStatus.totalTableCount;
  const hasUnloadedTables = totalCount > loadedCount;

  const normalizedFilter = filterText.trim().toLowerCase();
  const uniqueTables = dedupeTables(tables);

  const coreTables = uniqueTables
    .filter(
      (table) =>
        CORE_TABLE_SET.has(canonicalTableName(table.name)) &&
        matchesFilter(table, normalizedFilter),
    )
    .sort(
      (a, b) =>
        (CORE_TABLE_RANK.get(canonicalTableName(a.name)) ?? 99) -
        (CORE_TABLE_RANK.get(canonicalTableName(b.name)) ?? 99),
    );

  const otherGroups = TABLE_GROUP_ORDER.map(([group, label]) => ({
    group,
    label,
    tables: uniqueTables
      .filter(
        (table) =>
          !CORE_TABLE_SET.has(canonicalTableName(table.name)) &&
          (table.group === group || (group === 'gameplay' && table.group === 'primary')) &&
          matchesFilter(table, normalizedFilter),
      )
      .sort((a, b) => {
        if (a.loaded !== b.loaded) {
          return a.loaded ? -1 : 1;
        }
        return a.shortName.localeCompare(b.shortName);
      }),
  })).filter((entry) => entry.tables.length > 0);

  const groups = [
    ...(coreTables.length > 0 ? [{ group: 'primary' as const, label: 'Core', tables: coreTables }] : []),
    ...otherGroups,
  ];

  if (collapsed) {
    return (
      <aside className={cx(styles.rail, styles.railCollapsed)} aria-label="Manifest tables">
        <button
          type="button"
          className={styles.edge}
          onClick={onToggleCollapse}
          aria-label="Expand tables rail"
          title="Expand tables"
        >
          <PanelLeftIcon size={13} />
        </button>
      </aside>
    );
  }

  function handleTableClick(table: TableStatus): void {
    onSelectTable(table.name);
    if (!table.loaded) {
      onLoadTable(table.name);
    }
  }

  function handleResizePointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
  }

  function handleResizePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    onResize(clampRailWidth(drag.startWidth + (event.clientX - drag.startX)));
  }

  function handleResizePointerEnd(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 32 : 8;
    let next: number | null = null;

    if (event.key === 'ArrowLeft') {
      next = width - step;
    } else if (event.key === 'ArrowRight') {
      next = width + step;
    } else if (event.key === 'Home') {
      next = RAIL_WIDTH_MIN;
    } else if (event.key === 'End') {
      next = RAIL_WIDTH_MAX;
    }

    if (next === null) {
      return;
    }

    event.preventDefault();
    onResize(clampRailWidth(next));
  }

  return (
    <aside
      className={styles.rail}
      style={{ width: `${width}px` }}
      aria-label="Manifest tables"
    >
      <div className={styles.railHeader}>
        <span className={styles.railTitle}>Tables</span>
        <span className={styles.loadedCount}>
          {loadedCount}/{totalCount || '—'}
        </span>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          aria-label="Collapse tables rail"
          title="Collapse tables"
        >
          <PanelLeftIcon size={13} />
        </button>
      </div>

      <div className={styles.filterWrap}>
        <SearchIcon size={12} className={styles.filterIcon} />
        <input
          type="search"
          className={styles.filterInput}
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder="Filter tables…"
          aria-label="Filter tables"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className={styles.scroll}>
        <button
          type="button"
          className={cx(styles.row, filters.table === 'all' && styles.rowSelected)}
          onClick={() => onSelectTable('all')}
          aria-current={filters.table === 'all' ? 'true' : undefined}
          title="Search every indexed table"
        >
          <span className={styles.rowName}>All indexed</span>
          <span className={styles.rowCount}>
            {NUMBER_FORMAT.format(manifestStatus.indexedEntryCount)}
          </span>
        </button>

        {groups.map((group) => (
          <section key={group.group} className={styles.group}>
            <h2 className={styles.groupTitle}>{group.label}</h2>
            {group.tables.map((table) => {
              const selected =
                filters.table !== 'all' &&
                getShortTableName(table.name) === getShortTableName(filters.table);
              return (
                <button
                  key={table.name}
                  type="button"
                  className={cx(styles.row, selected && styles.rowSelected)}
                  onClick={() => handleTableClick(table)}
                  aria-current={selected ? 'true' : undefined}
                  title={
                    table.loaded
                      ? `${table.name} · ${NUMBER_FORMAT.format(table.count)} entries`
                      : `Load ${table.shortName}`
                  }
                >
                  <span className={styles.rowName}>{table.shortName}</span>
                  {table.loaded ? (
                    <span className={styles.rowCount}>{NUMBER_FORMAT.format(table.count)}</span>
                  ) : table.loading ? (
                    <span className={styles.rowCount} aria-label="Loading">
                      …
                    </span>
                  ) : (
                    <span className={styles.rowLazy} aria-label="Not loaded" title="Not loaded">
                      <DownloadIcon size={11} />
                    </span>
                  )}
                </button>
              );
            })}
          </section>
        ))}

        {groups.length === 0 && (
          <p className={styles.emptyState}>
            No tables match “{filterText.trim()}”.
          </p>
        )}
      </div>

      {hasUnloadedTables && (
        <div className={styles.footer}>
          <button type="button" className={styles.loadAllBtn} onClick={onLoadAllTables}>
            Load all tables
          </button>
        </div>
      )}

      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tables rail"
        aria-valuemin={RAIL_WIDTH_MIN}
        aria-valuemax={RAIL_WIDTH_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        onLostPointerCapture={handleResizePointerEnd}
        onKeyDown={handleResizeKeyDown}
      />
    </aside>
  );
}
