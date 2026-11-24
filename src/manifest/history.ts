import { toSignedHash, toUnsignedHash } from './hash';

export interface HistoryVersionCounts {
  a: number;
  m: number;
  r: number;
  u: number;
  c: number;
}

export interface HistoryVersionMeta {
  i: number;
  id: string;
  version?: string | null;
  date: string;
  source: string;
  gapBefore?: boolean;
  counts?: HistoryVersionCounts;
  /** Legacy totals retained for the inspector's per-item history timeline. */
  added?: number;
  modified?: number;
  removed?: number;
}

export interface HistoryManifestIndex {
  schema: 1;
  generatedAt: string;
  buckets: Record<string, number>;
  versions: HistoryVersionMeta[];
}

export type ReleaseItemTuple = [
  hash: number,
  name: string,
  subtitle: string,
  icon: string,
  tierType: number,
  changedFields?: number,
];

export interface ReleaseTableChanges {
  a?: ReleaseItemTuple[];
  m?: ReleaseItemTuple[];
  r?: ReleaseItemTuple[];
  u?: ReleaseItemTuple[];
  c?: ReleaseItemTuple[];
}

export interface ManifestReleaseSummary {
  v: number;
  date: string;
  version?: string;
  totals: HistoryVersionCounts;
  tables: Record<string, ReleaseTableChanges>;
}

export type CompactDiffOp =
  | [0, path: string, oldValue: unknown, newValue: unknown]
  | [1, path: string, newValue: unknown]
  | [2, path: string, oldValue: unknown];

export interface ItemRevision {
  v: number;
  k: 'a' | 'm' | 'r' | 'u' | 'c';
  d?: CompactDiffOp[];
  t?: number;
}

export interface ResolvedItemRevision extends ItemRevision {
  version: HistoryVersionMeta;
}

export interface ItemHistoryResult {
  available: boolean;
  versions: HistoryVersionMeta[];
  revisions: ResolvedItemRevision[];
  firstSeen?: HistoryVersionMeta;
  lastChanged?: HistoryVersionMeta;
  error?: string;
}

type HistoryBucket = Record<string, ItemRevision[]>;

const MAX_BUCKET_CACHE = 32;
const MAX_RELEASE_CACHE = 4;
const LITE_ITEM_TABLE = 'DestinyInventoryItemLiteDefinition';
const FULL_ITEM_TABLE = 'DestinyInventoryItemDefinition';

let indexRequest: Promise<HistoryManifestIndex> | null = null;
const bucketRequests = new Map<string, Promise<HistoryBucket>>();
const releaseRequests = new Map<string, Promise<ManifestReleaseSummary>>();

export function canonicalHistoryTable(table: string): string {
  return table === LITE_ITEM_TABLE ? FULL_ITEM_TABLE : table;
}

/**
 * Calculate the relative bucket name used by the history API.
 * Returns null when the table has no configured buckets.
 */
export function getHistoryBucketHex(hash: number, bucketCount: number): string | null {
  if (!Number.isFinite(bucketCount) || bucketCount <= 0) {
    return null;
  }
  const bucket = (toUnsignedHash(hash) % bucketCount).toString(16);
  return bucket.padStart(bucketCount > 256 ? 3 : 2, '0');
}

function isHistoryIndex(value: unknown): value is HistoryManifestIndex {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const index = value as Partial<HistoryManifestIndex>;
  return (
    index.schema === 1 &&
    typeof index.generatedAt === 'string' &&
    typeof index.buckets === 'object' &&
    index.buckets !== null &&
    Array.isArray(index.versions)
  );
}

function isHistoryCounts(value: unknown): value is HistoryVersionCounts {
  if (typeof value !== 'object' || value === null) return false;
  const counts = value as Partial<HistoryVersionCounts>;
  return ['a', 'm', 'r', 'u', 'c'].every(
    (key) => typeof counts[key as keyof HistoryVersionCounts] === 'number',
  );
}

function isReleaseTuple(value: unknown): value is ReleaseItemTuple {
  return (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'string' &&
    typeof value[2] === 'string' &&
    typeof value[3] === 'string' &&
    typeof value[4] === 'number' &&
    (value[5] === undefined || typeof value[5] === 'number')
  );
}

function isManifestRelease(value: unknown): value is ManifestReleaseSummary {
  if (typeof value !== 'object' || value === null) return false;
  const release = value as Partial<ManifestReleaseSummary>;
  if (
    typeof release.v !== 'number' ||
    typeof release.date !== 'string' ||
    !isHistoryCounts(release.totals) ||
    typeof release.tables !== 'object' ||
    release.tables === null ||
    Array.isArray(release.tables)
  ) {
    return false;
  }
  return Object.values(release.tables).every((table) => {
    if (typeof table !== 'object' || table === null || Array.isArray(table)) return false;
    return ['a', 'm', 'r', 'u', 'c'].every((kind) => {
      const entries = (table as ReleaseTableChanges)[kind as keyof ReleaseTableChanges];
      return entries === undefined || (Array.isArray(entries) && entries.every(isReleaseTuple));
    });
  });
}

function isHistoryBucket(value: unknown): value is HistoryBucket {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchJson<T>(url: string, validate: (value: unknown) => value is T): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`History request failed (${response.status})`);
  }
  const value: unknown = await response.json();
  if (!validate(value)) {
    throw new Error('History response has an invalid format');
  }
  return value;
}

function getHistoryIndex(): Promise<HistoryManifestIndex> {
  if (!indexRequest) {
    const request = fetchJson('/api/history/versions', isHistoryIndex).catch((error: unknown) => {
      if (indexRequest === request) {
        indexRequest = null;
      }
      throw error;
    });
    indexRequest = request;
  }
  return indexRequest;
}

/**
 * Fetch the shared version index. The request is cached while the page is open
 * and a failed request is allowed to retry on the next call.
 */
export function fetchHistoryVersionsIndex(): Promise<HistoryManifestIndex> {
  return getHistoryIndex();
}

/**
 * Fetch one precomputed release summary. `latestVersionIndex` is included in
 * the URL so edge caches invalidate as soon as a newer manifest is archived.
 */
export async function fetchManifestRelease(
  versionIndex: number,
  latestVersionIndex?: number,
): Promise<ManifestReleaseSummary> {
  const latest =
    latestVersionIndex ??
    (await getHistoryIndex()).versions.reduce(
      (maximum, version) => Math.max(maximum, version.i),
      0,
    );
  const key = `${versionIndex}?v=${latest}`;
  const cached = releaseRequests.get(key);
  if (cached) {
    releaseRequests.delete(key);
    releaseRequests.set(key, cached);
    return cached;
  }

  const request = fetchJson(
    `/api/history/release/${encodeURIComponent(String(versionIndex))}?v=${latest}`,
    isManifestRelease,
  ).catch((error: unknown) => {
    if (releaseRequests.get(key) === request) releaseRequests.delete(key);
    throw error;
  });
  releaseRequests.set(key, request);
  if (releaseRequests.size > MAX_RELEASE_CACHE) {
    const oldestKey = releaseRequests.keys().next().value as string | undefined;
    if (oldestKey !== undefined) releaseRequests.delete(oldestKey);
  }
  return request;
}

function getHistoryBucket(
  table: string,
  bucketHex: string,
  latestVersionIndex: number,
): Promise<HistoryBucket> {
  // Bucket objects are immutable for a given version. Keying the URL by the
  // newest version lets Cloudflare's edge cache keep them for a full day while
  // still invalidating every bucket as soon as a new manifest is recorded.
  const key = `${table}/${bucketHex}?v=${latestVersionIndex}&format=json`;
  const cached = bucketRequests.get(key);
  if (cached) {
    bucketRequests.delete(key);
    bucketRequests.set(key, cached);
    return cached;
  }

  const request = fetchJson(
    `/api/history/bucket/${encodeURIComponent(table)}/${encodeURIComponent(bucketHex)}?v=${latestVersionIndex}&format=json`,
    isHistoryBucket,
  ).catch((error: unknown) => {
    if (bucketRequests.get(key) === request) {
      bucketRequests.delete(key);
    }
    throw error;
  });
  bucketRequests.set(key, request);
  if (bucketRequests.size > MAX_BUCKET_CACHE) {
    const oldestKey = bucketRequests.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      bucketRequests.delete(oldestKey);
    }
  }
  return request;
}

/**
 * Fetch the shared history index on first use and the item's bucket on demand.
 * Both API and network failures are reported as unavailable rather than thrown.
 */
export async function fetchItemHistory(table: string, hash: number): Promise<ItemHistoryResult> {
  try {
    const index = await getHistoryIndex();
    const canonicalTable = canonicalHistoryTable(table);
    const bucketCount = index.buckets[canonicalTable] ?? 0;
    const bucketHex = getHistoryBucketHex(hash, bucketCount);
    const versions = [...index.versions].sort((a, b) => a.i - b.i);
    const latestVersionIndex = index.versions[index.versions.length - 1]?.i ?? 0;
    if (!bucketHex) {
      return { available: true, versions, revisions: [] };
    }

    const bucket = await getHistoryBucket(canonicalTable, bucketHex, latestVersionIndex);
    const unsignedHash = toUnsignedHash(hash);
    const itemRevisions =
      bucket[String(unsignedHash)] ??
      bucket[String(toSignedHash(unsignedHash))] ??
      [];
    const versionsByIndex = new Map(versions.map((version) => [version.i, version]));
    const revisions = itemRevisions
      .map((revision) => {
        const version = versionsByIndex.get(revision.v);
        return version ? { ...revision, version } : null;
      })
      .filter((revision): revision is ResolvedItemRevision => revision !== null)
      .sort((a, b) => b.v - a.v);
    const earliestAdded = [...revisions]
      .reverse()
      .find((revision) => revision.k === 'a');

    return {
      available: true,
      versions,
      revisions,
      firstSeen: earliestAdded?.version,
      lastChanged: revisions[0]?.version,
    };
  } catch (error) {
    return {
      available: false,
      versions: [],
      revisions: [],
      error: error instanceof Error ? error.message : 'History is unavailable.',
    };
  }
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(copy, key, {
        value: cloneJsonValue(entry),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy as T;
  }
  return value;
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~[01]/g, (escape) => (escape === '~1' ? '/' : '~'));
}

function pointerSegments(path: string): string[] {
  if (!path.startsWith('/')) {
    return [];
  }
  return path.slice(1).split('/').map(decodePointerSegment);
}

function arrayIndex(segment: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    return null;
  }
  const index = Number(segment);
  return Number.isSafeInteger(index) ? index : null;
}

function getPathParent(
  root: unknown,
  segments: string[],
): { parent: Record<string, unknown> | unknown[]; key: string } | null {
  if (segments.length === 0) {
    return null;
  }
  let current: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment);
      if (index === null || index >= current.length) {
        return null;
      }
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return null;
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }
  if (typeof current !== 'object' || current === null) {
    return null;
  }
  return {
    parent: current as Record<string, unknown> | unknown[],
    key: segments.at(-1)!,
  };
}

function setPath(root: unknown, path: string, value: unknown, insertArrayValue = false): void {
  const target = getPathParent(root, pointerSegments(path));
  if (!target) {
    return;
  }
  const valueCopy = cloneJsonValue(value);
  if (Array.isArray(target.parent)) {
    const index = arrayIndex(target.key);
    if (index === null) {
      return;
    }
    if (insertArrayValue && index <= target.parent.length) {
      target.parent.splice(index, 0, valueCopy);
    } else {
      target.parent[index] = valueCopy;
    }
    return;
  }
  Object.defineProperty(target.parent, target.key, {
    value: valueCopy,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function setPathCreatingParents(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = pointerSegments(path);
  if (segments.length === 0) return;
  let current: Record<string, unknown> | unknown[] = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const nextSegment = segments[index + 1]!;
    const nextIsArray = arrayIndex(nextSegment) !== null;
    if (Array.isArray(current)) {
      const arrayPosition = arrayIndex(segment);
      if (arrayPosition === null) return;
      while (current.length < arrayPosition) current.push(undefined);
      let child = current[arrayPosition];
      if (typeof child !== 'object' || child === null) {
        child = nextIsArray ? [] : {};
        current[arrayPosition] = child;
      }
      current = child as Record<string, unknown> | unknown[];
    } else {
      let child = current[segment];
      if (typeof child !== 'object' || child === null) {
        child = nextIsArray ? [] : {};
        Object.defineProperty(current, segment, {
          value: child,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      current = child as Record<string, unknown> | unknown[];
    }
  }

  const key = segments.at(-1)!;
  const valueCopy = cloneJsonValue(value);
  if (Array.isArray(current)) {
    const index = arrayIndex(key);
    if (index === null) return;
    if (index <= current.length) current.splice(index, 0, valueCopy);
    else current[index] = valueCopy;
  } else {
    Object.defineProperty(current, key, {
      value: valueCopy,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

function deletePath(root: unknown, path: string): void {
  const target = getPathParent(root, pointerSegments(path));
  if (!target) {
    return;
  }
  if (Array.isArray(target.parent)) {
    const index = arrayIndex(target.key);
    if (index !== null && index < target.parent.length) {
      target.parent.splice(index, 1);
    }
    return;
  }
  delete target.parent[target.key];
}

function reversePatch(root: unknown, op: CompactDiffOp): void {
  switch (op[0]) {
    case 0:
      setPath(root, op[1], op[2]);
      break;
    case 1:
      deletePath(root, op[1]);
      break;
    case 2:
      setPath(root, op[1], op[2], true);
      break;
  }
}

/**
 * Reconstruct the item as it appeared at a manifest version. Revisions describe
 * forward changes, so changes after the target version are applied in reverse,
 * newest first. With no target version, this returns a detached copy of current.
 */
export function reconstructRevisionSnapshot(
  currentData: unknown,
  revisions: readonly ItemRevision[],
  targetVersion?: number | HistoryVersionMeta | null,
): unknown {
  const snapshot = cloneJsonValue(currentData);
  if (targetVersion === undefined || targetVersion === null) {
    return snapshot;
  }
  const target = typeof targetVersion === 'number' ? targetVersion : targetVersion.i;
  const firstAddedVersion = revisions
    .filter((revision) => revision.k === 'a')
    .reduce<number | null>(
      (earliest, revision) =>
        earliest === null ? revision.v : Math.min(earliest, revision.v),
      null,
    );
  // An item has no snapshot before its first recorded Added revision. Returning
  // null also lets callers render an all-added diff without fabricating fields.
  if (firstAddedVersion !== null && target < firstAddedVersion) {
    return null;
  }
  const laterRevisions = [...revisions]
    .filter((revision) => revision.v > target)
    .sort((a, b) => b.v - a.v);
  for (const revision of laterRevisions) {
    const ops = revision.d ?? [];
    for (let index = ops.length - 1; index >= 0; index -= 1) {
      const op = ops[index];
      if (op) {
        reversePatch(snapshot, op);
      }
    }
  }
  return snapshot;
}

/**
 * Rebuild the JSON immediately before an item's removal from the old values
 * stored in that removal revision. This is the only recoverable source when
 * Bungie's current manifest no longer contains the entry.
 */
export function reconstructRemovedSnapshot(
  revisions: readonly ItemRevision[],
  targetVersion?: number | HistoryVersionMeta,
): Record<string, unknown> | null {
  const target = typeof targetVersion === 'number' ? targetVersion : targetVersion?.i;
  const removal = [...revisions]
    .filter((revision) => revision.k === 'r' && (target === undefined || revision.v === target))
    .sort((a, b) => b.v - a.v)[0];
  if (!removal) return null;

  const snapshot: Record<string, unknown> = {};
  for (const operation of removal.d ?? []) {
    if (operation[0] === 2) {
      setPathCreatingParents(snapshot, operation[1], operation[2]);
    }
  }
  return snapshot;
}

/** Clear in-memory state, primarily for isolated unit tests. */
export function clearHistoryCache(): void {
  indexRequest = null;
  bucketRequests.clear();
  releaseRequests.clear();
}
