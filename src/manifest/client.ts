/**
 * Typed singleton RPC client for the Manifest Engine Web Worker.
 *
 * Spawns a module worker and correlates request/response by id, exposes
 * event listeners (`onStatus`, `onTables`, `onCatalog`), and wraps every
 * engine method in a typed Promise.
 */

import type {
  BungieLocale,
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  FilterCatalog,
  FuzzySearchOptions,
  ManifestStatus,
  QueryPrecedence,
  ResolvedSummaryEntry,
  ReverseReferenceResponse,
  SearchFilters,
  SearchResponse,
  SortMode,
  TableStatus,
  VariantItem,
} from '../types/manifest';
import type {
  CacheStatsResult,
  CheckForUpdatesRequest,
  ClearCacheRequest,
  DeepSearchRequest,
  GetCacheStatsRequest,
  GetClarityDescriptionRequest,
  GetDefinitionRequest,
  GetFilterCatalogRequest,
  GetReverseReferencesRequest,
  GetVariantsRequest,
  InitRequest,
  LoadAllTablesRequest,
  LoadTableRequest,
  ResolveSummariesRequest,
  SearchRequest,
  UpdateCheckResult,
  WorkerEvent,
  WorkerRequest,
  WorkerResponse,
} from './worker';

type Listener<T> = (payload: T) => void;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

const statusListeners = new Set<Listener<ManifestStatus>>();
const tablesListeners = new Set<Listener<TableStatus[]>>();
const catalogListeners = new Set<Listener<FilterCatalog>>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent): void => {
      const message = event.data as WorkerResponse | WorkerEvent;
      if ('id' in message) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.ok) entry.resolve(message.result);
        else entry.reject(new Error(message.error));
        return;
      }
      if (message.type === 'status') {
        for (const listener of statusListeners) listener(message.status);
      } else if (message.type === 'tables') {
        for (const listener of tablesListeners) listener(message.tables);
      } else if (message.type === 'catalog') {
        for (const listener of catalogListeners) listener(message.catalog);
      }
    };
    worker.onerror = (event: ErrorEvent): void => {
      // Reject all in-flight requests so callers don't hang forever.
      const error = new Error(event.message || 'Manifest worker error');
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    };
  }
  return worker;
}

function send<TReq extends { id: number }, TResult>(request: TReq): Promise<TResult> {
  const w = getWorker();
  return new Promise<TResult>((resolve, reject) => {
    pending.set(request.id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    w.postMessage(request as unknown as WorkerRequest);
  });
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

export function onStatus(listener: Listener<ManifestStatus>): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function onTables(listener: Listener<TableStatus[]>): () => void {
  tablesListeners.add(listener);
  return () => tablesListeners.delete(listener);
}

export function onCatalog(listener: Listener<FilterCatalog>): () => void {
  catalogListeners.add(listener);
  return () => catalogListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Typed methods
// ---------------------------------------------------------------------------

export function init(
  locale: BungieLocale,
  apiKey?: string,
  forceRefresh?: boolean,
): Promise<ManifestStatus> {
  const request: InitRequest = { type: 'init', id: ++nextId, locale, apiKey, forceRefresh };
  return send<InitRequest, ManifestStatus>(request);
}

export function search(
  query: string,
  filters: SearchFilters,
  sort: SortMode,
  maxResults?: number,
  fuzzy?: FuzzySearchOptions,
  precedence?: QueryPrecedence,
): Promise<SearchResponse> {
  const request: SearchRequest = {
    type: 'search',
    id: ++nextId,
    query,
    filters,
    sort,
    maxResults,
    fuzzy,
    precedence,
  };
  return send<SearchRequest, SearchResponse>(request);
}

export function deepSearch(
  query: string,
  filters: SearchFilters,
  maxResults?: number,
): Promise<SearchResponse> {
  const request: DeepSearchRequest = {
    type: 'deepSearch',
    id: ++nextId,
    query,
    filters,
    maxResults,
  };
  return send<DeepSearchRequest, SearchResponse>(request);
}

export function getDefinition(
  table: string,
  hash: number,
  preferFull?: boolean,
): Promise<DefinitionDetailPayload> {
  const request: GetDefinitionRequest = {
    type: 'getDefinition',
    id: ++nextId,
    table,
    hash,
    preferFull,
  };
  return send<GetDefinitionRequest, DefinitionDetailPayload>(request);
}

export function loadTable(table: string): Promise<void> {
  const request: LoadTableRequest = { type: 'loadTable', id: ++nextId, table };
  return send<LoadTableRequest, void>(request);
}

export function loadAllTables(): Promise<void> {
  const request: LoadAllTablesRequest = { type: 'loadAllTables', id: ++nextId };
  return send<LoadAllTablesRequest, void>(request);
}

export function getVariants(table: string, hash: number): Promise<VariantItem[]> {
  const request: GetVariantsRequest = { type: 'getVariants', id: ++nextId, table, hash };
  return send<GetVariantsRequest, VariantItem[]>(request);
}

export function getReverseReferences(
  targetHash: number,
  targetTable?: string,
  tablesToScan?: string[],
): Promise<ReverseReferenceResponse> {
  const request: GetReverseReferencesRequest = {
    type: 'getReverseReferences',
    id: ++nextId,
    targetHash,
    targetTable,
    tablesToScan,
  };
  return send<GetReverseReferencesRequest, ReverseReferenceResponse>(request);
}

export function getClarityDescription(
  hash: number,
): Promise<ClarityDescriptionEntry | undefined> {
  const request: GetClarityDescriptionRequest = {
    type: 'getClarityDescription',
    id: ++nextId,
    hash,
  };
  return send<GetClarityDescriptionRequest, ClarityDescriptionEntry | undefined>(request);
}

export function checkForUpdates(): Promise<UpdateCheckResult> {
  const request: CheckForUpdatesRequest = { type: 'checkForUpdates', id: ++nextId };
  return send<CheckForUpdatesRequest, UpdateCheckResult>(request);
}

export function clearCache(): Promise<void> {
  const request: ClearCacheRequest = { type: 'clearCache', id: ++nextId };
  return send<ClearCacheRequest, void>(request);
}

export function getCacheStats(): Promise<CacheStatsResult> {
  const request: GetCacheStatsRequest = { type: 'getCacheStats', id: ++nextId };
  return send<GetCacheStatsRequest, CacheStatsResult>(request);
}

export function getFilterCatalog(): Promise<FilterCatalog> {
  const request: GetFilterCatalogRequest = { type: 'getFilterCatalog', id: ++nextId };
  return send<GetFilterCatalogRequest, FilterCatalog>(request);
}

export function resolveSummaries(
  refs: Array<{ table: string; hash: number }>,
): Promise<Record<string, ResolvedSummaryEntry>> {
  const request: ResolveSummariesRequest = {
    type: 'resolveSummaries',
    id: ++nextId,
    refs,
  };
  return send<ResolveSummariesRequest, Record<string, ResolvedSummaryEntry>>(request);
}
