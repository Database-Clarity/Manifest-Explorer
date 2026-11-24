#!/usr/bin/env node
/**
 * Incremental updater for the v1 manifest history data set.
 *
 * Intended for the hourly GitHub Actions workflow (and local runs), so it has
 * zero npm dependencies: Node's built-in fetch downloads Bungie's manifest and
 * the Wrangler CLI performs the few R2 reads/writes the update needs.
 *
 * R2 layout (shared with worker/index.ts, build-history.mjs, and
 * src/manifest/history.ts):
 *
 *   v1/versions.json                            HistoryManifestIndex
 *   v1/releases/{versionIndex}.json.gz          ManifestReleaseSummary
 *   v1/buckets/{table}/{bucketHex}.json.gz      { [hash]: ItemRevision[] }
 *   v1/latest-snapshot/{table}.json.gz          { [hash]: definition }
 *
 * A run never re-downloads bucket objects it does not touch, and it writes
 * v1/versions.json last so the API only exposes a new version after every
 * table, bucket, snapshot, and release index for it has been stored.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node scripts/history/update-live-manifest.mjs [--dry-run]
 *
 * When the live Bungie version is already the newest entry, the run performs
 * one R2 read (v1/versions.json), zero R2 writes, and exits successfully.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, gzipSync, gunzipSync } from 'node:zlib';
import { decodeEntryDates, encodeEntryDates } from './entry-dates-codec.mjs';

const MANIFEST_INDEX_URL = 'https://www.bungie.net/Platform/Destiny2/Manifest/';
const BUNGIE_ORIGIN = 'https://www.bungie.net';
const USER_AGENT = 'ManifestExplorerHistory/1.0 (+https://manifest.d2clarity.com)';

const R2_BUCKET = 'manifest-history';
const DEFAULT_ACCOUNT_ID = 'c5ec2772673dc72f5e58587ef4c80ff8';

const HISTORY_PREFIX = 'v1';
const VERSIONS_KEY = `${HISTORY_PREFIX}/versions.json`;
const ENTRY_DATES_KEY = `${HISTORY_PREFIX}/entry-dates.bin.gz`;
const SNAPSHOT_PREFIX = `${HISTORY_PREFIX}/latest-snapshot`;
const BUCKET_PREFIX = `${HISTORY_PREFIX}/buckets`;
const RELEASE_PREFIX = `${HISTORY_PREFIX}/releases`;

const RELEASE_KINDS = ['a', 'm', 'r', 'u', 'c'];

const LITE_ITEM_TABLE = 'DestinyInventoryItemLiteDefinition';
const FULL_ITEM_TABLE = 'DestinyInventoryItemDefinition';

const TABLE_RE = /^[A-Za-z0-9_]{1,96}$/;
const MANIFEST_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ANSI_ESCAPE_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

const TMP_DIR = mkdtempSync(path.join(os.tmpdir(), 'manifest-history-update-'));

let wranglerEnvironment = null;

function log(message) {
  console.log(`[update-live-manifest] ${message}`);
}

function parseArgs(argv) {
  const options = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function help() {
  console.log(`Update the live manifest history in R2.

Usage:
  CLOUDFLARE_API_TOKEN=<token> node scripts/history/update-live-manifest.mjs [--dry-run]

Options:
  --dry-run  Download and diff everything, but skip all R2 writes.
  --help     Show this message.

Environment:
  CLOUDFLARE_API_TOKEN   Required. Token with R2 Object Read & Write permission.
  CLOUDFLARE_ACCOUNT_ID  Optional. Defaults to ${DEFAULT_ACCOUNT_ID}.
`);
}

// ---------------------------------------------------------------------------
// Wrangler / R2 helpers
// ---------------------------------------------------------------------------

function createWranglerEnvironment() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const isCi = Boolean(process.env.GITHUB_ACTIONS || process.env.CI);
  if (!token && isCi) {
    throw new Error(
      'CLOUDFLARE_API_TOKEN is required in CI (R2 Object Read & Write). ' +
        'Add it as a repository secret in GitHub Actions.',
    );
  }
  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID:
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || DEFAULT_ACCOUNT_ID,
    NO_COLOR: '1',
    WRANGLER_SEND_METRICS: 'false',
  };
  if (token) {
    env.CLOUDFLARE_API_TOKEN = token;
    env.CI = '1';
  }
  return env;
}

function spawnSyncNpx(args, options) {
  if (process.platform !== 'win32') {
    return spawnSync('npx', args, options);
  }

  // Node cannot spawn the npx.cmd shim directly (EINVAL), so run npm's npx
  // entry point with the same Node binary. This also avoids shell quoting.
  const npxCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npx-cli.js',
  );
  if (existsSync(npxCli)) {
    return spawnSync(process.execPath, [npxCli, ...args], options);
  }

  // Fallback for Windows runtimes that ship npx.cmd without npm's JS entry.
  const commandLine = ['npx.cmd', ...args].map(quoteWindowsArgument).join(' ');
  return spawnSync(commandLine, [], { ...options, shell: true });
}

function quoteWindowsArgument(value) {
  if (/["%\r\n]/.test(value)) {
    throw new Error(`Cannot safely pass "${value}" to cmd.exe; install npm npx-cli.js`);
  }
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `"${value}"`;
}

function runWrangler(args, { allowMissing = false } = {}) {
  const result = spawnSyncNpx(['--yes', 'wrangler', ...args], {
    env: wranglerEnvironment,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status === 0) {
    return true;
  }

  const output = stripAnsi(`${result.stderr ?? ''}\n${result.stdout ?? ''}`).trim();
  if (allowMissing && isMissingObjectError(output)) {
    return false;
  }
  throw new Error(
    `wrangler ${args.slice(0, 3).join(' ')} failed (exit ${result.status ?? 'unknown'}): ${
      output || 'no output'
    }`,
  );
}

function stripAnsi(value) {
  return value.replace(ANSI_ESCAPE_RE, '');
}

function isMissingObjectError(message) {
  return (
    /specified key does not exist/i.test(message) ||
    /key does not exist/i.test(message) ||
    /NoSuchKey/i.test(message) ||
    /object not found/i.test(message) ||
    /\b404\b/.test(message)
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Decode a JSON object downloaded from R2. Node's fetch transparently
 * decompresses responses that carry `Content-Encoding: gzip`, while the R2
 * binding (and some Wrangler versions) returns the raw gzip bytes, so detect
 * the gzip magic instead of assuming one behavior.
 */
function decodeJsonBytes(bytes, source) {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  try {
    const text = isGzip ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to decode ${source}: ${errorMessage(error)}`);
  }
}

/** Read an R2 object, returning null only when the object does not exist. */
function r2Get(key, { optional = false } = {}) {
  const directory = path.join(TMP_DIR, 'r2');
  mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${sha256(key)}.download`);
  rmSync(destination, { force: true });
  try {
    const found = runWrangler(
      [
        'r2',
        'object',
        'get',
        `${R2_BUCKET}/${key}`,
        '--file',
        destination,
        '--remote',
      ],
      { allowMissing: optional },
    );
    if (!found) {
      return null;
    }
    if (!existsSync(destination) || statSync(destination).size === 0) {
      throw new Error(`wrangler reported success but wrote no data for ${key}`);
    }
    return readFileSync(destination);
  } finally {
    rmSync(destination, { force: true });
  }
}

function r2PutFile(
  key,
  file,
  { gzip = false, contentType = 'application/json; charset=utf-8' } = {},
) {
  const args = [
    'r2',
    'object',
    'put',
    `${R2_BUCKET}/${key}`,
    '--file',
    file,
    '--remote',
    '--content-type',
    contentType,
    '--cache-control',
    'public, max-age=300',
  ];
  if (gzip) {
    args.push('--content-encoding', 'gzip');
  }
  runWrangler(args);
}

async function writeJsonFile(file, value, { gzip = false } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (!gzip) {
    writeFileSync(file, JSON.stringify(value, null, 2));
    return;
  }
  // Buffer the serialized value as one chunk, then stream it through level-9
  // gzip. This avoids materializing another full-length Buffer in memory.
  await pipeline(
    Readable.from([JSON.stringify(value)]),
    createGzip({ level: 9 }),
    createWriteStream(file),
  );
}

async function r2PutValue(key, value, { gzip = false } = {}) {
  const extension = gzip ? 'json.gz' : 'json';
  const file = path.join(TMP_DIR, 'uploads', `${sha256(key)}.${extension}`);
  try {
    await writeJsonFile(file, value, { gzip });
    r2PutFile(key, file, { gzip });
  } finally {
    rmSync(file, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Manifest / index parsing
// ---------------------------------------------------------------------------

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (HTTP ${response.status}) for ${url}`);
  }
  return response.json();
}

/** Parse Bungie's manifest index into the version and English table paths. */
function parseManifest(payload) {
  if (!isRecord(payload) || !isRecord(payload.Response)) {
    throw new Error('Bungie manifest response has an invalid format');
  }
  const response = payload.Response;
  const version = typeof response.version === 'string' ? response.version.trim() : '';
  if (!version) {
    throw new Error('Bungie manifest response does not include a version');
  }

  const englishPaths = response.jsonWorldComponentContentPaths?.en;
  if (!isRecord(englishPaths)) {
    throw new Error('Bungie manifest response has no English component paths');
  }

  const tables = [];
  for (const [table, manifestPath] of Object.entries(englishPaths)) {
    if (table === LITE_ITEM_TABLE) {
      continue;
    }
    if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
      continue;
    }
    // Table names become R2 keys; reject unexpected names instead of writing
    // objects that the API's route validation would never serve.
    if (!TABLE_RE.test(table)) {
      throw new Error(
        `Bungie manifest contains an unsupported table name: ${JSON.stringify(table)}`,
      );
    }
    tables.push([table, manifestPath]);
  }

  if (tables.length === 0) {
    throw new Error('Bungie manifest response has no English tables to archive');
  }

  return {
    version,
    tables,
    uuid: extractManifestUuid(tables),
  };
}

function extractManifestUuid(tables) {
  for (const [, manifestPath] of tables) {
    const match = MANIFEST_UUID_RE.exec(manifestPath);
    if (match) {
      return match[0];
    }
  }
  return null;
}

function toBungieUrl(manifestPath) {
  if (/^https?:\/\//i.test(manifestPath)) {
    return manifestPath;
  }
  return `${BUNGIE_ORIGIN}${manifestPath.startsWith('/') ? '' : '/'}${manifestPath}`;
}

function parseVersionIndex(value) {
  if (
    !isRecord(value) ||
    value.schema !== 1 ||
    !isRecord(value.buckets) ||
    !Array.isArray(value.versions)
  ) {
    throw new Error('v1/versions.json is not a valid HistoryManifestIndex');
  }
  for (const entry of value.versions) {
    if (!isRecord(entry) || !Number.isInteger(entry.i)) {
      throw new Error('v1/versions.json contains a version without an integer index');
    }
  }
  if (value.versions.length === 0) {
    throw new Error('v1/versions.json has no versions; bootstrap the history data set first');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Definition maps and diffs
// ---------------------------------------------------------------------------

function normalizeHashKey(rawHash) {
  if (!/^-?\d+$/.test(rawHash)) {
    return null;
  }
  const parsed = Number(rawHash);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  return String(parsed >>> 0);
}

/**
 * Convert Bungie's raw definition keys (which may be signed) into the unsigned
 * hash keys used by the history layout, in place, and return the lookup map.
 */
function normalizeDefinitionObject(value, source) {
  if (!isRecord(value)) {
    throw new Error(`${source} did not return a JSON object`);
  }
  const definitions = new Map();
  for (const rawHash of Object.keys(value)) {
    const hash = normalizeHashKey(rawHash);
    if (hash === null) {
      delete value[rawHash];
      continue;
    }
    const definition = value[rawHash];
    if (rawHash !== hash) {
      delete value[rawHash];
      value[hash] = definition;
    }
    definitions.set(hash, definition);
  }
  return definitions;
}

function parseDefinitionMap(value, source) {
  if (!isRecord(value)) {
    throw new Error(`${source} is not a JSON object`);
  }
  const definitions = new Map();
  for (const [rawHash, definition] of Object.entries(value)) {
    const hash = normalizeHashKey(rawHash);
    if (hash !== null) {
      definitions.set(hash, definition);
    }
  }
  return definitions;
}

function readSnapshot(table) {
  const key = `${SNAPSHOT_PREFIX}/${table}.json.gz`;
  const compressed = r2Get(key, { optional: true });
  if (!compressed) {
    // Brand-new tables added by Bungie have no snapshot yet.
    return new Map();
  }
  try {
    return parseDefinitionMap(decodeJsonBytes(compressed, key), key);
  } catch (error) {
    throw new Error(`Failed to read ${key}: ${errorMessage(error)}`);
  }
}

function readBucket(key) {
  const compressed = r2Get(key, { optional: true });
  if (!compressed) {
    return {};
  }
  try {
    const parsed = decodeJsonBytes(compressed, key);
    if (!isRecord(parsed)) {
      throw new Error('not a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to read ${key}: ${errorMessage(error)}`);
  }
}

function jsonEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!jsonEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!hasOwn(right, key) || !jsonEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function escapePointerSegment(segment) {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function emitDiffOp(state, op) {
  // Diffs are 100% lossless: every field change is stored so any past revision
  // can be reconstructed by reverse-patching.
  state.ops.push(op);
  state.total += 1;
}

/**
 * Produce compact JSON-pointer diff ops relative to the definition root.
 *
 * Arrays are replaced atomically so reverse patching stays exact even when an
 * array shrinks. The top-level `index` field is ignored because Bungie
 * renumbers it whenever a definition is inserted, which would otherwise mark
 * almost the entire manifest as changed on every release.
 */
function diffValues(state, oldValue, newValue, pathPrefix, depth) {
  if (isRecord(oldValue) && isRecord(newValue)) {
    const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    for (const key of keys) {
      if (depth === 0 && key === 'index') {
        continue;
      }
      const childPath = `${pathPrefix}/${escapePointerSegment(key)}`;
      const hasOld = hasOwn(oldValue, key);
      const hasNew = hasOwn(newValue, key);
      if (hasOld && hasNew) {
        diffValues(state, oldValue[key], newValue[key], childPath, depth + 1);
      } else if (hasNew) {
        emitDiffOp(state, [1, childPath, newValue[key]]);
      } else {
        emitDiffOp(state, [2, childPath, oldValue[key]]);
      }
    }
    return;
  }

  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    if (!jsonEqual(oldValue, newValue)) {
      emitDiffOp(state, [0, pathPrefix, oldValue, newValue]);
    }
    return;
  }

  if (!Object.is(oldValue, newValue)) {
    emitDiffOp(state, [0, pathPrefix, oldValue, newValue]);
  }
}

function diffDefinitions(oldValue, newValue) {
  const state = { ops: [], total: 0 };
  diffValues(state, oldValue, newValue, '', 0);
  return state;
}

function buildRevision(versionIndex, kind, diff) {
  const revision = { v: versionIndex, k: kind };
  if (diff.ops.length > 0) {
    revision.d = diff.ops;
  }
  return revision;
}

// ---------------------------------------------------------------------------
// Release summary metadata
// ---------------------------------------------------------------------------

function releaseText(value) {
  return typeof value === 'string' ? value : '';
}

function releaseTierType(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Extract the fields shown by v1/releases (same shape as build-releases.mjs). */
function releaseMetadata(definition) {
  const source = isRecord(definition) ? definition : {};
  const display = isRecord(source.displayProperties) ? source.displayProperties : {};
  const inventory = isRecord(source.inventory) ? source.inventory : {};
  return {
    name: releaseText(display.name),
    icon: releaseText(display.icon),
    displaySubtitle: releaseText(display.subtitle),
    typeAndTier: releaseText(source.itemTypeAndTierDisplayName),
    typeName: releaseText(source.itemTypeDisplayName),
    tierType: releaseTierType(inventory.tierType),
  };
}

function releaseSubtitle(metadata) {
  return metadata.typeAndTier || metadata.typeName || metadata.displaySubtitle || '';
}

function releaseTuple(hash, definition, changedFields) {
  const metadata = releaseMetadata(definition);
  const tuple = [
    Number(hash) >>> 0,
    metadata.name,
    releaseSubtitle(metadata),
    metadata.icon,
    metadata.tierType,
  ];
  if (changedFields !== undefined) tuple.push(changedFields);
  return tuple;
}

/** Deterministic ordering shared with build-releases.mjs. */
function compareReleaseEntries(left, right) {
  const leftNamed = left[1].length > 0;
  const rightNamed = right[1].length > 0;
  if (leftNamed !== rightNamed) return leftNamed ? -1 : 1;
  if (leftNamed) {
    const leftKey = left[1].toLowerCase();
    const rightKey = right[1].toLowerCase();
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    if (left[1] < right[1]) return -1;
    if (left[1] > right[1]) return 1;
  }
  return left[0] - right[0];
}

function emptyReleaseTables() {
  return { a: [], m: [], r: [], u: [], c: [] };
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

function resolveBucketCount(configured, table, hashCount) {
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  if (table === FULL_ITEM_TABLE) {
    return 512;
  }
  return hashCount >= 1000 ? 64 : 1;
}

function bucketHexForHash(hash, bucketCount) {
  const bucket = (Number(hash) >>> 0) % bucketCount;
  return bucket.toString(16).padStart(bucketCount > 256 ? 3 : 2, '0');
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

async function updateTable({
  table,
  manifestPath,
  versionIndex,
  index,
  dryRun,
  pendingSnapshots,
  entryDateTables,
}) {
  const tableUrl = toBungieUrl(manifestPath);
  log(`Downloading ${table}...`);
  let newData = await fetchJson(tableUrl);
  const newDefinitions = normalizeDefinitionObject(newData, table);
  const oldDefinitions = readSnapshot(table);

  const previousBucketCount = index.buckets[table];
  const bucketCount = resolveBucketCount(previousBucketCount, table, newDefinitions.size);
  if (!(typeof previousBucketCount === 'number' && previousBucketCount > 0)) {
    index.buckets[table] = bucketCount;
  }

  const revisions = new Map();
  const releaseEntries = emptyReleaseTables();
  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const [hash, newDefinition] of newDefinitions) {
    if (oldDefinitions.has(hash)) {
      const diff = diffDefinitions(oldDefinitions.get(hash), newDefinition);
      if (diff.total === 0) {
        continue;
      }
      modified += 1;
      revisions.set(hash, buildRevision(versionIndex, 'm', diff));
      releaseEntries.m.push(releaseTuple(hash, newDefinition, diff.total));
    } else {
      added += 1;
      revisions.set(hash, buildRevision(versionIndex, 'a', diffDefinitions({}, newDefinition)));
      releaseEntries.a.push(releaseTuple(hash, newDefinition));
    }
  }

  for (const [hash, oldDefinition] of oldDefinitions) {
    if (newDefinitions.has(hash)) {
      continue;
    }
    removed += 1;
    revisions.set(hash, buildRevision(versionIndex, 'r', diffDefinitions(oldDefinition, {})));
    // Removed items are absent from the new manifest, so their release tuple
    // uses the last-known definition that still carried display metadata.
    releaseEntries.r.push(releaseTuple(hash, oldDefinition));
  }

  // Queue the snapshot before touching buckets so the full table can be
  // released from memory while bucket objects are read, rewritten, and
  // uploaded. Revisions keep references to the changed values they need.
  if (!dryRun) {
    const snapshotKey = `${SNAPSHOT_PREFIX}/${table}.json.gz`;
    const snapshotFile = path.join(TMP_DIR, 'snapshots', `${table}.json.gz`);
    await writeJsonFile(snapshotFile, newData, { gzip: true });
    pendingSnapshots.push({ key: snapshotKey, file: snapshotFile });
  }

  const definitionCount = newDefinitions.size;
  newDefinitions.clear();
  oldDefinitions.clear();
  newData = null;

  // Group changed hashes by bucket so only affected bucket objects are read
  // and written. Revisions for this exact version are replaced, keeping
  // retries of a partially completed run idempotent.
  const bucketsToWrite = new Map();
  for (const [hash, revision] of revisions) {
    const bucketHex = bucketHexForHash(hash, bucketCount);
    let entries = bucketsToWrite.get(bucketHex);
    if (!entries) {
      entries = new Map();
      bucketsToWrite.set(bucketHex, entries);
    }
    entries.set(hash, revision);
  }

  let bucketWrites = 0;
  for (const [bucketHex, entries] of bucketsToWrite) {
    const key = `${BUCKET_PREFIX}/${table}/${bucketHex}.json.gz`;
    const bucket = readBucket(key);
    for (const [hash, revision] of entries) {
      const existing = Array.isArray(bucket[hash]) ? bucket[hash] : [];
      const history = existing.filter(
        (entry) => !isRecord(entry) || entry.v !== versionIndex,
      );
      history.push(revision);
      bucket[hash] = history;
      let tableDates = entryDateTables.get(table);
      if (!tableDates) {
        tableDates = new Map();
        entryDateTables.set(table, tableDates);
      }
      if (revision.k === 'r') {
        tableDates.delete(Number(hash) >>> 0);
      } else {
        const existingDate = tableDates.get(Number(hash) >>> 0);
        const validHistory = history.filter(
          (entry) => isRecord(entry) && Number.isInteger(entry.v) && entry.v >= 0,
        );
        const firstAdded = validHistory
          .filter((entry) => entry.k === 'a')
          .reduce((first, entry) => Math.min(first, entry.v), Number.POSITIVE_INFINITY);
        const firstAny = validHistory.reduce(
          (first, entry) => Math.min(first, entry.v),
          Number.POSITIVE_INFINITY,
        );
        const lastAny = validHistory.reduce(
          (last, entry) => Math.max(last, entry.v),
          Number.NEGATIVE_INFINITY,
        );
        tableDates.set(Number(hash) >>> 0, {
          firstVersionIndex:
            revision.k === 'm' && existingDate
              ? existingDate.firstVersionIndex
              : Number.isFinite(firstAdded)
                ? firstAdded
                : Number.isFinite(firstAny)
                  ? firstAny
                  : -1,
          lastVersionIndex:
            revision.k === 'm' && existingDate
              ? versionIndex
              : Number.isFinite(lastAny)
                ? lastAny
                : -1,
          firstInferred:
            revision.k === 'm' && existingDate
              ? existingDate.firstInferred
              : !Number.isFinite(firstAdded) && Number.isFinite(firstAny),
        });
      }
    }
    if (!dryRun) {
      await r2PutValue(key, bucket, { gzip: true });
    }
    bucketWrites += 1;
  }

  return {
    added,
    modified,
    removed,
    bucketCount,
    bucketWrites,
    definitionCount,
    releaseEntries,
  };
}

async function update(options) {
  wranglerEnvironment = createWranglerEnvironment();
  const startedAt = Date.now();

  log('Fetching the Bungie manifest index...');
  const manifest = parseManifest(await fetchJson(MANIFEST_INDEX_URL));
  log(
    `Live version ${manifest.version}; ${manifest.tables.length} English tables ` +
      `(${LITE_ITEM_TABLE} is skipped).`,
  );

  const versionsBytes = r2Get(VERSIONS_KEY, { optional: true });
  if (!versionsBytes) {
    throw new Error(
      'v1/versions.json was not found in the manifest-history bucket. ' +
        'Bootstrap the data set with build-history.mjs and upload-history-r2.mjs first.',
    );
  }

  let index;
  try {
    index = parseVersionIndex(JSON.parse(versionsBytes.toString('utf8')));
  } catch (error) {
    throw new Error(`Failed to read ${VERSIONS_KEY}: ${errorMessage(error)}`);
  }

  const previous = index.versions[index.versions.length - 1];
  if (previous.version === manifest.version) {
    console.log(`Already up to date (${manifest.version})`);
    return;
  }
  if (index.versions.some((entry) => entry.version === manifest.version)) {
    // The version exists but is not newest; appending it again would duplicate
    // history and break chronological ordering.
    console.log(`Already recorded (${manifest.version})`);
    return;
  }

  const versionIndex = previous.i + 1;
  log(`Recording ${manifest.version} as history index ${versionIndex}.`);

  const entryDatesBytes = r2Get(ENTRY_DATES_KEY, { optional: true });
  if (!entryDatesBytes) {
    throw new Error(
      `${ENTRY_DATES_KEY} is missing. Rebuild and upload the complete history artifacts before running the live updater.`,
    );
  }
  let entryDates;
  try {
    const isGzip = entryDatesBytes[0] === 0x1f && entryDatesBytes[1] === 0x8b;
    entryDates = decodeEntryDates(isGzip ? gunzipSync(entryDatesBytes) : entryDatesBytes);
  } catch (error) {
    throw new Error(`Failed to decode ${ENTRY_DATES_KEY}: ${errorMessage(error)}`);
  }
  if (entryDates.versionDates.length !== index.versions.length) {
    throw new Error(
      `${ENTRY_DATES_KEY} has ${entryDates.versionDates.length} versions, but ` +
        `${VERSIONS_KEY} has ${index.versions.length}`,
    );
  }
  for (let version = 0; version < index.versions.length; version += 1) {
    const expectedSeconds = Math.floor(Date.parse(index.versions[version].date) / 1000);
    if (entryDates.versionDates[version] / 1000 !== expectedSeconds) {
      throw new Error(`${ENTRY_DATES_KEY} timestamp mismatch at version index ${version}`);
    }
  }

  const pendingSnapshots = [];
  const totals = { added: 0, modified: 0, removed: 0, bucketWrites: 0 };
  const releaseTables = {};
  let processedTables = 0;

  for (const [table, manifestPath] of manifest.tables) {
    const tableStartedAt = Date.now();
    let result;
    try {
      result = await updateTable({
        table,
        manifestPath,
        versionIndex,
        index,
        dryRun: options.dryRun,
        pendingSnapshots,
        entryDateTables: entryDates.tables,
      });
    } catch (error) {
      throw new Error(`Updating ${table} failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    const tableChanges = {};
    for (const kind of RELEASE_KINDS) {
      const entries = result.releaseEntries[kind];
      if (!entries || entries.length === 0) continue;
      entries.sort(compareReleaseEntries);
      tableChanges[kind] = entries;
    }
    if (Object.keys(tableChanges).length > 0) {
      releaseTables[table] = tableChanges;
    }

    totals.added += result.added;
    totals.modified += result.modified;
    totals.removed += result.removed;
    totals.bucketWrites += result.bucketWrites;
    processedTables += 1;

    log(
      `${table}: +${result.added} ~${result.modified} -${result.removed} ` +
        `(${result.definitionCount} definitions, ${result.bucketCount} buckets, ` +
        `${result.bucketWrites} bucket writes, ${Date.now() - tableStartedAt}ms)`,
    );
  }

  const date = new Date().toISOString();
  entryDates.versionDates.push(Date.parse(date));
  if (entryDates.versionDates.length !== versionIndex + 1) {
    throw new Error('Entry-date version timestamps are not contiguous with versions.json');
  }
  const releaseTotals = { a: 0, m: 0, r: 0, u: 0, c: 0 };
  for (const changes of Object.values(releaseTables)) {
    for (const kind of RELEASE_KINDS) {
      releaseTotals[kind] += changes[kind]?.length ?? 0;
    }
  }
  if (
    releaseTotals.a !== totals.added ||
    releaseTotals.m !== totals.modified ||
    releaseTotals.r !== totals.removed
  ) {
    throw new Error(
      `Release totals (${JSON.stringify(releaseTotals)}) do not match revision totals ` +
        `(+${totals.added} ~${totals.modified} -${totals.removed})`,
    );
  }
  const release = {
    v: versionIndex,
    date,
    version: manifest.version,
    totals: releaseTotals,
    tables: releaseTables,
  };

  const meta = {
    i: versionIndex,
    id: manifest.uuid ?? sha256(manifest.version).slice(0, 32),
    version: manifest.version,
    date,
    source: 'cron',
    added: totals.added,
    modified: totals.modified,
    removed: totals.removed,
    counts: { ...releaseTotals },
  };

  const summary =
    `${manifest.version} (index ${versionIndex}): ${processedTables} tables, ` +
    `+${totals.added} ~${totals.modified} -${totals.removed}`;

  if (options.dryRun) {
    log(
      `Dry run complete: would write ${totals.bucketWrites} bucket objects, ` +
        `${manifest.tables.length} snapshots, and ` +
        `${RELEASE_PREFIX}/${versionIndex}.json.gz and ${ENTRY_DATES_KEY} ` +
        `(${releaseTotals.a + releaseTotals.m + releaseTotals.r} entries), ` +
        `then commit ${VERSIONS_KEY}; no R2 writes were made. ${summary}`,
    );
    return;
  }

  log(`Uploading ${pendingSnapshots.length} updated snapshots...`);
  for (let snapshotIndex = 0; snapshotIndex < pendingSnapshots.length; snapshotIndex += 1) {
    const snapshot = pendingSnapshots[snapshotIndex];
    try {
      r2PutFile(snapshot.key, snapshot.file, { gzip: true });
    } finally {
      rmSync(snapshot.file, { force: true });
    }
    if ((snapshotIndex + 1) % 20 === 0 || snapshotIndex + 1 === pendingSnapshots.length) {
      log(`Uploaded snapshots: ${snapshotIndex + 1}/${pendingSnapshots.length}`);
    }
  }

  // Publish the release index before v1/versions.json so readers never see a
  // version whose change list is missing.
  const releaseKey = `${RELEASE_PREFIX}/${versionIndex}.json.gz`;
  await r2PutValue(releaseKey, release, { gzip: true });
  log(`Uploaded ${releaseKey} (${releaseTotals.a + releaseTotals.m + releaseTotals.r} entries).`);

  const entryDatesFile = path.join(TMP_DIR, 'uploads', `${sha256(ENTRY_DATES_KEY)}.bin.gz`);
  try {
    mkdirSync(path.dirname(entryDatesFile), { recursive: true });
    writeFileSync(entryDatesFile, gzipSync(encodeEntryDates(entryDates), { level: 9 }));
    r2PutFile(ENTRY_DATES_KEY, entryDatesFile, {
      gzip: true,
      contentType: 'application/octet-stream',
    });
    log(`Uploaded ${ENTRY_DATES_KEY} (${entryDates.tables.size} tables).`);
  } finally {
    rmSync(entryDatesFile, { force: true });
  }

  // Commit last: readers keep seeing the previous version until every table,
  // bucket, snapshot, release index, and entry-date index are durable.
  index.schema = 1;
  index.generatedAt = date;
  index.versions.push(meta);
  await r2PutValue(VERSIONS_KEY, index, { gzip: false });

  log(
    `Committed ${VERSIONS_KEY}. ${summary}, ${totals.bucketWrites} bucket writes, ` +
      `${pendingSnapshots.length} snapshots; ${Date.now() - startedAt}ms total.`,
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
  } else {
    await update(options);
  }
} catch (error) {
  console.error(`[update-live-manifest] ${error?.stack ?? errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
