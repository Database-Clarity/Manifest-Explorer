/**
 * Manifest Engine Web Worker.
 *
 * Implements a three-stage boot (instant IndexedDB cache → core tables →
 * background secondary tables), Bungie manifest fetching with retry and cache
 * busting, an in-memory search index, on-demand table loading with streaming
 * full-item buckets, a definition inspector with reference resolution, and
 * cache management. Communicates with the main thread over a small typed RPC.
 */

import type {
  BungieLocale,
  ClarityDescriptionEntry,
  DeepMatchSnippet,
  DefinitionDetailPayload,
  DefinitionOverview,
  FilterCatalog,
  FilterOption,
  FuzzySearchOptions,
  ManifestStatus,
  OverviewLinkedEntity,
  OverviewLore,
  OverviewPerk,
  OverviewSocket,
  OverviewSocketCategory,
  OverviewSocketPlug,
  OverviewStat,
  QueryPrecedence,
  ResolvedHashSummary,
  ResolvedSummaryEntry,
  ReverseReference,
  ReverseReferenceResponse,
  SearchFilters,
  SearchIndexEntry,
  SearchResponse,
  SearchResultItem,
  SortMode,
  SourceFilterOption,
  TableStatus,
  VariantItem,
} from '../types/manifest';
import {
  ARTIFACT_PERKS_TABLE,
  CORE_BOOT_TABLES,
  REVERSE_REF_PRIORITY_TABLES,
  SECONDARY_INDEX_TABLES,
  canonicalTableName,
  extractTableEntrySummary,
  getFriendlyTableName,
  getShortTableName,
  getTableGroup,
} from './tables';
import { bungieAssetUrl, getTargetTablesForField, getTargetTablesForObjectKey, toUnsignedHash } from './hash';
import { SEASON_ALIASES, formatShortSeasonName, getD2aiMappings, refreshD2aiMappingsFromRemote } from './d2ai';
import { annotateEnumField } from './enums';
import { parseSearchQuery, scoreAndFilterEntries } from './query';
import { streamTopLevelJsonObject } from './streamJson';
import {
  clearAllCache,
  getCacheStats as getCacheStatsFromIdb,
  getFullItemRaw,
  getMeta,
  getSearchIndex,
  getTableData,
  hasFullItemsCached,
  iterateFullItems,
  purgeOldVersions,
  putFullItemEntries,
  putMeta,
  putSearchIndex,
  putTableData,
  SEARCH_INDEX_SCHEMA_VERSION,
  type ManifestMeta,
  type SearchIndexCache,
} from './idb';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVENTORY_ITEM_TABLE = 'DestinyInventoryItemDefinition';
const INVENTORY_ITEM_LITE_TABLE = 'DestinyInventoryItemLiteDefinition';
const FULL_ITEM_LRU_LIMIT = 256;
const STREAM_FLUSH_ENTRIES = 2500;
const STREAM_FLUSH_BYTES = 10_000_000;
const fullItemWaiters = new Map<number, Array<(parsed: Record<string, unknown>) => void>>();
const BUNGIE_MANIFEST_URL = 'https://www.bungie.net/Platform/Destiny2/Manifest/';
const CLARITY_URL =
  'https://database-clarity.github.io/Live-Clarity-Database/descriptions/clarity.json';
const CATEGORY_TABLE = 'DestinyItemCategoryDefinition';

// ---------------------------------------------------------------------------
// RPC protocol types (shared with client.ts)
// ---------------------------------------------------------------------------

export interface InitRequest {
  type: 'init';
  id: number;
  locale: string;
  apiKey?: string;
  forceRefresh?: boolean;
}

export interface SearchRequest {
  type: 'search';
  id: number;
  query: string;
  filters: SearchFilters;
  sort: SortMode;
  maxResults?: number;
  fuzzy?: FuzzySearchOptions;
  precedence?: QueryPrecedence;
}

export interface DeepSearchRequest {
  type: 'deepSearch';
  id: number;
  query: string;
  filters: SearchFilters;
  maxResults?: number;
}

export interface GetDefinitionRequest {
  type: 'getDefinition';
  id: number;
  table: string;
  hash: number;
  preferFull?: boolean;
}

export interface LoadTableRequest {
  type: 'loadTable';
  id: number;
  table: string;
}

export interface LoadAllTablesRequest {
  type: 'loadAllTables';
  id: number;
}

export interface GetVariantsRequest {
  type: 'getVariants';
  id: number;
  table: string;
  hash: number;
}

export interface GetReverseReferencesRequest {
  type: 'getReverseReferences';
  id: number;
  targetHash: number;
  targetTable?: string;
  tablesToScan?: string[];
}

export interface GetClarityDescriptionRequest {
  type: 'getClarityDescription';
  id: number;
  hash: number;
}

export interface CheckForUpdatesRequest {
  type: 'checkForUpdates';
  id: number;
}

export interface ClearCacheRequest {
  type: 'clearCache';
  id: number;
}

export interface GetCacheStatsRequest {
  type: 'getCacheStats';
  id: number;
}

export interface GetFilterCatalogRequest {
  type: 'getFilterCatalog';
  id: number;
}

export interface ResolveSummariesRequest {
  type: 'resolveSummaries';
  id: number;
  refs: Array<{ table: string; hash: number }>;
}

export type WorkerRequest =
  | InitRequest
  | SearchRequest
  | DeepSearchRequest
  | GetDefinitionRequest
  | LoadTableRequest
  | LoadAllTablesRequest
  | GetVariantsRequest
  | GetReverseReferencesRequest
  | GetClarityDescriptionRequest
  | CheckForUpdatesRequest
  | ClearCacheRequest
  | GetCacheStatsRequest
  | GetFilterCatalogRequest
  | ResolveSummariesRequest;

export interface WorkerSuccessResponse {
  id: number;
  ok: true;
  result: unknown;
}

export interface WorkerErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export interface StatusEvent {
  type: 'status';
  status: ManifestStatus;
}

export interface TablesEvent {
  type: 'tables';
  tables: TableStatus[];
}

export interface CatalogEvent {
  type: 'catalog';
  catalog: FilterCatalog;
}

export type WorkerEvent = StatusEvent | TablesEvent | CatalogEvent;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  versionSignature?: string;
  error?: string;
}

export interface CacheStatsResult {
  available: boolean;
  tableCount: number;
  fullItemBucketCount: number;
  searchIndexCount: number;
  metaCount: number;
  indexedEntries: number;
  loadedTables: number;
  fullItemsInLru: number;
}

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------

interface EngineState {
  locale: BungieLocale;
  version: string;
  versionSignature: string;
  componentPaths: Record<string, string>;
  apiKey: string | undefined;
  fromCache: boolean;
  phase: ManifestStatus['phase'];
  currentTable: string | undefined;
  error: string | undefined;
  lastCheckedAt: number | undefined;
  initialized: boolean;
}

const state: EngineState = {
  locale: 'en',
  version: '',
  versionSignature: '',
  componentPaths: {},
  apiKey: undefined,
  fromCache: false,
  phase: 'idle',
  currentTable: undefined,
  error: undefined,
  lastCheckedAt: undefined,
  initialized: false,
};

let entries: SearchIndexEntry[] = [];
const indexedTables = new Set<string>();
const entriesByTableAndHash = new Map<string, SearchIndexEntry>();
const entryByHash = new Map<number, SearchIndexEntry>();
const tablesByHash = new Map<number, Set<string>>();
const tableStatuses = new Map<string, TableStatus>();
const tableDataMap = new Map<string, Record<string, Record<string, unknown>>>();
const fullItemLru = new Map<number, Record<string, unknown>>();
const categoryNameMap = new Map<number, string>();
const loadingPromises = new Map<string, Promise<void>>();
let fullItemCount = 0;
let clarityPromise: Promise<Map<number, ClarityDescriptionEntry>> | undefined;

// Cross-table enrichment state. Rebuilt from the loaded DestinyArtifactDefinition
// and DestinySeasonDefinition data before the search index is persisted.
const artifactItemHashes = new Set<number>();
const seasonNumberByHash = new Map<number, number>();
const seasonNameByNumber = new Map<number, string>();
const watermarkSeasonByIcon = new Map<string, number>();
const seasonArtifactByNumber = new Map<number, { hash: number; name: string; icon?: string }>();
let latestSeasonNumber = 0;

/**
 * Tables whose loaded data feeds cross-table enrichment: season metadata comes
 * from DestinySeasonDefinition, active artifact membership from
 * DestinyArtifactDefinition, collectible sources from DestinyCollectibleDefinition,
 * and artifact display identities from the inventory item tables. Loading one of
 * these invalidates enrichment for every entry, so one full pass is required.
 */
const ENRICHMENT_DEPENDENCY_TABLES: ReadonlySet<string> = new Set([
  INVENTORY_ITEM_TABLE,
  INVENTORY_ITEM_LITE_TABLE,
  'DestinySeasonDefinition',
  'DestinyArtifactDefinition',
  'DestinyCollectibleDefinition',
]);

export function isEnrichmentDependencyTable(table: string): boolean {
  return ENRICHMENT_DEPENDENCY_TABLES.has(table);
}

// ---------------------------------------------------------------------------
// Search index persistence coalescing
// ---------------------------------------------------------------------------

/** Persist at most once per this many newly indexed tables during Stage 3. */
export const SEARCH_INDEX_PERSIST_TABLE_BATCH = 18;
/** ... or once this many milliseconds have elapsed since the last write. */
export const SEARCH_INDEX_PERSIST_INTERVAL_MS = 4_000;

export function shouldFlushSearchIndex(
  tablesSincePersist: number,
  lastPersistAt: number,
  now: number,
): boolean {
  return (
    tablesSincePersist >= SEARCH_INDEX_PERSIST_TABLE_BATCH ||
    now - lastPersistAt >= SEARCH_INDEX_PERSIST_INTERVAL_MS
  );
}

/** True when the next IndexedDB write needs a full enrichment pass first. */
let fullEnrichmentPending = true;
/** True when in-memory entries changed since the last completed write. */
let indexDirty = false;
/** Coalescing bookkeeping for the expensive full-index write. */
let tablesSincePersist = 0;
let lastPersistAt = 0;

/**
 * Number of write attempts a `ready` transition makes before giving up on a
 * dirty index (and logging it) instead of hanging the UI forever.
 */
const SEARCH_INDEX_PERSIST_ATTEMPTS = 3;

type WorkerScope = {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const scope = globalThis as unknown as WorkerScope;

// ---------------------------------------------------------------------------
// Small type guards
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asUnsigned(value: unknown): number | undefined {
  const n = asNumber(value);
  if (n === undefined || !Number.isInteger(n)) return undefined;
  return toUnsignedHash(n);
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) out.push(toUnsignedHash(item));
  }
  return out;
}

function asRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Record<string, unknown>[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (rec) out.push(rec);
  }
  return out;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface ManifestIndexResponse {
  Response: {
    version: string;
    jsonWorldComponentContentPaths: Record<string, Record<string, string>>;
  };
}

function componentSuffix(path: string | undefined): string {
  if (!path) return '';
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function computeVersionSignature(paths: Record<string, string>): string {
  return [
    componentSuffix(paths[INVENTORY_ITEM_TABLE]),
    componentSuffix(paths['DestinySandboxPerkDefinition']),
    componentSuffix(paths['DestinyRecordDefinition']),
  ].join('|');
}

async function fetchManifestIndex(
  _locale: string,
  apiKey?: string,
): Promise<ManifestIndexResponse> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['X-API-Key'] = apiKey;
  const res = await fetch(BUNGIE_MANIFEST_URL, { headers });
  if (!res.ok) throw new Error(`Manifest index HTTP ${res.status}`);
  return (await res.json()) as ManifestIndexResponse;
}

function componentUrls(path: string): string[] {
  const base = path.startsWith('http') ? path : `https://www.bungie.net${path}`;
  return [base, `${base}?cb=1`, `${base}?cb=${Date.now()}`];
}

async function fetchComponentJson(
  path: string,
): Promise<Record<string, Record<string, unknown>>> {
  let lastError: unknown = new Error('Unknown fetch error');
  for (const url of componentUrls(path)) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      try {
        return (await res.json()) as Record<string, Record<string, unknown>>;
      } catch (error) {
        lastError = error;
        continue;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw toError(lastError);
}

async function fetchComponentResponse(path: string): Promise<Response> {
  let lastError: unknown = new Error('Unknown fetch error');
  for (const url of componentUrls(path)) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
    }
  }
  throw toError(lastError);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function post(message: WorkerEvent): void {
  scope.postMessage(message);
}

function currentStatus(): ManifestStatus {
  let loaded = 0;
  for (const status of tableStatuses.values()) {
    if (status.name === ARTIFACT_PERKS_TABLE) continue;
    if (status.loaded) loaded += 1;
  }
  return {
    phase: state.phase,
    version: state.version,
    versionSignature: state.versionSignature,
    locale: state.locale,
    fromCache: state.fromCache,
    loadedTableCount: loaded,
    totalTableCount: Object.keys(state.componentPaths).length,
    indexedEntryCount: entries.length,
    currentTable: state.currentTable,
    error: state.error,
    lastCheckedAt: state.lastCheckedAt,
  };
}

// During rapid background loading many tables finish in quick succession and
// each one triggers status/table emits. Throttle those non-phase-change emits
// to avoid UI flicker, while always flushing immediately on phase transitions
// and explicit load completion.
const EMIT_THROTTLE_MS = 300;
let loadAllInProgress = false;

function isBackgroundIndexing(): boolean {
  return state.phase === 'indexing-secondary' || loadAllInProgress;
}

interface EmitThrottle {
  timer: ReturnType<typeof setTimeout> | null;
  last: number;
}

const statusThrottle: EmitThrottle = { timer: null, last: 0 };
const tablesThrottle: EmitThrottle = { timer: null, last: 0 };

function shouldThrottleEmits(): boolean {
  return isBackgroundIndexing();
}

function throttleEmit(throttle: EmitThrottle, emit: () => void, force: boolean): void {
  if (force || !shouldThrottleEmits()) {
    if (throttle.timer !== null) {
      clearTimeout(throttle.timer);
      throttle.timer = null;
    }
    throttle.last = Date.now();
    emit();
    return;
  }

  const now = Date.now();
  const elapsed = now - throttle.last;
  if (elapsed >= EMIT_THROTTLE_MS) {
    throttle.last = now;
    emit();
    return;
  }
  if (throttle.timer === null) {
    throttle.timer = setTimeout(() => {
      throttle.timer = null;
      throttle.last = Date.now();
      emit();
    }, EMIT_THROTTLE_MS - elapsed);
  }
}

function emitStatus(force = false): void {
  throttleEmit(statusThrottle, () => {
    post({ type: 'status', status: currentStatus() });
  }, force);
}

function emitTables(force = false): void {
  throttleEmit(tablesThrottle, () => {
    post({ type: 'tables', tables: [...tableStatuses.values()] });
  }, force);
}

function currentCatalog(): FilterCatalog {
  // Season/source counts and labels are derived from enriched entries.
  ensureIndexEnriched();

  const categories: FilterOption[] = [...categoryNameMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  rebuildSeasonMetadata();
  const seasons = buildSeasonOptions();
  const sources = buildSourceOptions();

  const catalog: FilterCatalog = { categories };
  if (seasons.length > 0) catalog.seasons = seasons;
  if (sources.length > 0) catalog.sources = sources;
  return catalog;
}

function buildSeasonOptions(): FilterOption[] {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    if (entry.seasonNumber === undefined) continue;
    counts.set(entry.seasonNumber, (counts.get(entry.seasonNumber) ?? 0) + 1);
  }

  const options: FilterOption[] = [];
  for (const [seasonNumber, name] of [...seasonNameByNumber.entries()].sort(
    (a, b) => b[0] - a[0],
  )) {
    if (seasonNumber < 1) continue;
    const shortName = name ? formatShortSeasonName(name) : '';
    options.push({
      value: seasonNumber,
      label: shortName ? `S${seasonNumber} · ${shortName}` : `Season ${seasonNumber}`,
      count: counts.get(seasonNumber) ?? 0,
    });
  }
  return options;
}

function buildSourceOptions(): SourceFilterOption[] {
  const d2ai = getD2aiMappings();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const tags = entry.sourceTags;
    if (!tags || tags.length === 0) continue;
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const options: SourceFilterOption[] = [];
  for (const [key, count] of counts) {
    if (count <= 0) continue;
    const aliases = d2ai.sourceAliasesByKey[key];
    const option: SourceFilterOption = {
      key,
      label: d2ai.sourceLabels[key] ?? key,
      count,
    };
    if (aliases && aliases.length > 0) option.aliases = aliases;
    options.push(option);
  }
  options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return options;
}

function emitCatalog(): void {
  post({ type: 'catalog', catalog: currentCatalog() });
}

// ---------------------------------------------------------------------------
// Index bookkeeping
// ---------------------------------------------------------------------------

function rebuildEntryLookups(): void {
  entriesByTableAndHash.clear();
  entryByHash.clear();
  tablesByHash.clear();
  categoryNameMap.clear();
  for (const entry of entries) {
    indexOneEntry(entry);
  }
}

function indexOneEntry(entry: SearchIndexEntry): void {
  entriesByTableAndHash.set(`${entry.table}:${entry.hash}`, entry);
  const existing = entryByHash.get(entry.hash);
  if (
    !existing ||
    (entry.table === INVENTORY_ITEM_TABLE && existing.table !== INVENTORY_ITEM_TABLE)
  ) {
    entryByHash.set(entry.hash, entry);
  }
  let tables = tablesByHash.get(entry.hash);
  if (!tables) {
    tables = new Set<string>();
    tablesByHash.set(entry.hash, tables);
  }
  tables.add(entry.table);
  if (entry.table === CATEGORY_TABLE && entry.name) {
    categoryNameMap.set(entry.hash, entry.name);
  }
}

function appendEntries(newEntries: SearchIndexEntry[]): void {
  for (const entry of newEntries) {
    entries.push(entry);
    indexOneEntry(entry);
  }
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Derive a season number from a trait id such as `season_25` or `season25`. */
function seasonNumberFromTraits(traitIds: readonly string[] | undefined): number | undefined {
  if (!traitIds) return undefined;
  for (const trait of traitIds) {
    const match = trait.match(/(?:^|[_-])season[_-]?(\d+)$/);
    if (match) {
      const num = Number(match[1]);
      if (Number.isInteger(num) && num >= 1) return num;
    }
  }
  return undefined;
}

/** Resolve the display identity of a seasonal artifact item hash. */
function lookupArtifactIdentity(
  artifactItemHash: number,
): { hash: number; name: string; icon?: string } | undefined {
  const indexed = entriesByTableAndHash.get(`${INVENTORY_ITEM_TABLE}:${artifactItemHash}`);
  if (indexed?.name) {
    return {
      hash: artifactItemHash,
      name: indexed.name,
      ...(indexed.icon ? { icon: indexed.icon } : {}),
    };
  }
  const rawArtifact =
    tableDataMap.get('DestinyInventoryItemLiteDefinition')?.[String(artifactItemHash)] ??
    tableDataMap.get(INVENTORY_ITEM_TABLE)?.[String(artifactItemHash)];
  if (rawArtifact) {
    const name = asString(asRecord(rawArtifact.displayProperties)?.name);
    if (name) {
      const icon =
        asString(asRecord(rawArtifact.displayProperties)?.icon) ?? asString(rawArtifact.icon);
      return { hash: artifactItemHash, name, ...(icon ? { icon } : {}) };
    }
  }
  return undefined;
}

/** Rebuild season metadata maps from the loaded DestinySeasonDefinition data. */
function rebuildSeasonMetadata(): void {
  seasonNumberByHash.clear();
  seasonNameByNumber.clear();
  watermarkSeasonByIcon.clear();
  seasonArtifactByNumber.clear();

  const data = tableDataMap.get('DestinySeasonDefinition');
  if (data) {
    for (const [hashKey, raw] of Object.entries(data)) {
      const seasonNumber = asNumber(raw.seasonNumber);
      if (seasonNumber === undefined) continue;
      const hash = toUnsignedHash(Number(hashKey));
      seasonNumberByHash.set(hash, seasonNumber);
      if (seasonNumber > latestSeasonNumber) latestSeasonNumber = seasonNumber;

      if (seasonNumber >= 1 && !seasonNameByNumber.has(seasonNumber)) {
        const rawName = asString(asRecord(raw.displayProperties)?.name)?.trim();
        const name =
          rawName || SEASON_ALIASES[seasonNumber]?.fallbackName || `Season ${seasonNumber}`;
        if (name) seasonNameByNumber.set(seasonNumber, name);
      }

      const watermark =
        asString(asRecord(raw.displayProperties)?.iconWatermark) ?? asString(raw.iconWatermark);
      if (watermark) watermarkSeasonByIcon.set(watermark, seasonNumber);

      const artifactItemHash = asUnsigned(raw.artifactItemHash);
      if (artifactItemHash !== undefined && !seasonArtifactByNumber.has(seasonNumber)) {
        const identity = lookupArtifactIdentity(artifactItemHash);
        if (identity) seasonArtifactByNumber.set(seasonNumber, identity);
      }
    }
  }

  // Cached boots have no raw table data in memory; reconstruct names/numbers
  // from the already-indexed season definition entries so the seasons catalog
  // and `season:<name>` search keep working without a full reload.
  if (seasonNameByNumber.size === 0) {
    for (const entry of entries) {
      if (entry.table !== 'DestinySeasonDefinition' || entry.seasonNumber === undefined) continue;
      if (entry.seasonNumber >= 1 && !seasonNameByNumber.has(entry.seasonNumber)) {
        seasonNameByNumber.set(
          entry.seasonNumber,
          (entry.name && entry.name.trim()) ||
            SEASON_ALIASES[entry.seasonNumber]?.fallbackName ||
            `Season ${entry.seasonNumber}`,
        );
      }
    }
  }
}

/** Rebuild the set of hashes belonging to the active seasonal artifact. */
function rebuildArtifactHashes(): void {
  artifactItemHashes.clear();
  const data = tableDataMap.get('DestinyArtifactDefinition');
  if (!data) return;

  let activeHash: number | undefined;
  let activeIndex = -1;
  const perkHashes = new Set<number>();

  for (const [hashKey, raw] of Object.entries(data)) {
    const hash = toUnsignedHash(Number(hashKey));
    const index = asNumber(raw.index) ?? 0;
    if (index >= activeIndex) {
      activeIndex = index;
      activeHash = hash;
    }

    const tiers = raw.tiers;
    if (!Array.isArray(tiers)) continue;
    for (const tier of tiers) {
      const items = asRecord(tier)?.items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const itemHash = asUnsigned(asRecord(item)?.itemHash);
        if (itemHash !== undefined) perkHashes.add(itemHash);
      }
    }
  }

  if (activeHash !== undefined) artifactItemHashes.add(activeHash);
  for (const hash of perkHashes) artifactItemHashes.add(hash);
}

/** Collect canonical DIM source tags for an entry from item/source hash mappings. */
function collectSourceTagsForEntry(
  entry: SearchIndexEntry,
  d2ai: ReturnType<typeof getD2aiMappings>,
  collectibles: Record<string, Record<string, unknown>> | undefined,
): string[] | undefined {
  const tags = new Set<string>();

  const fromItem = d2ai.itemHashToSourceTags.get(entry.hash);
  if (fromItem) {
    for (const tag of fromItem) tags.add(tag);
  }

  if (entry.collectibleHash !== undefined && collectibles) {
    const collectible = collectibles[String(entry.collectibleHash)];
    const sourceHash = asUnsigned(collectible?.sourceHash);
    if (sourceHash !== undefined) {
      const fromSource = d2ai.sourceHashToSourceTags.get(sourceHash);
      if (fromSource) {
        for (const tag of fromSource) tags.add(tag);
      }
    }
  }

  if (entry.table === 'DestinyCollectibleDefinition' && collectibles) {
    const raw = collectibles[String(entry.hash)];
    const sourceHash = asUnsigned(raw?.sourceHash);
    if (sourceHash !== undefined) {
      const fromSource = d2ai.sourceHashToSourceTags.get(sourceHash);
      if (fromSource) {
        for (const tag of fromSource) tags.add(tag);
      }
    }
  }

  return tags.size > 0 ? [...tags] : undefined;
}

interface EnrichmentLookups {
  d2ai: ReturnType<typeof getD2aiMappings>;
  collectibles: Record<string, Record<string, unknown>> | undefined;
}

function currentEnrichmentLookups(): EnrichmentLookups {
  return {
    d2ai: getD2aiMappings(),
    collectibles: tableDataMap.get('DestinyCollectibleDefinition'),
  };
}

/**
 * Fill in the per-entry portions of cross-table enrichment: season number (via
 * watermark, item hash, collectible source, season hash or trait ids), crafting
 * and artifact membership, and collectible source strings. Idempotent and
 * order-independent, so it works whether the item or the referenced table
 * loads first.
 */
function enrichEntry(entry: SearchIndexEntry, lookups: EnrichmentLookups): void {
  const { d2ai, collectibles } = lookups;

  // Resolve season number in priority order (existing value wins).
  if (entry.seasonNumber === undefined && entry.iconWatermark) {
    const fromWatermark = d2ai.watermarkToSeason[entry.iconWatermark];
    if (fromWatermark !== undefined) entry.seasonNumber = fromWatermark;
  }
  if (entry.seasonNumber === undefined && entry.table === INVENTORY_ITEM_TABLE) {
    const fromItemHash = d2ai.itemHashToSeason[String(entry.hash)];
    if (fromItemHash !== undefined) entry.seasonNumber = fromItemHash;
  }
  if (entry.seasonNumber === undefined && entry.collectibleHash !== undefined && collectibles) {
    const collectible = collectibles[String(entry.collectibleHash)];
    const sourceHash = asUnsigned(collectible?.sourceHash);
    if (sourceHash !== undefined) {
      const fromSource = d2ai.sourceHashToSeason[String(sourceHash)];
      if (fromSource !== undefined) entry.seasonNumber = fromSource;
    }
  }
  if (entry.seasonNumber === undefined && entry.seasonHash !== undefined) {
    const number = seasonNumberByHash.get(entry.seasonHash);
    if (number !== undefined) entry.seasonNumber = number;
  }
  if (entry.seasonNumber === undefined) {
    const fromTrait = seasonNumberFromTraits(entry.traitIds);
    if (fromTrait !== undefined) entry.seasonNumber = fromTrait;
  }
  if (entry.seasonNumber === undefined && entry.iconWatermark) {
    const number = watermarkSeasonByIcon.get(entry.iconWatermark);
    if (number !== undefined) entry.seasonNumber = number;
  }

  if (entry.table === INVENTORY_ITEM_TABLE && d2ai.craftableHashes.has(entry.hash)) {
    entry.isCraftable = true;
  }

  if (artifactItemHashes.has(entry.hash)) entry.isArtifact = true;

  if (entry.sourceLower === undefined && entry.collectibleHash !== undefined && collectibles) {
    const collectible = collectibles[String(entry.collectibleHash)];
    const source = asString(collectible?.sourceString) ?? asString(collectible?.displaySource);
    if (source) entry.sourceLower = normalizeSearchText(source);
  }

  const sourceTags = collectSourceTagsForEntry(entry, d2ai, collectibles);
  if (sourceTags && sourceTags.length > 0) entry.sourceTags = sourceTags;
  else entry.sourceTags = undefined;
}

/**
 * Attach parent artifact metadata to an artifact perk. Requires season metadata
 * (seasonArtifactByNumber / latestSeasonNumber) to be settled first.
 */
function attachParentArtifact(entry: SearchIndexEntry): void {
  if (entry.isArtifactPerk !== true) return;
  let parent =
    entry.seasonNumber !== undefined ? seasonArtifactByNumber.get(entry.seasonNumber) : undefined;
  if (parent === undefined && artifactItemHashes.has(entry.hash)) {
    parent = seasonArtifactByNumber.get(latestSeasonNumber);
  }
  if (parent) {
    entry.parentArtifactHash = parent.hash;
    entry.parentArtifactName = parent.name;
    if (parent.icon) entry.parentArtifactIcon = parent.icon;
  }
}

/**
 * Fill in cross-table metadata on the in-memory search entries before they are
 * persisted. Runs a full pass over the index, so it is only invoked when a
 * dependency table changed (or on the first persist), never once per
 * background table.
 */
function enrichIndexedEntries(): void {
  rebuildSeasonMetadata();
  rebuildArtifactHashes();

  const lookups = currentEnrichmentLookups();
  for (const entry of entries) enrichEntry(entry, lookups);
  recomputeLatestSeasonFromEntries();

  // Second pass: attach parent artifact metadata once season numbers are settled.
  for (const entry of entries) attachParentArtifact(entry);

  syncArtifactPerksTableStatus();

  fullEnrichmentPending = false;
  indexDirty = true;
}

/**
 * Enrich only the entries a background table just added. Used for tables that
 * have no cross-table enrichment impact, so Stage 3 never rescans all ~277k
 * entries per table.
 */
function enrichNewEntries(newEntries: readonly SearchIndexEntry[]): void {
  if (newEntries.length === 0) return;
  const lookups = currentEnrichmentLookups();
  for (const entry of newEntries) {
    enrichEntry(entry, lookups);
    if (entry.seasonNumber !== undefined && entry.seasonNumber > latestSeasonNumber) {
      latestSeasonNumber = entry.seasonNumber;
    }
  }
  for (const entry of newEntries) attachParentArtifact(entry);
  addArtifactPerksToStatus(newEntries);
}

function recomputeLatestSeasonFromEntries(): void {
  latestSeasonNumber = 0;
  for (const entry of entries) {
    if (entry.seasonNumber !== undefined && entry.seasonNumber > latestSeasonNumber) {
      latestSeasonNumber = entry.seasonNumber;
    }
  }
  for (const seasonNumber of seasonNameByNumber.keys()) {
    if (seasonNumber > latestSeasonNumber) latestSeasonNumber = seasonNumber;
  }
}

function setArtifactPerksTableStatus(count: number): void {
  tableStatuses.set(ARTIFACT_PERKS_TABLE, {
    name: ARTIFACT_PERKS_TABLE,
    shortName: 'Artifact Perks',
    group: 'primary',
    count,
    loaded: true,
    loading: false,
    indexed: true,
    hasFullData: true,
  });
}

/** Maintain the virtual ArtifactPerks table status from the indexed entries. */
function syncArtifactPerksTableStatus(): void {
  let count = 0;
  for (const entry of entries) {
    if (entry.isArtifactPerk === true) count += 1;
  }
  setArtifactPerksTableStatus(count);
}

/** Fold freshly indexed entries into the ArtifactPerks count without a rescan. */
function addArtifactPerksToStatus(newEntries: readonly SearchIndexEntry[]): void {
  let added = 0;
  for (const entry of newEntries) {
    if (entry.isArtifactPerk === true) added += 1;
  }
  if (added === 0) return;
  const status = tableStatuses.get(ARTIFACT_PERKS_TABLE);
  if (!status) {
    syncArtifactPerksTableStatus();
    return;
  }
  setArtifactPerksTableStatus(status.count + added);
}

/**
 * Ensure every indexed entry has current cross-table metadata. At most one full
 * pass runs per enrichment dependency change.
 */
function ensureIndexEnriched(): void {
  if (!fullEnrichmentPending) return;
  enrichIndexedEntries();
}

/**
 * Coalesce async writes into at most one in-flight run while still starting a
 * fresh run for every call made after the previous run settled.
 *
 * The in-flight slot is filled before the write body can run (the body starts
 * on a microtask) and is cleared only when it still points at that run. Clearing
 * it from a synchronous `finally` inside the run meant an already-clean run
 * (which never awaited) cleared the slot *before* it was assigned, pinning a
 * settled promise in the slot forever: every later persist then resolved
 * without touching IndexedDB, so `Ready · 98/98` could be shown while only the
 * Stage 2 snapshot was durable and a reload had to re-index 83 tables.
 */
export function createCoalescedWriter(write: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const run = Promise.resolve().then(write);
    inFlight = run;
    const clear = (): void => {
      if (inFlight === run) inFlight = null;
    };
    void run.then(clear, clear);
    return run;
  };
}

/**
 * Write the in-memory search index to IndexedDB. Concurrent callers share the
 * in-flight write, and the loop re-runs if entries changed mid-write, so at
 * most one structured clone/write is ever in flight.
 */
const runSearchIndexWrite = createCoalescedWriter(async () => {
  try {
    while (indexDirty || fullEnrichmentPending) {
      ensureIndexEnriched();
      indexDirty = false;
      const committed = await putSearchIndex(state.locale, state.versionSignature, {
        entries,
        indexedTables: [...indexedTables],
        schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      });
      if (!committed) {
        // Keep the index dirty so the next flush retries the snapshot instead
        // of reporting `ready` for a write that never reached IndexedDB.
        indexDirty = true;
        return;
      }
      lastPersistAt = Date.now();
      tablesSincePersist = 0;
    }
  } catch (error) {
    indexDirty = true;
    console.error('[manifest] Failed to write the search index:', error);
  }
});

async function persistSearchIndex(): Promise<void> {
  await runSearchIndexWrite();
}

/**
 * Force a committed snapshot of the current search index. Every transition to
 * `phase: 'ready'` goes through this so a reload immediately afterwards boots
 * from the full cache rather than resuming background indexing.
 */
async function flushSearchIndex(): Promise<void> {
  for (let attempt = 0; attempt < SEARCH_INDEX_PERSIST_ATTEMPTS; attempt += 1) {
    await persistSearchIndex();
    if (!indexDirty && !fullEnrichmentPending) return;
  }
  console.error('[manifest] Search index still has unpersisted changes after flushing');
}

/**
 * Stage 3 batching: write after every `SEARCH_INDEX_PERSIST_TABLE_BATCH` tables
 * or once `SEARCH_INDEX_PERSIST_INTERVAL_MS` elapsed; otherwise leave the dirty
 * index for the next batch or the final flush. Outside background indexing a
 * single user-triggered table load persists immediately.
 */
async function maybePersistSearchIndex(): Promise<void> {
  if (
    isBackgroundIndexing() &&
    !shouldFlushSearchIndex(tablesSincePersist, lastPersistAt, Date.now())
  ) {
    return;
  }
  await persistSearchIndex();
}

function getOrCreateTableStatus(table: string): TableStatus {
  let status = tableStatuses.get(table);
  if (!status) {
    status = {
      name: table,
      shortName: getShortTableName(table),
      group: getTableGroup(table),
      count: 0,
      loaded: false,
      loading: false,
      indexed: false,
      hasFullData: false,
    };
    tableStatuses.set(table, status);
  }
  return status;
}

function resetEngineState(): void {
  entries = [];
  indexedTables.clear();
  entriesByTableAndHash.clear();
  entryByHash.clear();
  tablesByHash.clear();
  tableStatuses.clear();
  tableDataMap.clear();
  fullItemLru.clear();
  categoryNameMap.clear();
  loadingPromises.clear();
  fullItemCount = 0;
  fullEnrichmentPending = true;
  indexDirty = false;
  tablesSincePersist = 0;
  lastPersistAt = 0;
}

function applyCachedState(
  meta: ManifestMeta,
  cached: SearchIndexCache,
): void {
  state.version = meta.version;
  state.versionSignature = meta.versionSignature;
  state.componentPaths = meta.componentPaths;
  state.fromCache = true;
  state.initialized = true;
  entries = cached.entries;
  indexedTables.clear();
  for (const table of cached.indexedTables) indexedTables.add(table);
  rebuildEntryLookups();
  recomputeLatestSeasonFromEntries();
  for (const table of Object.keys(meta.componentPaths)) getOrCreateTableStatus(table);
  for (const table of cached.indexedTables) getOrCreateTableStatus(table);
  // Indexed tables are fully restored from IndexedDB, so they must report as
  // loaded with their real entry counts. Leaving them unloaded is what made a
  // cache boot show 0/98 tables and a download icon on every row.
  for (const cachedTable of deriveCachedTableStatuses(
    meta.componentPaths,
    cached.indexedTables,
    cached.entries,
  )) {
    const status = getOrCreateTableStatus(cachedTable.name);
    status.indexed = cachedTable.indexed;
    status.loaded = cachedTable.loaded;
    status.loading = false;
    status.count = cachedTable.count;
  }
  syncArtifactPerksTableStatus();
  // The cached snapshot was written after a full enrichment pass by the prior
  // session, so no re-enrichment is needed until a dependency table changes.
  fullEnrichmentPending = false;
  indexDirty = false;
  tablesSincePersist = 0;
  lastPersistAt = Date.now();
}

export interface CachedTableState {
  name: string;
  count: number;
  indexed: boolean;
  loaded: boolean;
}

/**
 * Derive the per-table status for an IndexedDB cache boot.
 *
 * Search index entries carry the canonical table name (Lite inventory entries
 * are folded into DestinyInventoryItemDefinition), so counts must be tallied
 * through `canonicalTableName`, not the raw indexed table list. The Lite and
 * full inventory tables describe the same definitions, so indexing either one
 * makes both statuses loaded with the canonical entry count.
 */
export function deriveCachedTableStatuses(
  componentPaths: Readonly<Record<string, string>>,
  cachedIndexedTables: readonly string[],
  cachedEntries: readonly SearchIndexEntry[],
): CachedTableState[] {
  const countsByTable = new Map<string, number>();
  for (const entry of cachedEntries) {
    const canonical = canonicalTableName(entry.table);
    countsByTable.set(canonical, (countsByTable.get(canonical) ?? 0) + 1);
  }

  const cachedTables = new Set<string>();
  for (const table of cachedIndexedTables) cachedTables.add(table);
  if (
    cachedTables.has(INVENTORY_ITEM_TABLE) ||
    cachedTables.has(INVENTORY_ITEM_LITE_TABLE)
  ) {
    cachedTables.add(INVENTORY_ITEM_TABLE);
    cachedTables.add(INVENTORY_ITEM_LITE_TABLE);
  }

  const tableNames = new Set<string>(Object.keys(componentPaths));
  for (const table of cachedIndexedTables) tableNames.add(table);

  const statuses: CachedTableState[] = [];
  for (const table of tableNames) {
    if (!cachedTables.has(table)) continue;
    statuses.push({
      name: table,
      count: countsByTable.get(table) ?? countsByTable.get(canonicalTableName(table)) ?? 0,
      indexed: true,
      loaded: true,
    });
  }
  return statuses;
}

/**
 * Number of cached search entries for the canonical inventory table. Lite and
 * full inventory entries both canonicalize to DestinyInventoryItemDefinition.
 */
function countInventoryEntries(): number {
  let count = 0;
  for (const entry of entries) {
    if (canonicalTableName(entry.table) === INVENTORY_ITEM_TABLE) count += 1;
  }
  return count;
}

/**
 * Cache boots restore item summaries only; the full-item buckets live in a
 * separate IndexedDB store. Verify them asynchronously so the canonical
 * inventory table reports `hasFullData` accurately without delaying the
 * instant cache boot.
 */
async function refreshCachedFullItemStatus(): Promise<void> {
  if (!state.componentPaths[INVENTORY_ITEM_TABLE]) return;
  const status = getOrCreateTableStatus(INVENTORY_ITEM_TABLE);
  if (status.hasFullData || status.loading) return;
  const hasFull = await hasFullItemsCached(state.locale, state.versionSignature);
  if (!hasFull || status.hasFullData || status.loading) return;
  status.hasFullData = true;
  status.loaded = true;
  if (status.count === 0) status.count = countInventoryEntries();
  emitStatus();
  emitTables();
}

// ---------------------------------------------------------------------------
// Init / loading
// ---------------------------------------------------------------------------

async function init(
  localeInput: string,
  apiKey?: string,
  forceRefresh = false,
): Promise<ManifestStatus> {
  const locale = localeInput as BungieLocale;
  state.locale = locale;
  state.apiKey = apiKey;
  state.error = undefined;

  // Stage 1: boot instantly from cache if available.
  if (!forceRefresh) {
    const meta = await getMeta(locale);
    const cached = meta ? await getSearchIndex(locale, meta.versionSignature) : undefined;
    const cachedIsCurrent = cached?.schemaVersion === SEARCH_INDEX_SCHEMA_VERSION;
    if (meta && cachedIsCurrent) {
      applyCachedState(meta, cached);
      // Full inventory buckets are stored separately from the search index;
      // verify them in the background so cached boots stay instant.
      void refreshCachedFullItemStatus();
      state.phase = 'ready';
      emitStatus(true);
      emitTables(true);
      emitCatalog();
      void backgroundUpdateCheck();
      void refreshD2aiMappingsFromRemote().then((updated) => {
        if (updated) {
          enrichIndexedEntries();
          emitCatalog();
          void persistSearchIndex();
        }
      });
      // Resume background indexing for tables a prior visit did not finish.
      void resumeBackgroundIndexing();
      return currentStatus();
    }
  }

  // Stage 2: cold boot / forced refresh.
  resetEngineState();
  state.phase = 'fetching-index';
  state.currentTable = undefined;
  emitStatus(true);

  const index = await fetchManifestIndex(locale, apiKey);
  const paths = index.Response.jsonWorldComponentContentPaths[locale] ?? {};
  const version = index.Response.version;
  const versionSignature = computeVersionSignature(paths);

  await putMeta(locale, {
    version,
    versionSignature,
    componentPaths: paths,
    fetchedAt: Date.now(),
  });
  await purgeOldVersions(locale, versionSignature);

  state.version = version;
  state.versionSignature = versionSignature;
  state.componentPaths = paths;
  state.fromCache = false;
  state.initialized = true;

  for (const table of Object.keys(paths)) getOrCreateTableStatus(table);

  state.phase = 'loading-core';
  emitStatus(true);
  emitTables(true);

  // Item categories are required for search filtering, so load them up front.
  const coreTables = [...CORE_BOOT_TABLES];
  if (!coreTables.includes(CATEGORY_TABLE)) coreTables.push(CATEGORY_TABLE);
  await loadTablesInParallel(coreTables, 4);

  // Persist before flipping to `ready`: a reload the instant the UI says Ready
  // must read this snapshot back, not an older one.
  await flushSearchIndex();
  state.phase = 'ready';
  emitStatus(true);
  emitTables(true);
  emitCatalog();

  // Future-proof the mappings with a non-blocking remote refresh.
  void refreshD2aiMappingsFromRemote().then((updated) => {
    if (updated) {
      enrichIndexedEntries();
      emitCatalog();
      void persistSearchIndex();
    }
  });

  // Stage 3: background secondary + remaining-table indexing.
  state.phase = 'indexing-secondary';
  emitStatus(true);
  void (async () => {
    try {
      await loadTablesInParallel(SECONDARY_INDEX_TABLES, 4);
      emitCatalog();
      await indexRemainingTables();
    } finally {
      // Always leave a durable, fully enriched index before reporting ready.
      await flushSearchIndex();
      state.phase = 'ready';
      state.currentTable = undefined;
      emitStatus(true);
      emitTables(true);
      emitCatalog();
    }
  })();

  return currentStatus();
}

async function backgroundUpdateCheck(): Promise<void> {
  const result = await checkForUpdates();
  if (result.hasUpdate) {
    // Seamlessly rebuild with the newer manifest in the background.
    void init(state.locale, state.apiKey, true);
  }
}

/** Tables handled by the streaming full-item loader rather than the JSON path. */
const FULL_ITEM_TABLES = new Set<string>([
  INVENTORY_ITEM_TABLE,
  INVENTORY_ITEM_LITE_TABLE,
]);

/** Tables in componentPaths that are not yet indexed (and not full-item tables). */
function computeRemainingTables(): string[] {
  const remaining: string[] = [];
  for (const table of Object.keys(state.componentPaths)) {
    if (indexedTables.has(table)) continue;
    if (FULL_ITEM_TABLES.has(table)) continue;
    remaining.push(table);
  }
  return remaining;
}

/** Stage 3: cache + index every remaining manifest table in the background. */
async function indexRemainingTables(): Promise<void> {
  const remaining = computeRemainingTables();
  if (remaining.length === 0) return;
  await loadTablesInParallel(remaining, 4);
  await flushSearchIndex();
  emitCatalog();
}

/** Resume Stage 3 on a cached boot when a prior visit stopped partway through. */
async function resumeBackgroundIndexing(): Promise<void> {
  if (computeRemainingTables().length === 0) return;
  state.phase = 'indexing-secondary';
  emitStatus(true);
  try {
    await indexRemainingTables();
  } finally {
    // Flush any batched writes before the UI reports a completed index.
    await flushSearchIndex();
    state.phase = 'ready';
    state.currentTable = undefined;
    emitStatus(true);
    emitTables(true);
    emitCatalog();
  }
}

async function loadTablesInParallel(
  tables: readonly string[],
  concurrency: number,
): Promise<void> {
  const queue = [...tables];
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      (async () => {
        for (;;) {
          const next = queue.shift();
          if (next === undefined) return;
          try {
            await loadTable(next);
          } catch (error) {
            console.error(`Failed to load ${next}:`, error);
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
}

async function loadTable(table: string, explicit = false): Promise<void> {
  if (table === ARTIFACT_PERKS_TABLE) return;
  const status = getOrCreateTableStatus(table);
  if (status.hasFullData) return;
  const inFlight = loadingPromises.get(table);
  if (inFlight) {
    await inFlight;
    return;
  }
  status.loading = true;
  emitTables();
  const promise = doLoadTable(table, explicit);
  loadingPromises.set(table, promise);
  try {
    await promise;
  } finally {
    loadingPromises.delete(table);
    status.loading = false;
    emitTables(explicit);
  }
}

async function doLoadTable(table: string, explicit: boolean): Promise<void> {
  const status = getOrCreateTableStatus(table);
  const path = state.componentPaths[table];
  if (!path) throw new Error(`No component path for table ${table}`);

  if (table === INVENTORY_ITEM_TABLE) {
    state.currentTable = table;
    emitStatus();
    // Full inventory data lives in per-item IndexedDB buckets. If those
    // buckets are already cached, never re-download the (very large) table.
    if (await hasFullItemsCached(state.locale, state.versionSignature)) {
      status.loaded = true;
      status.hasFullData = true;
      status.indexed =
        indexedTables.has(table) || indexedTables.has(INVENTORY_ITEM_LITE_TABLE);
      if (status.count === 0) status.count = countInventoryEntries();
      state.currentTable = undefined;
    } else {
      const res = await fetchComponentResponse(path);
      if (!res.body) throw new Error(`No response body for ${table}`);
      await streamIntoBuckets(res.body);
      status.loaded = true;
      status.hasFullData = true;
      status.count = fullItemCount;
      status.indexed =
        indexedTables.has(table) || indexedTables.has(INVENTORY_ITEM_LITE_TABLE);
      state.currentTable = undefined;
    }
  } else {
    state.currentTable = table;
    emitStatus();
    // The table store is keyed by manifest version signature: reuse a table
    // already on disk instead of re-downloading it from Bungie. Cache boots
    // restore only the search summaries, so this is the hot path for loading
    // raw definitions of a table that is already indexed.
    let data = await getTableData(state.locale, state.versionSignature, table);
    if (!data) {
      data = await fetchComponentJson(path);
      await putTableData(state.locale, state.versionSignature, table, data);
    }
    tableDataMap.set(table, data);
    status.loaded = true;
    status.hasFullData = true;
    status.count = Object.keys(data).length;
    state.currentTable = undefined;

    const enrichmentDependency = isEnrichmentDependencyTable(table);
    let indexedNewTable = false;
    if (!indexedTables.has(table)) {
      const newEntries = buildEntries(table, data);
      appendEntries(newEntries);
      indexedTables.add(table);
      status.indexed = true;
      indexedNewTable = true;
      indexDirty = true;
      if (enrichmentDependency) {
        // Dependency data just landed: one full pass makes it visible to every
        // entry, and the coalesced persist below flushes it.
        fullEnrichmentPending = true;
      } else {
        // Tables with no cross-table impact only need their own new entries
        // enriched, avoiding a full ~277k-entry rescan per table.
        enrichNewEntries(newEntries);
      }
      // Collectible-derived source tags + source counts become available the
      // moment collectibles land, so refresh the filter catalog immediately.
      if (table === 'DestinyCollectibleDefinition') emitCatalog();
    } else {
      status.indexed = true;
      if (enrichmentDependency) {
        // Raw data for an already-indexed dependency table can unlock more
        // cross-table metadata for entries indexed earlier.
        fullEnrichmentPending = true;
        indexDirty = true;
      }
    }

    if (indexedNewTable || enrichmentDependency) {
      if (indexedNewTable) tablesSincePersist += 1;
      await maybePersistSearchIndex();
    }
  }
  emitTables(explicit);
  emitStatus(explicit);
}

function buildEntries(
  table: string,
  data: Record<string, Record<string, unknown>>,
): SearchIndexEntry[] {
  const out: SearchIndexEntry[] = [];
  for (const [hashKey, raw] of Object.entries(data)) {
    out.push(extractTableEntrySummary(table, hashKey, raw));
  }
  return out;
}

async function streamIntoBuckets(body: ReadableStream<Uint8Array>): Promise<void> {
  const locale = state.locale;
  const signature = state.versionSignature;
  let pending: Array<readonly [number, string]> = [];
  let pendingBytes = 0;

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    pendingBytes = 0;
    await putFullItemEntries(locale, signature, batch);
  };

  const count = await streamTopLevelJsonObject(
    body,
    async (batch) => {
      for (const [key, raw] of batch) {
        const parsedKey = Number(key);
        if (!Number.isFinite(parsedKey)) continue;
        const hash = toUnsignedHash(parsedKey);
        const waiters = fullItemWaiters.get(hash);
        if (waiters && waiters.length > 0) {
          fullItemWaiters.delete(hash);
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            setLru(hash, parsed);
            for (const resolve of waiters) resolve(parsed);
          } catch {
            // Ignore malformed entry.
          }
        }
        pending.push([hash, raw]);
        pendingBytes += raw.length;
      }
      if (pending.length >= STREAM_FLUSH_ENTRIES || pendingBytes >= STREAM_FLUSH_BYTES) {
        await flush();
      }
    },
    500,
  );

  await flush();
  fullItemCount = count;
}

async function loadAllTables(): Promise<void> {
  loadAllInProgress = true;
  // `ready` must mean "the cache I just read is durable". While this
  // user-triggered load changes the index, report the busy phase and only
  // return to `ready` after the final flush commits.
  const wasReady = state.phase === 'ready';
  if (wasReady) {
    state.phase = 'indexing-secondary';
    emitStatus(true);
  }
  try {
    const all = Object.keys(state.componentPaths);
    const remaining = all.filter((table) => !getOrCreateTableStatus(table).loaded);
    await loadTablesInParallel(remaining, 4);
    emitCatalog();
  } finally {
    loadAllInProgress = false;
    await flushSearchIndex();
    if (wasReady) {
      state.phase = 'ready';
      state.currentTable = undefined;
    }
    emitStatus(true);
    emitTables(true);
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function search(
  query: string,
  filters: SearchFilters,
  sort: SortMode,
  maxResults?: number,
  fuzzy?: FuzzySearchOptions,
  precedence?: QueryPrecedence,
): Promise<SearchResponse> {
  const availableTables = [...Object.keys(state.componentPaths), ARTIFACT_PERKS_TABLE];
  const parsed = parseSearchQuery(query, availableTables, precedence);
  const d2ai = getD2aiMappings();
  return scoreAndFilterEntries(
    entries,
    parsed,
    filters,
    sort,
    categoryNameMap,
    maxResults,
    {
      latestSeason: latestSeasonNumber,
      seasonNameMap: seasonNameByNumber,
      seasonAliases: SEASON_ALIASES,
      sourceAliasToKey: d2ai.sourceAliasToKey,
      fuzzy,
    },
  );
}

async function getFilterCatalog(): Promise<FilterCatalog> {
  return currentCatalog();
}

// ---------------------------------------------------------------------------
// Deep JSON search
// ---------------------------------------------------------------------------

const DEEP_SEARCH_TERM_RE = /(?:[^\s",;]+|"[^"]*")+/g;
const DEEP_MATCH_PREVIEW_MAX = 120;

function parseDeepSearchTerms(query: string): string[] {
  const terms: string[] = [];
  const matches = query.match(DEEP_SEARCH_TERM_RE) ?? [];
  for (const raw of matches) {
    const token = raw.trim();
    if (!token) continue;
    let body = token;
    if (body.startsWith('-') && body.length > 1) body = body.slice(1);
    if (body.length >= 2 && body.startsWith('"') && body.endsWith('"')) {
      body = body.slice(1, -1);
    }
    const phrase = body.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!phrase) continue;
    if (!terms.includes(phrase)) terms.push(phrase);
  }
  return terms;
}

function matchesAllTerms(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLowerCase();
  for (const term of terms) {
    if (!lower.includes(term)) return false;
  }
  return true;
}

function truncateString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Walk a parsed definition and return the first path whose value matches all terms. */
function findDeepMatch(value: unknown, terms: string[], path: string): DeepMatchSnippet | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).toLowerCase();
    if (terms.every((term) => text.includes(term))) {
      return { path, preview: truncateString(String(value), DEEP_MATCH_PREVIEW_MAX) };
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const childPath = path ? `${path}[${i}]` : `[${i}]`;
      const found = findDeepMatch(value[i], terms, childPath);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    const childPath = path ? `${path}.${key}` : key;
    const found = findDeepMatch(child, terms, childPath);
    if (found) return found;
  }
  return undefined;
}

function entryToResult(entry: SearchIndexEntry): SearchResultItem {
  const item: SearchResultItem = {
    hash: entry.hash,
    table: entry.table,
    name: entry.name,
    subtitle: entry.subtitle,
  };
  if (entry.icon !== undefined) item.icon = entry.icon;
  if (entry.iconWatermark !== undefined) item.iconWatermark = entry.iconWatermark;
  if (entry.tierType !== undefined) item.tierType = entry.tierType;
  if (entry.damageType !== undefined) item.damageType = entry.damageType;
  if (entry.classType !== undefined) item.classType = entry.classType;
  if (entry.isRedacted !== undefined) item.isRedacted = entry.isRedacted;
  if (entry.isEnhanced !== undefined) item.isEnhanced = entry.isEnhanced;
  if (entry.index !== undefined) item.index = entry.index;
  return item;
}

interface DeepScanState {
  items: SearchResultItem[];
  totalMatches: number;
  cap: number;
}

function scanTableForDeepSearch(
  table: string,
  data: Record<string, Record<string, unknown>>,
  terms: string[],
  scan: DeepScanState,
  onlyArtifactPerks = false,
): void {
  for (const [hashKey, raw] of Object.entries(data)) {
    if (onlyArtifactPerks) {
      const entry = extractTableEntrySummary(table, hashKey, raw);
      if (entry.isArtifactPerk !== true) continue;
      if (!matchesAllTerms(JSON.stringify(raw), terms)) continue;
      scan.totalMatches += 1;
      if (scan.items.length >= scan.cap) continue;
      const item = entryToResult(entry);
      const deepMatch = findDeepMatch(raw, terms, '');
      if (deepMatch) item.deepMatch = deepMatch;
      scan.items.push(item);
      continue;
    }
    // Fast pre-filter on the serialized definition before walking the object.
    if (!matchesAllTerms(JSON.stringify(raw), terms)) continue;
    scan.totalMatches += 1;
    if (scan.items.length >= scan.cap) continue;
    const entry = extractTableEntrySummary(table, hashKey, raw);
    const item = entryToResult(entry);
    const deepMatch = findDeepMatch(raw, terms, '');
    if (deepMatch) item.deepMatch = deepMatch;
    scan.items.push(item);
  }
}

async function scanFullItemsForDeepSearch(
  terms: string[],
  scan: DeepScanState,
  onlyArtifactPerks = false,
): Promise<void> {
  await iterateFullItems(state.locale, state.versionSignature, (hash, rawJson) => {
    if (onlyArtifactPerks) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawJson) as Record<string, unknown>;
      } catch {
        return;
      }
      const entry = extractTableEntrySummary(INVENTORY_ITEM_TABLE, String(hash), parsed);
      if (entry.isArtifactPerk !== true) return;
      if (!matchesAllTerms(rawJson, terms)) return;
      scan.totalMatches += 1;
      if (scan.items.length >= scan.cap) return;
      const item = entryToResult(entry);
      const deepMatch = findDeepMatch(parsed, terms, '');
      if (deepMatch) item.deepMatch = deepMatch;
      scan.items.push(item);
      return;
    }
    if (!matchesAllTerms(rawJson, terms)) return;
    scan.totalMatches += 1;
    if (scan.items.length >= scan.cap) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      return;
    }
    const entry = extractTableEntrySummary(INVENTORY_ITEM_TABLE, String(hash), parsed);
    const item = entryToResult(entry);
    const deepMatch = findDeepMatch(parsed, terms, '');
    if (deepMatch) item.deepMatch = deepMatch;
    scan.items.push(item);
  });
}

async function deepSearch(
  query: string,
  filters: SearchFilters,
  maxResults?: number,
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const terms = parseDeepSearchTerms(query);
  const cap =
    maxResults !== undefined && maxResults > 0 ? Math.floor(maxResults) : 200;
  const scan: DeepScanState = { items: [], totalMatches: 0, cap };

  if (terms.length === 0) {
    return { items: [], totalMatches: 0, durationMs: Date.now() - startedAt };
  }

  const requestedTable =
    filters.table && filters.table !== 'all' && filters.table !== '' ? filters.table : undefined;

  if (requestedTable) {
    if (requestedTable === ARTIFACT_PERKS_TABLE) {
      if (await hasFullItemsCached(state.locale, state.versionSignature)) {
        await scanFullItemsForDeepSearch(terms, scan, true);
      } else {
        const lite = tableDataMap.get('DestinyInventoryItemLiteDefinition');
        if (lite) {
          scanTableForDeepSearch('DestinyInventoryItemLiteDefinition', lite, terms, scan, true);
        }
      }
    } else if (requestedTable === INVENTORY_ITEM_TABLE) {
      if (await hasFullItemsCached(state.locale, state.versionSignature)) {
        await scanFullItemsForDeepSearch(terms, scan);
      } else {
        const lite = tableDataMap.get('DestinyInventoryItemLiteDefinition');
        if (lite) scanTableForDeepSearch('DestinyInventoryItemLiteDefinition', lite, terms, scan);
      }
    } else {
      const mem = tableDataMap.get(requestedTable);
      if (mem) {
        scanTableForDeepSearch(requestedTable, mem, terms, scan);
      } else {
        const idb = await getTableData(state.locale, state.versionSignature, requestedTable);
        if (idb) {
          tableDataMap.set(requestedTable, idb);
          scanTableForDeepSearch(requestedTable, idb, terms, scan);
        }
      }
    }
  } else {
    const hasFull = await hasFullItemsCached(state.locale, state.versionSignature);
    for (const [table, data] of tableDataMap) {
      // Prefer the full item buckets over the reduced Lite table when available.
      if (table === 'DestinyInventoryItemLiteDefinition' && hasFull) continue;
      scanTableForDeepSearch(table, data, terms, scan);
    }
    if (hasFull) await scanFullItemsForDeepSearch(terms, scan);
  }

  return {
    items: scan.items,
    totalMatches: scan.totalMatches,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Definition inspector
// ---------------------------------------------------------------------------

function touchLru(hash: number): void {
  const value = fullItemLru.get(hash);
  if (value !== undefined) {
    fullItemLru.delete(hash);
    fullItemLru.set(hash, value);
  }
}

function setLru(hash: number, value: Record<string, unknown>): void {
  fullItemLru.delete(hash);
  fullItemLru.set(hash, value);
  while (fullItemLru.size > FULL_ITEM_LRU_LIMIT) {
    const oldest = fullItemLru.keys().next().value;
    if (oldest === undefined) break;
    fullItemLru.delete(oldest);
  }
}

async function tryReadFullItem(hash: number): Promise<Record<string, unknown> | undefined> {
  const cached = fullItemLru.get(hash);
  if (cached) {
    touchLru(hash);
    return cached;
  }
  const raw = await getFullItemRaw(state.locale, state.versionSignature, hash);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    setLru(hash, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

async function ensureFullItem(hash: number): Promise<void> {
  const existing = await tryReadFullItem(hash);
  if (existing) return;

  const earlyHit = new Promise<void>((resolve) => {
    const list = fullItemWaiters.get(hash) ?? [];
    list.push(() => resolve());
    fullItemWaiters.set(hash, list);
  });

  const streamPromise = loadTable(INVENTORY_ITEM_TABLE);
  const recheck = await tryReadFullItem(hash);
  if (recheck) {
    fullItemWaiters.delete(hash);
    return;
  }

  await Promise.race([earlyHit, streamPromise]);
}

function maybeLoadFullTableInBackground(): void {
  const status = getOrCreateTableStatus(INVENTORY_ITEM_TABLE);
  if (status.hasFullData || status.loading) return;
  void loadTable(INVENTORY_ITEM_TABLE).catch(() => undefined);
}

function buildLiteData(entry: SearchIndexEntry): Record<string, unknown> {
  const rawLite = tableDataMap.get('DestinyInventoryItemLiteDefinition')?.[String(entry.hash)];
  if (rawLite) {
    return { hash: entry.hash, ...rawLite };
  }
  const displayProperties: Record<string, unknown> = {
    name: entry.name,
    description: '',
    hasIcon: Boolean(entry.icon),
  };
  if (entry.icon) displayProperties.icon = entry.icon;

  const data: Record<string, unknown> = {
    hash: entry.hash,
    displayProperties,
    itemTypeAndTierDisplayName: entry.subtitle,
  };
  if (entry.iconWatermark) data.iconWatermark = entry.iconWatermark;
  if (entry.index !== undefined) data.index = entry.index;
  if (entry.tierType !== undefined) data.inventory = { tierType: entry.tierType };
  if (entry.itemType !== undefined) data.itemType = entry.itemType;
  if (entry.itemSubType !== undefined) data.itemSubType = entry.itemSubType;
  if (entry.classType !== undefined) data.classType = entry.classType;
  if (entry.damageType !== undefined) data.defaultDamageType = entry.damageType;
  if (entry.itemCategoryHashes) data.itemCategoryHashes = entry.itemCategoryHashes;
  if (entry.isRedacted !== undefined) data.redacted = entry.isRedacted;
  if (entry.isAdept !== undefined) data.isAdept = entry.isAdept;
  return data;
}

async function getDefinition(
  table: string,
  hashInput: number,
  preferFull = false,
): Promise<DefinitionDetailPayload> {
  const hash = toUnsignedHash(hashInput);

  if (table === INVENTORY_ITEM_TABLE) {
    const full = await tryReadFullItem(hash);
    if (full) return buildDetail(table, hash, full, false);

    if (preferFull) {
      await ensureFullItem(hash);
      const reloaded = await tryReadFullItem(hash);
      if (reloaded) return buildDetail(table, hash, reloaded, false);
    }

    let entry =
      entriesByTableAndHash.get(`${INVENTORY_ITEM_TABLE}:${hash}`) ?? entryByHash.get(hash);
    if (!entry) {
      const liteTable = 'DestinyInventoryItemLiteDefinition';
      const liteInFlight = loadingPromises.get(liteTable);
      if (liteInFlight) {
        await liteInFlight;
      } else if (
        !indexedTables.has(INVENTORY_ITEM_TABLE) &&
        state.componentPaths[liteTable]
      ) {
        await loadTable(liteTable);
      }
      entry =
        entriesByTableAndHash.get(`${INVENTORY_ITEM_TABLE}:${hash}`) ?? entryByHash.get(hash);
    }
    if (!entry) {
      await ensureFullItem(hash);
      const reloaded = await tryReadFullItem(hash);
      if (reloaded) return buildDetail(table, hash, reloaded, false);
      throw new Error(`Unknown item hash ${hash}`);
    }
    maybeLoadFullTableInBackground();
    return buildDetail(table, hash, buildLiteData(entry), true);
  }

  let data = tableDataMap.get(table)?.[String(hash)];
  if (!data) {
    const idb = await getTableData(state.locale, state.versionSignature, table);
    if (idb) {
      tableDataMap.set(table, idb);
      data = idb[String(hash)];
    }
  }
  if (!data) {
    await loadTable(table);
    data = tableDataMap.get(table)?.[String(hash)];
  }
  if (!data) throw new Error(`Definition ${hash} not found in ${table}`);
  return buildDetail(table, hash, data, false);
}

async function buildDetail(
  table: string,
  hash: number,
  data: Record<string, unknown>,
  isLite: boolean,
): Promise<DefinitionDetailPayload> {
  const payload: DefinitionDetailPayload = {
    table,
    hash,
    data,
    coTables: computeCoTables(hash, table),
    resolvedRefs: collectResolvedRefs(data),
  };
  if (isLite) {
    payload.isLite = true;
    if (table === INVENTORY_ITEM_TABLE) {
      const entry = entriesByTableAndHash.get(`${INVENTORY_ITEM_TABLE}:${hash}`);
      if (entry?.isArtifactPerk && entry.parentArtifactHash && entry.parentArtifactName) {
        payload.overview = {
          parentArtifact: {
            hash: entry.parentArtifactHash,
            name: entry.parentArtifactName,
            ...(entry.parentArtifactIcon ? { icon: entry.parentArtifactIcon } : {}),
          },
        };
      }
    }
  } else if (table === INVENTORY_ITEM_TABLE) {
    payload.overview = await buildInventoryItemOverview(hash, data);
  }
  return payload;
}

function computeCoTables(hash: number, currentTable: string): string[] {
  const tables = tablesByHash.get(hash);
  if (!tables) return [];
  return [...tables].filter((table) => table !== currentTable);
}

function toSummary(entry: SearchIndexEntry): ResolvedHashSummary {
  const summary: ResolvedHashSummary = {
    table: entry.table,
    hash: entry.hash,
    name: entry.name,
    subtitle: entry.subtitle,
  };
  if (entry.icon) summary.icon = entry.icon;
  if (entry.tierType !== undefined) summary.tierType = entry.tierType;
  return summary;
}

function resolveHash(hash: number, targetTables: string[]): ResolvedHashSummary | undefined {
  if (targetTables.length > 0) {
    for (const table of targetTables) {
      const entry = entriesByTableAndHash.get(`${table}:${hash}`);
      if (entry) return toSummary(entry);
    }
    return undefined;
  }
  const fallback = entryByHash.get(hash);
  if (fallback) return toSummary(fallback);
  return undefined;
}

function recordResolvedRef(
  refs: Record<string, ResolvedHashSummary>,
  summary: ResolvedHashSummary,
): void {
  refs[`${summary.table}:${summary.hash}`] = summary;
  // Bare-hash fallback so the JSON inspector can resolve every hash even when
  // the target table is unknown. Keep the first/primary match under the bare key.
  if (refs[String(summary.hash)] === undefined) {
    refs[String(summary.hash)] = summary;
  }
}

function recordRef(
  refs: Record<string, ResolvedHashSummary>,
  fieldName: string,
  parentKey: string | undefined,
  hash: number,
): void {
  const targetTables = getTargetTablesForField(fieldName, parentKey);
  const summary = resolveHash(hash, targetTables);
  if (summary) recordResolvedRef(refs, summary);
}

function recordObjectKeyRef(
  refs: Record<string, ResolvedHashSummary>,
  parentKey: string | undefined,
  hash: number,
): void {
  const targetTables = getTargetTablesForObjectKey(parentKey);
  const summary = resolveHash(hash, targetTables);
  if (summary) recordResolvedRef(refs, summary);
}

function walkForRefs(
  value: unknown,
  parentKey: string | undefined,
  refs: Record<string, ResolvedHashSummary>,
  depth: number,
): void {
  if (depth > 24 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walkForRefs(item, parentKey, refs, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    // Numeric object keys identify hash-keyed collections
    // (`stats.stats["..."], objectives, perks, items, nodes, ...`).
    if (/^\d+$/.test(key)) {
      const numericKey = Number(key);
      if (numericKey > 1000) recordObjectKeyRef(refs, parentKey, toUnsignedHash(numericKey));
      if (typeof child === 'object' && child !== null) {
        walkForRefs(child, parentKey, refs, depth + 1);
      }
      continue;
    }

    // Resolve every numeric field that maps to a known target table — not just
    // fields ending in Hash/Hashes (covers `setItems`, hash arrays, ...).
    const targetTables = getTargetTablesForField(key, parentKey);
    if (targetTables.length > 0) {
      if (typeof child === 'number' && Number.isFinite(child)) {
        recordRef(refs, key, parentKey, toUnsignedHash(child));
        continue;
      }
      if (Array.isArray(child)) {
        for (const item of child) {
          const hash = asUnsigned(item);
          if (hash !== undefined) recordRef(refs, key, parentKey, hash);
        }
        continue;
      }
    }

    if (typeof child === 'object' && child !== null) {
      walkForRefs(child, key, refs, depth + 1);
    }
  }
}

function collectResolvedRefs(data: Record<string, unknown>): Record<string, ResolvedHashSummary> {
  const refs: Record<string, ResolvedHashSummary> = {};
  walkForRefs(data, undefined, refs, 0);
  return refs;
}

/** Read a definition from memory or IndexedDB without triggering a load. */
async function readDefinitionData(
  table: string,
  hash: number,
): Promise<Record<string, unknown> | undefined> {
  if (table === INVENTORY_ITEM_TABLE) {
    const cached = fullItemLru.get(hash);
    if (cached) return cached;
    const raw = await getFullItemRaw(state.locale, state.versionSignature, hash);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setLru(hash, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }
  const mem = tableDataMap.get(table)?.[String(hash)];
  if (mem) return mem;
  const idb = await getTableData(state.locale, state.versionSignature, table);
  if (idb) {
    tableDataMap.set(table, idb);
    return idb[String(hash)];
  }
  return undefined;
}

function displayName(definition: Record<string, unknown> | undefined, fallback: string): string {
  return asString(asRecord(definition?.displayProperties)?.name) ?? fallback;
}

// ---------------------------------------------------------------------------
// Overview builders
// ---------------------------------------------------------------------------

async function buildInventoryItemOverview(
  hash: number,
  data: Record<string, unknown>,
): Promise<DefinitionOverview> {
  const overview: DefinitionOverview = {};

  const flavorText = asString(data.flavorText);
  if (flavorText) overview.flavorText = flavorText;
  const displaySource = asString(data.displaySource);
  if (displaySource) overview.displaySource = displaySource;
  const screenshot = asString(data.screenshot);
  if (screenshot) overview.screenshot = screenshot;

  // Damage type.
  const damageType = asUnsigned(data.defaultDamageTypeHash ?? data.defaultDamageType);
  if (damageType !== undefined) {
    const damageDef = await readDefinitionData('DestinyDamageTypeDefinition', damageType);
    const damageIcon = asString(asRecord(damageDef?.displayProperties)?.icon);
    overview.damageType = {
      hash: damageType,
      name: displayName(damageDef, String(damageType)),
      enumValue: asNumber(data.defaultDamageType) ?? asNumber(data.defaultDamageTypeHash) ?? 0,
      icon: damageIcon ? bungieAssetUrl(damageIcon) : undefined,
    };
  }

  const tierName = asString(data.itemTypeAndTierDisplayName);
  if (tierName) overview.tierName = tierName;

  // Class name (3 = Unknown / any class — omit for universal items).
  const classType = asNumber(data.classType);
  if (classType !== undefined && classType !== 3) {
    const classDef = await readDefinitionData('DestinyClassDefinition', classType);
    const className = asString(asRecord(classDef?.displayProperties)?.name);
    overview.className = className ?? annotate('classType', classType);
  }

  // Ammo type.
  const ammoType = asNumber(asRecord(data.equippingBlock)?.ammoType);
  if (ammoType !== undefined) {
    overview.ammoType = annotate('ammoType', ammoType);
  }

  // Categories.
  const categoryHashes = asNumberArray(data.itemCategoryHashes);
  if (categoryHashes.length > 0) {
    overview.categories = categoryHashes.map((hash) => ({
      hash,
      name: categoryNameMap.get(hash) ?? String(hash),
    }));
  }

  overview.stats = await buildStats(data);
  overview.socketCategories = await buildSocketCategories(data);
  overview.perks = await buildPerks(data);
  overview.lore = await buildLore(data);

  const collectibleHash = asUnsigned(data.collectibleHash);
  if (collectibleHash !== undefined) {
    const collectible = await readDefinitionData('DestinyCollectibleDefinition', collectibleHash);
    if (collectible) {
      overview.collectible = {
        hash: collectibleHash,
        name: displayName(collectible, String(collectibleHash)),
        sourceString: asString(collectible.sourceString) ?? '',
      };
    }
  }

  overview.linkedEntities = await buildLinkedEntities(data);

  const entry = entriesByTableAndHash.get(`${INVENTORY_ITEM_TABLE}:${hash}`);
  if (entry?.isArtifactPerk && entry.parentArtifactHash && entry.parentArtifactName) {
    overview.parentArtifact = {
      hash: entry.parentArtifactHash,
      name: entry.parentArtifactName,
      ...(entry.parentArtifactIcon ? { icon: entry.parentArtifactIcon } : {}),
    };
  }

  return overview;
}

function annotate(field: string, value: number): string | undefined {
  return annotateEnumField(field, value)?.label;
}

async function buildStats(
  data: Record<string, unknown>,
): Promise<OverviewStat[] | undefined> {
  const stats = asRecord(asRecord(data.stats)?.stats);
  if (!stats) return undefined;
  const out: OverviewStat[] = [];
  for (const [key, raw] of Object.entries(stats)) {
    const stat = asRecord(raw);
    const hash = toUnsignedHash(Number(key));
    const value = asNumber(stat?.value) ?? 0;
    const rawMax = asNumber(stat?.maximumValue) ?? 0;
    const statDef = await readDefinitionData('DestinyStatDefinition', hash);
    const name = asString(asRecord(statDef?.displayProperties)?.name)?.trim();
    if (!name) continue;
    const description = asString(asRecord(statDef?.displayProperties)?.description);
    const effectiveMax = rawMax > 0 ? rawMax : 100;
    const isBar = value > 0 && value <= effectiveMax && effectiveMax <= 100;
    const item: OverviewStat = {
      statHash: hash,
      name,
      value,
      maximumValue: effectiveMax,
      isBar,
    };
    if (description) item.description = description;
    out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

async function buildSocketCategories(
  data: Record<string, unknown>,
): Promise<OverviewSocketCategory[] | undefined> {
  const sockets = asRecord(data.sockets);
  const socketEntries = asRecordArray(sockets?.socketEntries);
  const socketCategories = asRecordArray(sockets?.socketCategories);
  if (!socketEntries || socketEntries.length === 0) return undefined;

  const out: OverviewSocketCategory[] = [];
  const categorySource = socketCategories ?? [];
  for (const category of categorySource) {
    const categoryHash = asUnsigned(category.socketCategoryHash) ?? 0;
    const indexes = asNumberArray(category.socketIndexes);
    const categoryDef =
      categoryHash !== 0
        ? await readDefinitionData('DestinySocketCategoryDefinition', categoryHash)
        : undefined;
    const item: OverviewSocketCategory = {
      categoryHash,
      name: displayName(categoryDef, String(categoryHash)),
      sockets: [],
    };
    const description = asString(asRecord(categoryDef?.displayProperties)?.description);
    if (description) item.description = description;

    for (const index of indexes) {
      const entry = socketEntries[index];
      if (!entry) continue;
      item.sockets.push(await buildSocket(entry, index));
    }
    out.push(item);
  }

  // Include any sockets that were not captured by an explicit category.
  const covered = new Set<number>();
  for (const category of categorySource) {
    for (const index of asNumberArray(category.socketIndexes)) covered.add(index);
  }
  const uncategorized = socketEntries
    .map((_, index) => index)
    .filter((index) => !covered.has(index));
  if (uncategorized.length > 0) {
    const others: OverviewSocketCategory = {
      categoryHash: 0,
      name: 'Other Sockets',
      sockets: [],
    };
    for (const index of uncategorized) {
      const entry = socketEntries[index];
      if (!entry) continue;
      others.sockets.push(await buildSocket(entry, index));
    }
    out.push(others);
  }

  return out.length > 0 ? out : undefined;
}

async function buildSocket(
  entry: Record<string, unknown>,
  socketIndex: number,
): Promise<OverviewSocket> {
  const socketTypeHash = asUnsigned(entry.socketTypeHash);
  const socketTypeDef =
    socketTypeHash !== undefined
      ? await readDefinitionData('DestinySocketTypeDefinition', socketTypeHash)
      : undefined;
  const socketTypeName =
    displayName(socketTypeDef, socketTypeHash !== undefined ? String(socketTypeHash) : '') ||
    `Socket ${socketIndex}`;

  const plugs: OverviewSocketPlug[] = [];
  let singleInitialPlug: OverviewSocketPlug | undefined;

  const reusablePlugSetHash = asUnsigned(entry.reusablePlugSetHash);
  const randomizedPlugSetHash = asUnsigned(entry.randomizedPlugSetHash);
  const plugSetHashes: number[] = [];
  if (reusablePlugSetHash !== undefined) plugSetHashes.push(reusablePlugSetHash);
  if (randomizedPlugSetHash !== undefined) plugSetHashes.push(randomizedPlugSetHash);

  for (const plugSetHash of plugSetHashes) {
    const plugSet = await readDefinitionData('DestinyPlugSetDefinition', plugSetHash);
    const items = asRecordArray(plugSet?.reusablePlugItems);
    if (!items) continue;
    for (const item of items) {
      const plug = await buildPlug(item.plugItemHash, {
        currentlyCanRoll: plugSetHash === randomizedPlugSetHash,
      });
      if (plug) plugs.push(plug);
    }
  }

  const singleHash = asUnsigned(entry.singleInitialItemHash);
  if (singleHash !== undefined) {
    singleInitialPlug = await buildPlug(singleHash, { isDefault: true });
  }

  const inlineItems = asRecordArray(entry.reusablePlugItems);
  if (inlineItems) {
    for (const item of inlineItems) {
      const plug = await buildPlug(item.plugItemHash, { currentlyCanRoll: true });
      if (plug) plugs.push(plug);
    }
  }

  const socket: OverviewSocket = { socketIndex, socketTypeName, plugs };
  if (singleInitialPlug) socket.singleInitialPlug = singleInitialPlug;
  if (reusablePlugSetHash !== undefined) socket.plugSetHash = reusablePlugSetHash;
  if (randomizedPlugSetHash !== undefined) socket.isRandomized = true;
  return socket;
}

async function buildPlug(
  plugItemHash: unknown,
  options: { isDefault?: boolean; currentlyCanRoll?: boolean } = {},
): Promise<OverviewSocketPlug | undefined> {
  const hash = asUnsigned(plugItemHash);
  if (hash === undefined) return undefined;
  const definition = await readDefinitionData(INVENTORY_ITEM_TABLE, hash);
  const entry = entriesByTableAndHash.get(`${INVENTORY_ITEM_TABLE}:${hash}`);
  const displayProperties = asRecord(definition?.displayProperties);
  const icon = asString(displayProperties?.icon);
  const plug: OverviewSocketPlug = {
    hash,
    name: displayName(definition, entry?.name ?? String(hash)),
    itemTypeDisplayName:
      asString(definition?.itemTypeDisplayName) ?? entry?.subtitle ?? '',
    description: asString(displayProperties?.description) ?? '',
  };
  if (icon) plug.icon = bungieAssetUrl(icon);
  else if (entry?.icon) plug.icon = entry.icon;
  const tierType = asNumber(asRecord(definition?.inventory)?.tierType) ?? entry?.tierType;
  if (tierType !== undefined) plug.tierType = tierType;
  if (entry?.isEnhanced !== undefined) plug.isEnhanced = entry.isEnhanced;
  if (options.isDefault !== undefined) plug.isDefault = options.isDefault;
  if (options.currentlyCanRoll !== undefined) plug.currentlyCanRoll = options.currentlyCanRoll;
  return plug;
}

async function collectReferencedPlugHashes(
  data: Record<string, unknown>,
): Promise<number[]> {
  const sockets = asRecord(data.sockets);
  const socketEntries = asRecordArray(sockets?.socketEntries);
  if (!socketEntries) return [];
  const result = new Set<number>();
  for (const entry of socketEntries) {
    const single = asUnsigned(entry.singleInitialItemHash);
    if (single !== undefined) result.add(single);

    const inlineItems = asRecordArray(entry.reusablePlugItems);
    if (inlineItems) {
      for (const item of inlineItems) {
        const hash = asUnsigned(item.plugItemHash);
        if (hash !== undefined) result.add(hash);
      }
    }

    const reusablePlugSetHash = asUnsigned(entry.reusablePlugSetHash);
    const randomizedPlugSetHash = asUnsigned(entry.randomizedPlugSetHash);
    for (const plugSetHash of [reusablePlugSetHash, randomizedPlugSetHash]) {
      if (plugSetHash === undefined) continue;
      const plugSet = await readDefinitionData('DestinyPlugSetDefinition', plugSetHash);
      const items = asRecordArray(plugSet?.reusablePlugItems);
      if (!items) continue;
      for (const item of items) {
        const hash = asUnsigned(item.plugItemHash);
        if (hash !== undefined) result.add(hash);
      }
    }
  }
  return [...result];
}

async function buildPerks(data: Record<string, unknown>): Promise<OverviewPerk[] | undefined> {
  const plugHashes = await collectReferencedPlugHashes(data);
  const perks: OverviewPerk[] = [];
  const seen = new Set<number>();
  for (const plugHash of plugHashes) {
    const plug = await readDefinitionData(INVENTORY_ITEM_TABLE, plugHash);
    const perkEntries = asRecordArray(plug?.perks);
    if (!perkEntries) continue;
    for (const perkEntry of perkEntries) {
      const perkHash = asUnsigned(perkEntry.perkHash);
      if (perkHash === undefined || seen.has(perkHash)) continue;
      seen.add(perkHash);
      const perkDef = await readDefinitionData('DestinySandboxPerkDefinition', perkHash);
      const displayProperties = asRecord(perkDef?.displayProperties);
      const perk: OverviewPerk = {
        perkHash,
        name: displayName(perkDef, String(perkHash)),
        description: asString(displayProperties?.description) ?? '',
      };
      const icon = asString(displayProperties?.icon);
      if (icon) perk.icon = bungieAssetUrl(icon);
      perks.push(perk);
      if (perks.length >= 64) break;
    }
    if (perks.length >= 64) break;
  }
  return perks.length > 0 ? perks : undefined;
}

async function buildLore(data: Record<string, unknown>): Promise<OverviewLore | undefined> {
  const loreHash = asUnsigned(data.loreHash);
  if (loreHash === undefined) return undefined;
  const lore = await readDefinitionData('DestinyLoreDefinition', loreHash);
  if (!lore) return undefined;
  const displayProperties = asRecord(lore.displayProperties);
  return {
    loreHash,
    name: displayName(lore, String(loreHash)),
    subtitle: asString(lore.subtitle) ?? '',
    description: asString(displayProperties?.description) ?? '',
  };
}

async function buildLinkedEntities(
  data: Record<string, unknown>,
): Promise<OverviewLinkedEntity[] | undefined> {
  const links: Array<[table: string, relation: string, raw: unknown]> = [
    ['DestinyPlugSetDefinition', 'plugSet', data.plugSetHash],
    ['DestinyCollectibleDefinition', 'collectible', data.collectibleHash],
    ['DestinyRecordDefinition', 'record', data.recordHash],
    ['DestinyPresentationNodeDefinition', 'presentationNode', data.presentationNodeHash],
    ['DestinyActivityDefinition', 'activity', data.activityHash],
    ['DestinyVendorDefinition', 'vendor', data.vendorHash],
    ['DestinyInventoryItemDefinition', 'item', data.itemHash],
    ['DestinySeasonDefinition', 'season', data.seasonHash],
  ];
  const linked: OverviewLinkedEntity[] = [];
  for (const [table, relation, raw] of links) {
    const hash = asUnsigned(raw);
    if (hash === undefined) continue;
    const definition = await readDefinitionData(table, hash);
    const entry = entriesByTableAndHash.get(`${table}:${hash}`);
    const icon = asString(asRecord(definition?.displayProperties)?.icon);
    linked.push({
      table,
      hash,
      name: displayName(definition, entry?.name ?? String(hash)),
      subtitle: entry?.subtitle ?? getFriendlyTableName(table),
      icon: icon ? bungieAssetUrl(icon) : entry?.icon,
      relation,
    });
  }
  return linked.length > 0 ? linked : undefined;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const VARIANT_SUFFIXES = ['(Adept)', '(Timelost)', '(Harrowed)', '(Brave)', '(Enhanced)'];

function normalizeBaseName(name: string): string {
  let out = name.trim();
  const lower = out.toLowerCase();
  for (const suffix of VARIANT_SUFFIXES) {
    if (lower.endsWith(suffix.toLowerCase())) {
      out = out.slice(0, out.length - suffix.length).trim();
      break;
    }
  }
  return out.toLowerCase();
}

function toVariantItem(entry: SearchIndexEntry): VariantItem {
  const item: VariantItem = {
    hash: entry.hash,
    table: entry.table,
    name: entry.name,
    subtitle: entry.subtitle,
  };
  if (entry.icon) item.icon = entry.icon;
  if (entry.iconWatermark) item.iconWatermark = entry.iconWatermark;
  if (entry.tierType !== undefined) item.tierType = entry.tierType;
  if (entry.damageType !== undefined) item.damageType = entry.damageType;
  if (entry.isAdept !== undefined) item.isAdept = entry.isAdept;
  if (entry.isHolofoil !== undefined) item.isHolofoil = entry.isHolofoil;
  if (entry.isEnhanced !== undefined) item.isEnhanced = entry.isEnhanced;
  if (entry.isRedacted !== undefined) item.isRedacted = entry.isRedacted;
  if (entry.index !== undefined) item.index = entry.index;
  return item;
}

async function getVariants(table: string, hashInput: number): Promise<VariantItem[]> {
  const hash = toUnsignedHash(hashInput);
  const target =
    entriesByTableAndHash.get(`${table}:${hash}`) ?? entryByHash.get(hash);
  const baseName = target?.name ? normalizeBaseName(target.name) : undefined;
  if (!baseName) return [];

  const variants: VariantItem[] = [];
  for (const entry of entries) {
    if (entry.table !== table || !entry.name) continue;
    if (normalizeBaseName(entry.name) === baseName) {
      variants.push(toVariantItem(entry));
    }
  }
  variants.sort((a, b) => {
    if (a.hash === hash) return -1;
    if (b.hash === hash) return 1;
    return a.name.localeCompare(b.name);
  });
  return variants;
}

// ---------------------------------------------------------------------------
// Reverse references
// ---------------------------------------------------------------------------

function scanForHash(
  value: unknown,
  target: number,
  sourceHash: number,
  path: string,
  paths: string[],
): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    if (toUnsignedHash(value) === target) paths.push(path);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanForHash(value[i], target, sourceHash, `${path}[${i}]`, paths);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      // A definition's own root `hash` field must never count as a self-reference.
      if (childPath === 'hash' && sourceHash === target) continue;
      scanForHash(child, target, sourceHash, childPath, paths);
    }
  }
}

function groupReference(
  groups: Map<string, ReverseReference>,
  sourceTable: string,
  sourceHash: number,
  paths: string[],
): void {
  const key = `${sourceTable}:${sourceHash}`;
  let group = groups.get(key);
  if (!group) {
    const entry = entriesByTableAndHash.get(key) ?? entryByHash.get(sourceHash);
    group = {
      sourceTable,
      sourceHash,
      sourceName: entry?.name ?? String(sourceHash),
      sourceSubtitle: entry?.subtitle ?? '',
      sourceIcon: entry?.icon,
      paths: [],
    };
    groups.set(key, group);
  }
  group.paths.push(...paths);
}

async function getReverseReferences(
  targetHashInput: number,
  targetTable?: string,
  tablesToScan?: string[],
): Promise<ReverseReferenceResponse> {
  const start = performance.now();
  const target = toUnsignedHash(targetHashInput);
  const scannedTables: string[] = [];
  const unloadedPriorityTables: string[] = [];
  const groups = new Map<string, ReverseReference>();

  const scanTableData = (
    table: string,
    data: Record<string, Record<string, unknown>>,
  ): void => {
    scannedTables.push(table);
    for (const [hashKey, raw] of Object.entries(data)) {
      const sourceHash = toUnsignedHash(Number(hashKey));
      // Skip the definition being inspected so it never lists itself.
      if (table === targetTable && sourceHash === target) continue;
      const paths: string[] = [];
      scanForHash(raw, target, sourceHash, '', paths);
      if (paths.length > 0) groupReference(groups, table, sourceHash, paths);
    }
  };

  const scanFullItemBuckets = async (): Promise<void> => {
    scannedTables.push(INVENTORY_ITEM_TABLE);
    const targetNeedle = String(target);
    await iterateFullItems(state.locale, state.versionSignature, (sourceHash, rawJson) => {
      if (INVENTORY_ITEM_TABLE === targetTable && sourceHash === target) return;
      if (!rawJson.includes(targetNeedle)) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawJson) as Record<string, unknown>;
      } catch {
        return;
      }
      const paths: string[] = [];
      scanForHash(parsed, target, sourceHash, '', paths);
      if (paths.length > 0) {
        groupReference(groups, INVENTORY_ITEM_TABLE, sourceHash, paths);
      }
    });
  };

  if (tablesToScan && tablesToScan.length > 0) {
    for (const table of tablesToScan) {
      if (table === INVENTORY_ITEM_TABLE) {
        if (await hasFullItemsCached(state.locale, state.versionSignature)) {
          await scanFullItemBuckets();
        } else {
          unloadedPriorityTables.push(table);
        }
        continue;
      }
      const mem = tableDataMap.get(table);
      if (mem) {
        scanTableData(table, mem);
      } else {
        const idb = await getTableData(state.locale, state.versionSignature, table);
        if (idb) {
          tableDataMap.set(table, idb);
          scanTableData(table, idb);
        } else {
          unloadedPriorityTables.push(table);
        }
      }
    }
  } else {
    for (const [table, data] of tableDataMap) {
      scanTableData(table, data);
    }
    for (const table of REVERSE_REF_PRIORITY_TABLES) {
      if (table === INVENTORY_ITEM_TABLE) continue;
      if (scannedTables.includes(table)) continue;
      const mem = tableDataMap.get(table);
      if (mem) {
        scanTableData(table, mem);
        continue;
      }
      const idb = await getTableData(state.locale, state.versionSignature, table);
      if (idb) {
        tableDataMap.set(table, idb);
        scanTableData(table, idb);
      } else {
        unloadedPriorityTables.push(table);
      }
    }
    if (await hasFullItemsCached(state.locale, state.versionSignature)) {
      await scanFullItemBuckets();
    } else {
      unloadedPriorityTables.push(INVENTORY_ITEM_TABLE);
    }
  }

  return {
    references: [...groups.values()],
    scannedTables,
    unloadedPriorityTables,
    durationMs: performance.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Clarity community descriptions
// ---------------------------------------------------------------------------

function extractClarityLines(entry: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const descriptions = entry.descriptions;
  if (!Array.isArray(descriptions)) return lines;
  for (const description of descriptions) {
    const record = asRecord(description);
    if (!record) continue;
    const title = asString(record.title);
    const body = asString(record.simpleDescription) ?? asString(record.description);
    if (title) lines.push(title);
    if (body) {
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
      }
    }
  }
  return lines;
}

async function loadClarityMap(): Promise<Map<number, ClarityDescriptionEntry>> {
  if (!clarityPromise) {
    clarityPromise = (async () => {
      try {
        const res = await fetch(CLARITY_URL);
        if (!res.ok) return new Map<number, ClarityDescriptionEntry>();
        const json = (await res.json()) as Record<string, unknown>;
        const map = new Map<number, ClarityDescriptionEntry>();
        for (const [key, value] of Object.entries(json)) {
          const record = asRecord(value);
          if (!record) continue;
          const hash = toUnsignedHash(Number(key));
          map.set(hash, {
            hash,
            name: asString(record.name),
            type: asString(record.type),
            lastUpload: asNumber(record.lastUpload),
            uploadedBy: asString(record.uploadedBy),
            lines: extractClarityLines(record),
          });
        }
        return map;
      } catch {
        return new Map<number, ClarityDescriptionEntry>();
      }
    })();
  }
  return clarityPromise;
}

async function getClarityDescription(
  hashInput: number,
): Promise<ClarityDescriptionEntry | undefined> {
  const hash = toUnsignedHash(hashInput);
  const map = await loadClarityMap();
  return map.get(hash);
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const index = await fetchManifestIndex(state.locale, state.apiKey);
    const paths = index.Response.jsonWorldComponentContentPaths[state.locale] ?? {};
    const newSignature = computeVersionSignature(paths);
    state.lastCheckedAt = Date.now();
    emitStatus();
    if (newSignature && newSignature !== state.versionSignature) {
      return { hasUpdate: true, versionSignature: newSignature };
    }
    return { hasUpdate: false };
  } catch (error) {
    return { hasUpdate: false, error: toError(error).message };
  }
}

async function clearCache(): Promise<void> {
  await clearAllCache();
  resetEngineState();
  state.version = '';
  state.versionSignature = '';
  state.componentPaths = {};
  state.fromCache = false;
  state.phase = 'idle';
  state.initialized = false;
  emitStatus(true);
  emitTables(true);
}

async function getCacheStats(): Promise<CacheStatsResult> {
  const idb = await getCacheStatsFromIdb();
  let loaded = 0;
  for (const status of tableStatuses.values()) {
    if (status.name === ARTIFACT_PERKS_TABLE) continue;
    if (status.loaded) loaded += 1;
  }
  return {
    available: idb.available,
    tableCount: idb.tableCount,
    fullItemBucketCount: idb.fullItemBucketCount,
    searchIndexCount: idb.searchIndexCount,
    metaCount: idb.metaCount,
    indexedEntries: entries.length,
    loadedTables: loaded,
    fullItemsInLru: fullItemLru.size,
  };
}

async function resolveSummaries(
  refs: Array<{ table: string; hash: number }>,
): Promise<Record<string, ResolvedSummaryEntry>> {
  const result: Record<string, ResolvedSummaryEntry> = {};

  for (const ref of refs) {
    const unsigned = toUnsignedHash(ref.hash);
    const key = `${ref.table}:${unsigned}`;
    const coTables = tablesByHash.get(unsigned);
    const hasCoTables = coTables !== undefined && coTables.size > 1;

    const indexed = entriesByTableAndHash.get(key);
    if (indexed) {
      result[key] = {
        name: indexed.name,
        ...(indexed.icon ? { icon: indexed.icon } : {}),
        ...(hasCoTables ? { hasCoTables: true } : {}),
      };
      continue;
    }

    if (ref.table === INVENTORY_ITEM_TABLE) {
      const cachedFull = fullItemLru.get(unsigned);
      if (cachedFull) {
        const summary = extractTableEntrySummary(ref.table, String(unsigned), cachedFull);
        result[key] = {
          name: summary.name,
          ...(summary.icon ? { icon: summary.icon } : {}),
          ...(hasCoTables ? { hasCoTables: true } : {}),
        };
        continue;
      }
    }

    let raw = tableDataMap.get(ref.table)?.[String(unsigned)];
    if (!raw && state.versionSignature) {
      const idbTable = await getTableData(state.locale, state.versionSignature, ref.table);
      if (idbTable) {
        tableDataMap.set(ref.table, idbTable);
        raw = idbTable[String(unsigned)];
      }
    }
    if (raw) {
      const summary = extractTableEntrySummary(ref.table, String(unsigned), raw);
      result[key] = {
        name: summary.name,
        ...(summary.icon ? { icon: summary.icon } : {}),
        ...(hasCoTables ? { hasCoTables: true } : {}),
      };
    } else if (hasCoTables) {
      result[key] = { name: '', hasCoTables: true };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// RPC dispatch
// ---------------------------------------------------------------------------

async function dispatch(message: WorkerRequest): Promise<unknown> {
  switch (message.type) {
    case 'init':
      return init(message.locale, message.apiKey, message.forceRefresh);
    case 'search':
      return search(
        message.query,
        message.filters,
        message.sort,
        message.maxResults,
        message.fuzzy,
        message.precedence,
      );
    case 'deepSearch':
      return deepSearch(message.query, message.filters, message.maxResults);
    case 'getDefinition':
      return getDefinition(message.table, message.hash, message.preferFull);
    case 'loadTable':
      return loadTable(message.table, true);
    case 'loadAllTables':
      return loadAllTables();
    case 'getVariants':
      return getVariants(message.table, message.hash);
    case 'getReverseReferences':
      return getReverseReferences(message.targetHash, message.targetTable, message.tablesToScan);
    case 'getClarityDescription':
      return getClarityDescription(message.hash);
    case 'checkForUpdates':
      return checkForUpdates();
    case 'clearCache':
      return clearCache();
    case 'getCacheStats':
      return getCacheStats();
    case 'getFilterCatalog':
      return getFilterCatalog();
    case 'resolveSummaries':
      return resolveSummaries(message.refs);
  }
}

function respond(message: WorkerResponse): void {
  scope.postMessage(message);
}

async function handleRequest(message: WorkerRequest): Promise<void> {
  try {
    const result = await dispatch(message);
    respond({ id: message.id, ok: true, result });
  } catch (error) {
    respond({ id: message.id, ok: false, error: toError(error).message });
  }
}

scope.onmessage = (event: MessageEvent): void => {
  const message = event.data as WorkerRequest | undefined;
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
  void handleRequest(message);
};
